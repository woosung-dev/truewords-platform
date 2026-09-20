"""훈독 편성 후보 추출 API-HD-012 (PLAN-HD-003) — 순수 판정, 서비스 검증·오류, 라우트 순서·게이트.

이 기능의 핵심 성질은 **추출형** 이라는 것이다: 생성 LLM 을 부르지 않고 본문을 원문 그대로 넘긴다.
아래 `test_body_is_verbatim_from_corpus` 가 그 성질을 고정한다 — 깨지면 설계가 바뀐 것이다.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from route_helpers import dependency_callables, iter_api_routes

from app.modules.admin.dependencies import get_current_admin, require_admin_gate, verify_csrf
from app.modules.hoondok.candidates import (
    clean_volume,
    filter_results,
    is_card_worthy,
    suggest_speaker,
    suggest_title,
)
from app.modules.hoondok.dependencies import get_daily_reading_candidate_service
from app.modules.hoondok.service import MAX_CANDIDATE_LIMIT, DailyReadingCandidateService
from app.modules.search.hybrid import SearchResult

BASE = "/admin/hoondok/daily-readings"
CANDIDATES = f"{BASE}/candidates"
GATE_ADMIN = {"user_id": uuid.uuid4(), "role": "admin", "email": "demo-admin@example.com"}

# 실제 코퍼스 청크를 본뜬 본문 — 기본 길이 범위(50~300자) 안이고 한국어 문장 종결로 끝난다.
GOOD_TEXT = (
    "참사랑은 직단거리를 갑니다. 종적인 사랑은 90각도 한 점밖에 없습니다. "
    "그 한 점에서 부모와 자녀가 하나 되고, 하나 된 자리에서 참된 가정이 출발하는 것입니다."
)


def _result(text: str = GOOD_TEXT, *, chunk_id: str = "pt-1", source: str = "B", volume: str = "천성경.pdf"):
    return SearchResult(text=text, volume=volume, chunk_index=0, score=0.42, source=source, chunk_id=chunk_id)


# --- 순수 판정 ---------------------------------------------------------------


@pytest.mark.parametrize(
    "text,expected",
    [
        (GOOD_TEXT, True),
        ("참부모님의 뜻을 받들어야 합니다", True),
        ("이것은 문장이 끊긴 조각이고 종결어미가", False),  # 완결되지 않은 청크
        ("참사랑에 대하여 (123-45) 말씀하셨다", False),  # 페이지 인용 조각
        ("천성경.pdf 에서 발췌한 내용입니다", False),  # 파일명 leak
    ],
)
def test_is_card_worthy(text: str, expected: bool):
    assert is_card_worthy(text) is expected


def test_clean_volume_strips_extension():
    assert clean_volume("천성경.pdf") == "천성경"
    assert clean_volume(" 참부모경.hwpx ") == "참부모경"
    assert clean_volume("말씀선집 100권") == "말씀선집 100권"


def test_suggest_title_truncates_at_60():
    assert suggest_title(GOOD_TEXT) == "참사랑은 직단거리를 갑니다"
    long = "가" * 80 + ". 두 번째 문장입니다."
    title = suggest_title(long)
    assert len(title) == 60 and title.endswith("…")


def test_suggest_speaker_maps_labels():
    assert suggest_speaker("어머님 말씀") == "참어머님"
    assert suggest_speaker("말씀선집") == "말씀선집"  # 판별 불가면 라벨 그대로


# --- 필터 --------------------------------------------------------------------


def test_filter_drops_out_of_range_unworthy_and_missing_chunk_id():
    results = [
        _result("짧다", chunk_id="short"),  # 길이 미달
        _result("가" * 400 + " 입니다.", chunk_id="long"),  # 길이 초과
        _result("종결되지 않은 조각이라서", chunk_id="frag"),  # 카드 부적합
        _result(chunk_id=""),  # chunk_id 없음 = 원문 역추적 불가
        _result(chunk_id="ok"),
    ]
    picked = filter_results(results, min_len=50, max_len=300, limit=10)
    assert [c["chunk_id"] for c in picked] == ["ok"]


def test_filter_dedupes_by_chunk_id_and_respects_limit():
    results = [_result(chunk_id="dup"), _result(chunk_id="dup"), _result(chunk_id="other")]
    assert len(filter_results(results, min_len=50, max_len=300, limit=10)) == 2
    assert len(filter_results(results, min_len=50, max_len=300, limit=1)) == 1


def test_candidate_carries_source_label_and_suggestions():
    [c] = filter_results([_result()], min_len=50, max_len=300, limit=1)
    assert c["source_label"] == "어머님 말씀"
    assert c["suggested_speaker"] == "참어머님"
    assert c["work_title"] == "천성경"  # 확장자 제거됨
    assert c["char_count"] == len(GOOD_TEXT)


def test_body_is_verbatim_from_corpus():
    """추출형 계약: 본문은 검색 결과 원문과 글자 하나까지 같아야 한다."""
    [c] = filter_results([_result()], min_len=50, max_len=300, limit=1)
    assert c["text"] == GOOD_TEXT


# --- 서비스 ------------------------------------------------------------------


@pytest.fixture
def service():
    search = AsyncMock(return_value=[_result()])
    return DailyReadingCandidateService(client=object(), search_fn=search), search


async def test_search_returns_candidates(service):
    svc, search = service
    resp = await svc.search("참사랑", sources=["B"], limit=5)
    assert resp.query == "참사랑"
    assert [c.chunk_id for c in resp.candidates] == ["pt-1"]
    assert search.await_args.kwargs["source_filter"] == ["B"]


async def test_search_overfetches_beyond_limit(service):
    """길이·적합성에서 많이 떨어지므로 limit 보다 넉넉히 받아야 한다."""
    svc, search = service
    await svc.search("참사랑", limit=5)
    assert search.await_args.kwargs["top_k"] > 5


async def test_search_caps_limit(service):
    svc, search = service
    await svc.search("참사랑", limit=999)
    assert search.await_args.kwargs["top_k"] <= MAX_CANDIDATE_LIMIT * 5


async def test_blank_query_is_422(service):
    svc, _ = service
    with pytest.raises(HTTPException) as exc:
        await svc.search("   ")
    assert exc.value.status_code == 422


async def test_inverted_length_range_is_422(service):
    svc, _ = service
    with pytest.raises(HTTPException) as exc:
        await svc.search("참사랑", min_len=300, max_len=50)
    assert exc.value.status_code == 422


async def test_search_backend_failure_is_502():
    """Qdrant·Gemini 장애가 편성 화면에 500 으로 새지 않는다."""
    svc = DailyReadingCandidateService(
        client=object(), search_fn=AsyncMock(side_effect=httpx.ConnectError("down"))
    )
    with pytest.raises(HTTPException) as exc:
        await svc.search("참사랑")
    assert exc.value.status_code == 502


async def test_no_match_is_empty_list_not_error():
    svc = DailyReadingCandidateService(client=object(), search_fn=AsyncMock(return_value=[]))
    resp = await svc.search("없는주제")
    assert resp.candidates == []


# --- 라우터 ------------------------------------------------------------------


def _app():
    with patch("app.main.init_db", new_callable=AsyncMock):
        from app.main import app
    return app


def test_candidates_route_is_matched_before_reading_id():
    """`/{reading_id}` 가 먼저 등록되면 "candidates" 가 UUID 로 파싱돼 422 가 난다.

    등록 순서를 바꾸면 이 테스트가 먼저 깨진다 — admin_router 의 순서 주의 주석과 한 쌍이다.
    """
    app = _app()
    stub = AsyncMock()
    stub.search = AsyncMock(return_value={"query": "참사랑", "candidates": []})
    app.dependency_overrides[get_daily_reading_candidate_service] = lambda: stub
    app.dependency_overrides[get_current_admin] = lambda: GATE_ADMIN
    app.dependency_overrides[require_admin_gate] = lambda: None
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        res = TestClient(app).get(CANDIDATES, params={"q": "참사랑"})
        assert res.status_code == 200, res.text
        assert res.json() == {"query": "참사랑", "candidates": []}
        stub.search.assert_awaited_once()
    finally:
        app.dependency_overrides.clear()


def test_candidates_route_has_gate_and_csrf():
    app = _app()
    [(route, inherited)] = [
        (r, inh) for r, inh in iter_api_routes(app) if getattr(r, "path", "") == CANDIDATES
    ]
    deps = dependency_callables(route, inherited)
    assert require_admin_gate in deps
    assert verify_csrf in deps


def test_candidates_requires_admin_cookie():
    assert TestClient(_app()).get(CANDIDATES, params={"q": "참사랑"}).status_code == 401


def test_candidates_rejects_blank_query_at_validation():
    app = _app()
    app.dependency_overrides[get_current_admin] = lambda: GATE_ADMIN
    app.dependency_overrides[require_admin_gate] = lambda: None
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        assert TestClient(app).get(CANDIDATES, params={"q": ""}).status_code == 422
    finally:
        app.dependency_overrides.clear()
