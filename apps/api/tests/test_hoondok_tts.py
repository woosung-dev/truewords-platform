"""훈독 AI 낭독 목소리 (PLAN-HD-011, API-HD-044~046) — 캐시·월 상한·꺼짐·식별자 조회·Google 오류·라우터 경계.

실제 Google 호출은 하지 않는다. 서비스 테스트는 synth_fn 을, 전송층 테스트는 httpx.MockTransport 를 쓴다.
"""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, select

from app.main import app
from app.modules.hoondok.dependencies import get_tts_service
from app.modules.hoondok.display_text import to_display_text
from app.modules.hoondok.exceptions import TtsError
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.models import (
    ContentRight,
    DailyReading,
    JeongseongPeriod,
    JeongseongReading,
    TtsUsage,
)
from app.modules.hoondok.repository import JeongseongRepository
from app.modules.hoondok.tts_google import (
    TTS_ENDPOINT,
    TtsUpstreamError,
    split_for_synthesis,
    synthesize_mp3,
)
from app.modules.hoondok.tts_repository import TtsRepository
from app.modules.hoondok.tts_service import (
    TtsService,
    billing_month,
    cache_key,
    normalize_for_speech,
    split_paragraphs,
)
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService
from app.modules.qdrant import QdrantPoint

TODAY = date(2026, 9, 25)
MONTH = "2026-09"
CHUNK_ID = "11111111-1111-1111-1111-111111111111"
CHUNK_TEXT = "하나님은 사랑과 진리와 생명의 본체이십니다.\n\n참부모님께서는 실체로 오셨습니다."
MP3 = b"ID3-fake-mp3"
USER = uuid.UUID("22222222-2222-2222-2222-222222222222")
NOW = datetime(2026, 9, 25, 3, 0)  # naive UTC (models._utcnow 와 같은 형식)


@pytest.fixture
async def db():
    engine = create_async_engine(
        "sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    async with engine.begin() as conn:
        await conn.run_sync(
            SQLModel.metadata.create_all,
            tables=[
                User.__table__,
                ContentRight.__table__,
                DailyReading.__table__,
                JeongseongPeriod.__table__,
                JeongseongReading.__table__,
                TtsUsage.__table__,
            ],
        )
    session = AsyncSession(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        await session.close()
        await engine.dispose()


def _point(chunk_index: int, text: str = CHUNK_TEXT, volume: str = "v", pid: str | int = CHUNK_ID) -> QdrantPoint:
    return QdrantPoint(pid, 0.0, {"volume": volume, "chunk_index": chunk_index, "text": text})


def _make(
    session,
    tmp_path,
    *,
    api_key: str | None = "test-key",
    limit: int = 900_000,
    user_limit: int = 30_000,
    synth=None,
    cache_dir=None,
    request_timeout: float = 45.0,
):
    qdrant = AsyncMock()
    qdrant.retrieve.return_value = [_point(0)]
    qdrant.scroll.return_value = ([], None)
    journey = JourneyService(JourneyRepository(session), qdrant, JeongseongRepository(session), today_fn=lambda: TODAY)
    synth = synth or AsyncMock(return_value=MP3)
    service = TtsService(
        TtsRepository(session),
        journey,
        api_key=api_key,
        monthly_limit=limit,
        user_daily_limit=user_limit,
        cache_dir=cache_dir or tmp_path / "cache",
        synth_fn=synth,
        month_fn=lambda: MONTH,
        today_fn=lambda: TODAY,
        now_fn=lambda: NOW,
        request_timeout=request_timeout,
    )
    return service, qdrant, synth


async def _allow(session, volume: str = "v", **scopes) -> None:
    session.add(ContentRight(volume=volume, work_title="표시 제목", status="allowed", **scopes))
    await session.commit()


async def _usage(session) -> list[TtsUsage]:
    return list((await session.execute(select(TtsUsage))).scalars().all())


# --- 캐시 ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cache_hit_does_not_synthesize_again(db, tmp_path):
    await _allow(db, scope_full_text=True)
    service, _, synth = _make(db, tmp_path)

    first = await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    second = await service.chunk_audio(CHUNK_ID, "sulafat", USER)

    assert first.content == second.content == MP3
    assert (first.is_cached, second.is_cached) == (False, True)
    synth.assert_awaited_once()
    # 합성 원문 = 화면 display_text 를 공백 정규화한 것. 문단 경계는 한 칸 공백이 된다.
    voice_name, text = synth.await_args.args
    assert voice_name == "ko-KR-Chirp3-HD-Sulafat"
    assert text == "하나님은 사랑과 진리와 생명의 본체이십니다. 참부모님께서는 실체로 오셨습니다."
    # 파일은 sha256(voice|rate|text) 이름으로 원자적으로 저장되고 임시 파일이 남지 않는다.
    key = cache_key("sulafat", text)
    assert first.cache_key == key
    files = sorted(p.name for p in (tmp_path / "cache").rglob("*") if p.is_file())
    assert files == [f"{key}.mp3"]
    # 캐시 적중은 사용량에 넣지 않는다.
    assert [(u.month, u.voice, u.chars) for u in await _usage(db)] == [(MONTH, "sulafat", len(text))]


@pytest.mark.asyncio
async def test_other_voice_is_separate_cache_entry(db, tmp_path):
    await _allow(db, scope_full_text=True)
    service, _, synth = _make(db, tmp_path)
    await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    await service.chunk_audio(CHUNK_ID, "iapetus", USER)
    assert synth.await_count == 2
    assert synth.await_args_list[1].args[0] == "ko-KR-Chirp3-HD-Iapetus"


@pytest.mark.asyncio
async def test_concurrent_same_key_synthesizes_once(db, tmp_path):
    await _allow(db, scope_full_text=True)
    async def slow(voice_name, text):
        await asyncio.sleep(0.05)
        return MP3

    synth = AsyncMock(side_effect=slow)
    service, _, _ = _make(db, tmp_path, synth=synth)
    results = await asyncio.gather(*(service.chunk_audio(CHUNK_ID, "aoede", USER) for _ in range(3)))
    assert synth.await_count == 1
    assert sorted(r.is_cached for r in results) == [False, True, True]
    assert len(await _usage(db)) == 1


# --- 월 상한 · 꺼짐 · 잘못된 요청 ------------------------------------------------


@pytest.mark.asyncio
async def test_monthly_limit_blocks_new_synthesis_but_serves_cache(db, tmp_path):
    await _allow(db, scope_full_text=True)
    text = normalize_for_speech(CHUNK_TEXT)
    service, _, synth = _make(db, tmp_path, limit=len(text) + 5)
    await service.chunk_audio(CHUNK_ID, "sulafat", USER)  # 상한 안 — 만든다

    # 다른 목소리는 새 합성이라 상한을 넘는다 → 429, Google 을 부르지 않는다.
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "aoede", USER)
    assert (exc.value.status_code, exc.value.error_code) == (429, "TTS_QUOTA_EXCEEDED")
    assert synth.await_count == 1
    # 이미 만든 파일은 상한과 무관하게 준다.
    assert (await service.chunk_audio(CHUNK_ID, "sulafat", USER)).is_cached
    voices = await service.voices()
    assert voices.enabled and not voices.limit_reached  # 사용 len(text) < 상한


@pytest.mark.asyncio
async def test_voices_reports_limit_reached_from_month_sum(db, tmp_path):
    db.add_all([TtsUsage(month=MONTH, voice="sulafat", chars=600, cache_key="a"),
                TtsUsage(month=MONTH, voice="aoede", chars=400, cache_key="b"),
                TtsUsage(month="2026-08", voice="aoede", chars=99_999, cache_key="c")])
    await db.commit()
    service, _, _ = _make(db, tmp_path, limit=1000)
    assert (await service.voices()).limit_reached
    service, _, _ = _make(db, tmp_path, limit=1001)
    assert not (await service.voices()).limit_reached  # 지난달 사용량은 세지 않는다


@pytest.mark.asyncio
async def test_disabled_without_api_key(db, tmp_path):
    await _allow(db, scope_full_text=True)
    service, qdrant, synth = _make(db, tmp_path, api_key="  ")
    voices = await service.voices()
    assert (voices.enabled, voices.limit_reached, voices.default_voice) == (False, False, "sulafat")
    assert [v.id for v in voices.voices] == ["sulafat", "aoede", "algieba", "iapetus"]
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (503, "TTS_DISABLED")
    synth.assert_not_awaited()
    qdrant.retrieve.assert_not_awaited()


@pytest.mark.asyncio
async def test_invalid_voice_is_rejected_before_lookup(db, tmp_path):
    service, qdrant, synth = _make(db, tmp_path)
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "ko-KR-Chirp3-HD-Sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (422, "TTS_INVALID_VOICE")
    qdrant.retrieve.assert_not_awaited()
    synth.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["missing", "not_allowed", "bad_id"])
async def test_missing_or_unlicensed_chunk_is_404(db, tmp_path, case):
    await _allow(db, volume="other", scope_full_text=True)
    await _allow(db, volume="v", scope_search=True)  # 검색만 허용 — 원문 권리 없음
    service, qdrant, synth = _make(db, tmp_path)
    chunk_id = "not-a-point-id" if case == "bad_id" else CHUNK_ID
    if case == "missing":
        qdrant.retrieve.return_value = []
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(chunk_id, "sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (404, "TTS_SOURCE_NOT_FOUND")
    synth.assert_not_awaited()


@pytest.mark.asyncio
async def test_chunk_text_trims_overlap_like_words_page(db, tmp_path):
    """페이지 중간 청크는 바로 앞 청크와의 겹침을 잘라 화면과 같은 글을 읽는다. 페이지 첫 청크는 앞을 보지 않는다."""
    await _allow(db, scope_full_text=True)
    service, qdrant, synth = _make(db, tmp_path)
    overlap = "겹치는 문장이 여기 있습니다. 앞 청크의 끝과 이 청크의 시작이 같은 글입니다."
    prev = "첫 청크의 앞부분입니다. " * 5 + overlap
    curr = overlap + " 새 문장입니다." * 10
    qdrant.retrieve.return_value = [_point(21, curr)]
    qdrant.scroll.return_value = ([_point(20, prev, pid=2)], None)
    await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    must = qdrant.scroll.await_args.kwargs["scroll_filter"]["must"]
    assert {"key": "chunk_index", "match": {"value": 20}} in must
    spoken = synth.await_args.args[1]
    assert spoken == normalize_for_speech(to_display_text(prev, curr))
    assert "겹치는" not in spoken

    qdrant.scroll.reset_mock()
    qdrant.retrieve.return_value = [_point(20, "페이지 첫 청크입니다.", pid=3)]
    await service.chunk_audio("3", "sulafat", USER)
    qdrant.scroll.assert_not_awaited()


# --- 오늘 훈독 단락 --------------------------------------------------------------


async def _user(session) -> User:
    user = User(email=f"{uuid.uuid4()}@t.com", display_name="식구", password_hash="x")
    session.add(user)
    await session.commit()
    return user


def _daily(reading_date: date = TODAY, **kwargs) -> DailyReading:
    defaults = dict(
        reading_date=reading_date,
        title="오늘 말씀",
        body="첫째 단락입니다.\n\n  둘째 단락\n입니다.  \n\n\n",
        speaker="화자",
        work_title="저작물",
        authority_grade="O1",
        review_status="reviewed",
    )
    return DailyReading(**{**defaults, **kwargs})


def test_split_paragraphs_uses_blank_lines():
    assert split_paragraphs("가.\n\n  나\n다.  \n \n\n라") == ["가.", "나\n다.", "라"]
    assert split_paragraphs("   ") == []


@pytest.mark.asyncio
async def test_daily_reading_paragraph_audio(db, tmp_path):
    reading = _daily()
    db.add(reading)
    await db.commit()
    user = await _user(db)
    service, _, synth = _make(db, tmp_path)
    await service.reading_audio(reading.id, 1, "algieba", user.id)
    assert synth.await_args.args == ("ko-KR-Chirp3-HD-Algieba", "둘째 단락 입니다.")
    with pytest.raises(TtsError) as exc:
        await service.reading_audio(reading.id, 2, "algieba", user.id)
    assert exc.value.error_code == "TTS_SOURCE_NOT_FOUND"


@pytest.mark.asyncio
@pytest.mark.parametrize("reading", [_daily(TODAY + timedelta(days=1)), _daily(review_status="withdrawn")])
async def test_future_or_withdrawn_daily_reading_is_404(db, tmp_path, reading):
    db.add(reading)
    await db.commit()
    user = await _user(db)
    service, _, synth = _make(db, tmp_path)
    with pytest.raises(TtsError) as exc:
        await service.reading_audio(reading.id, 0, "sulafat", user.id)
    assert exc.value.status_code == 404
    synth.assert_not_awaited()


@pytest.mark.asyncio
async def test_jeongseong_reading_only_for_owner_with_rights(db, tmp_path):
    owner, other = await _user(db), await _user(db)
    period = JeongseongPeriod(user_id=owner.id, topic="감사", started_on=TODAY, duration_days=7)
    db.add(period)
    await db.commit()
    reading = JeongseongReading(
        period_id=period.id, reading_date=TODAY, volume="v", chunk_id="1", body="정성 말씀 본문입니다.",
        title="정성", work_title="저작물",
    )
    db.add(reading)
    await db.commit()
    service, _, synth = _make(db, tmp_path)

    # 권리가 없으면 본인이어도 404
    with pytest.raises(TtsError):
        await service.reading_audio(reading.id, 0, "sulafat", owner.id)
    await _allow(db, scope_jeongseong=True)
    with pytest.raises(TtsError) as exc:
        await service.reading_audio(reading.id, 0, "sulafat", other.id)
    assert exc.value.status_code == 404
    synth.assert_not_awaited()

    await service.reading_audio(reading.id, 0, "sulafat", owner.id)
    assert synth.await_args.args[1] == "정성 말씀 본문입니다."


# --- Google 전송층 ---------------------------------------------------------------


def _transport(statuses: list[int], seen: list[httpx.Request]):
    replies = iter(statuses)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        status = next(replies)
        if status == 200:
            return httpx.Response(200, json={"audioContent": base64.b64encode(b"mp3!").decode()})
        return httpx.Response(status, json={"error": {"message": "backend error"}})

    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_google_request_shape_and_retry_once_on_5xx():
    seen: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_transport([503, 200], seen)) as client:
        audio = await synthesize_mp3("안녕하세요.", voice_name="ko-KR-Chirp3-HD-Aoede", speaking_rate=0.9,
                                     api_key="secret-key", client=client)
    assert audio == b"mp3!"
    assert len(seen) == 2
    request = seen[0]
    assert str(request.url) == TTS_ENDPOINT  # 키는 URL 에 싣지 않는다
    assert request.headers["X-Goog-Api-Key"] == "secret-key"
    assert json.loads(request.content) == {
        "input": {"text": "안녕하세요."},
        "voice": {"languageCode": "ko-KR", "name": "ko-KR-Chirp3-HD-Aoede"},
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.9},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(("statuses", "calls"), [([500, 502], 2), ([400], 1), ([403], 1)])
async def test_google_errors_raise_without_leaking_key(statuses, calls):
    seen: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_transport(statuses, seen)) as client:
        with pytest.raises(TtsUpstreamError) as exc:
            await synthesize_mp3("문장.", voice_name="v", speaking_rate=0.9, api_key="secret-key", client=client)
    assert len(seen) == calls  # 5xx 만 1회 재시도
    assert "secret-key" not in str(exc.value)


@pytest.mark.asyncio
async def test_google_network_error_retries_then_fails():
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("boom", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(TtsUpstreamError):
            await synthesize_mp3("문장.", voice_name="v", speaking_rate=0.9, api_key="k", client=client)
    assert calls == 2


@pytest.mark.asyncio
async def test_upstream_failure_before_billing_records_nothing(db, tmp_path):
    await _allow(db, scope_full_text=True)
    service, _, _ = _make(db, tmp_path, synth=AsyncMock(side_effect=TtsUpstreamError("Google TTS 500")))
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (502, "TTS_UPSTREAM_FAILED")
    assert await _usage(db) == []
    assert not (tmp_path / "cache").exists() or not any((tmp_path / "cache").rglob("*.mp3"))


def test_split_for_synthesis_keeps_requests_under_limit():
    sentence = "가" * 30 + ". "
    text = (sentence * 100).strip()
    pieces = split_for_synthesis(text, limit=100)
    assert all(len(p) <= 100 for p in pieces)
    assert " ".join(pieces) == text
    long_word = "나" * 250
    assert [len(p) for p in split_for_synthesis(long_word, limit=100)] == [100, 100, 50]
    assert split_for_synthesis("짧다.") == ["짧다."]


# --- 라우터 -----------------------------------------------------------------------


@pytest.fixture
async def client(db, tmp_path):
    await _allow(db, scope_full_text=True)
    me = await _user(db)
    service, _, synth = _make(db, tmp_path)

    class _Users:
        async def get_by_id(self, user_id):
            return await db.get(User, user_id)

    app.dependency_overrides[get_identity_repository] = lambda: _Users()
    app.dependency_overrides[get_tts_service] = lambda: service
    try:
        c = TestClient(app)
        c.me, c.synth = me, synth  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_tts_service, None)


def test_voices_is_public(client):
    response = client.get("/hoondok/tts/voices")
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is True and body["default_voice"] == "sulafat"
    assert body["voices"][0] == {"id": "sulafat", "label": "차분한 여성", "description": "따뜻하고 낮은 톤"}


def test_audio_requires_login(client):
    assert client.get(f"/hoondok/tts/chunks/{CHUNK_ID}?voice=sulafat").status_code == 401
    assert client.get(f"/hoondok/tts/readings/{uuid.uuid4()}/0?voice=sulafat").status_code == 401
    client.synth.assert_not_awaited()


def test_chunk_audio_returns_mp3_with_long_cache(client):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.me))
    first = client.get(f"/hoondok/tts/chunks/{CHUNK_ID}?voice=sulafat")
    assert first.status_code == 200
    assert first.headers["content-type"] == "audio/mpeg"
    assert first.headers["cache-control"] == "private, max-age=2592000"
    assert (first.content, first.headers["x-tts-cache"]) == (MP3, "miss")
    assert client.get(f"/hoondok/tts/chunks/{CHUNK_ID}?voice=sulafat").headers["x-tts-cache"] == "hit"


def test_audio_errors_carry_distinct_codes(client):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.me))
    bad_voice = client.get(f"/hoondok/tts/chunks/{CHUNK_ID}?voice=nope")
    assert (bad_voice.status_code, bad_voice.json()["error_code"]) == (422, "TTS_INVALID_VOICE")
    missing = client.get(f"/hoondok/tts/readings/{uuid.uuid4()}/0?voice=sulafat")
    assert (missing.status_code, missing.json()["error_code"]) == (404, "TTS_SOURCE_NOT_FOUND")


@pytest.mark.asyncio
async def test_cache_write_failure_still_serves_and_counts(db, tmp_path, monkeypatch):
    """캐시 볼륨에 쓸 수 없어도(권한·디스크) 듣기는 되고 사용량은 센다 — 상한이 비용을 막는다."""
    await _allow(db, scope_full_text=True)
    service, _, _ = _make(db, tmp_path)

    async def broken(key, content):
        raise PermissionError("read-only")

    monkeypatch.setattr(service, "_write_cache", broken)
    audio = await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert audio.content == MP3 and not audio.is_cached
    assert len(await _usage(db)) == 1


# --- 리뷰 반영: 동시 상한 · 사용자 한도 · 부분 과금 · 시간 상한 · 캐시 불가 · 청구 달 ---------------------


@pytest.mark.asyncio
async def test_concurrent_different_keys_cannot_overshoot_monthly_limit(db, tmp_path):
    """서로 다른 목소리(= 다른 캐시 키) 동시 요청 — 예약이 락 안에서 끝나 둘째는 첫째의 글자 수를 보고 막힌다."""
    await _allow(db, scope_full_text=True)
    text = normalize_for_speech(CHUNK_TEXT)

    async def slow(voice_name, spoken):
        await asyncio.sleep(0.05)
        return MP3

    synth = AsyncMock(side_effect=slow)
    service, _, _ = _make(db, tmp_path, limit=len(text) + 5, synth=synth)
    results = await asyncio.gather(
        service.chunk_audio(CHUNK_ID, "sulafat", USER),
        service.chunk_audio(CHUNK_ID, "aoede", USER),
        return_exceptions=True,
    )
    errors = [r for r in results if isinstance(r, TtsError)]
    assert len(errors) == 1 and errors[0].error_code == "TTS_QUOTA_EXCEEDED"
    assert synth.await_count == 1
    assert sum(u.chars for u in await _usage(db)) == len(text)


@pytest.mark.asyncio
async def test_user_daily_limit_is_per_user_and_rolling_24h(db, tmp_path):
    await _allow(db, scope_full_text=True)
    text = normalize_for_speech(CHUNK_TEXT)
    other = uuid.uuid4()
    # 25시간 전 사용량은 창 밖이라 세지 않는다.
    db.add(TtsUsage(month=MONTH, voice="aoede", chars=10_000, cache_key="old", user_id=USER,
                    created_at=NOW - timedelta(hours=25)))
    await db.commit()
    service, _, synth = _make(db, tmp_path, user_limit=len(text) + 5)

    await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "aoede", USER)
    assert (exc.value.status_code, exc.value.error_code) == (429, "TTS_USER_LIMIT_EXCEEDED")
    # 다른 사용자는 자기 한도로 센다. 이미 만든 파일은 한도와 무관하게 준다.
    assert not (await service.chunk_audio(CHUNK_ID, "aoede", other)).is_cached
    assert (await service.chunk_audio(CHUNK_ID, "sulafat", USER)).is_cached
    assert synth.await_count == 2
    recorded = {(u.user_id, u.voice) for u in await _usage(db) if u.cache_key != "old"}
    assert recorded == {(USER, "sulafat"), (other, "aoede")}


@pytest.mark.asyncio
async def test_usage_is_committed_and_connection_released_before_google(db, tmp_path):
    """Google 을 부르는 동안 트랜잭션(커넥션)을 쥐지 않고, 예약은 이미 커밋돼 있다."""
    await _allow(db, scope_full_text=True)
    seen: dict[str, object] = {}

    async def synth(voice_name, spoken):
        seen["in_transaction"] = db.in_transaction()
        async with AsyncSession(db.bind) as other:  # 다른 세션에서도 보인다 = 커밋됨
            seen["reserved"] = (await other.execute(select(TtsUsage.chars))).scalars().all()
        return MP3

    service, _, _ = _make(db, tmp_path, synth=AsyncMock(side_effect=synth))
    await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert seen == {"in_transaction": False, "reserved": [len(normalize_for_speech(CHUNK_TEXT))]}


@pytest.mark.asyncio
@pytest.mark.parametrize(("billed", "expected"), [(0, []), (12, [12])])
async def test_upstream_failure_keeps_only_billed_chars(db, tmp_path, billed, expected):
    await _allow(db, scope_full_text=True)
    synth = AsyncMock(side_effect=TtsUpstreamError("Google TTS 400", billed_chars=billed))
    service, _, _ = _make(db, tmp_path, synth=synth)
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert exc.value.status_code == 502
    assert [u.chars for u in await _usage(db)] == expected


@pytest.mark.asyncio
async def test_google_partial_failure_reports_successful_piece_chars():
    """긴 단락의 앞 조각이 성공하고 뒤 조각이 실패하면, 앞 조각 글자 수를 과금 가능분으로 알린다."""
    text = (("가" * 30 + ". ") * 60).strip()
    pieces = split_for_synthesis(text)
    assert len(pieces) == 2
    seen: list[httpx.Request] = []
    async with httpx.AsyncClient(transport=_transport([200, 400], seen)) as client:
        with pytest.raises(TtsUpstreamError) as exc:
            await synthesize_mp3(text, voice_name="v", speaking_rate=0.9, api_key="k", client=client)
    assert exc.value.billed_chars == len(pieces[0])


@pytest.mark.asyncio
async def test_google_read_timeout_is_not_retried_and_counted():
    """읽기 타임아웃은 Google 이 이미 합성했을 수 있다 — 재시도하지 않고(이중 과금 방지) 그 조각을 과금분으로 센다."""
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise httpx.ReadTimeout("slow", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(TtsUpstreamError) as exc:
            await synthesize_mp3("문장.", voice_name="v", speaking_rate=0.9, api_key="k", client=client)
    assert calls == 1
    assert exc.value.billed_chars == len("문장.")


@pytest.mark.asyncio
async def test_request_timeout_returns_504_and_keeps_reservation(db, tmp_path):
    await _allow(db, scope_full_text=True)

    async def hang(voice_name, spoken):
        await asyncio.sleep(5)
        return MP3

    service, _, _ = _make(db, tmp_path, synth=AsyncMock(side_effect=hang), request_timeout=0.05)
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (504, "TTS_TIMEOUT")
    # 어디까지 합성됐는지 모르니 예약은 남긴다.
    assert [u.chars for u in await _usage(db)] == [len(normalize_for_speech(CHUNK_TEXT))]


@pytest.mark.asyncio
async def test_unwritable_cache_dir_turns_feature_off(db, tmp_path):
    await _allow(db, scope_full_text=True)
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("file")  # 디렉터리 자리에 파일 — mkdir·쓰기가 실패한다
    service, _, synth = _make(db, tmp_path, cache_dir=blocker / "cache")
    assert (await service.voices()).enabled is False
    with pytest.raises(TtsError) as exc:
        await service.chunk_audio(CHUNK_ID, "sulafat", USER)
    assert (exc.value.status_code, exc.value.error_code) == (503, "TTS_DISABLED")
    synth.assert_not_awaited()
    assert await _usage(db) == []


def test_billing_month_follows_pacific_time():
    # 2026-10-01 00:00 PDT = 07:00 UTC. 그 전의 UTC 10월은 Google 청구상 아직 9월이다.
    assert billing_month(datetime(2026, 10, 1, 6, 59, tzinfo=timezone.utc)) == "2026-09"
    assert billing_month(datetime(2026, 10, 1, 7, 0, tzinfo=timezone.utc)) == "2026-10"
    # 겨울(PST, UTC-8)
    assert billing_month(datetime(2027, 1, 1, 7, 59, tzinfo=timezone.utc)) == "2026-12"
    assert billing_month(datetime(2027, 1, 1, 8, 0, tzinfo=timezone.utc)) == "2027-01"


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["ended_period", "past_day"])
async def test_jeongseong_reading_outside_current_period_is_404(db, tmp_path, case):
    """화면은 진행 중 기간의 오늘 말씀만 보인다 — 지난 말씀·끝난 기간은 합성하지 않는다."""
    owner = await _user(db)
    period = JeongseongPeriod(
        user_id=owner.id, topic="감사", started_on=TODAY - timedelta(days=3), duration_days=7,
        status="completed" if case == "ended_period" else "active",
    )
    db.add(period)
    await db.commit()
    reading = JeongseongReading(
        period_id=period.id, reading_date=TODAY if case == "ended_period" else TODAY - timedelta(days=1),
        volume="v", chunk_id="1", body="정성 말씀 본문입니다.", title="정성", work_title="저작물",
    )
    db.add(reading)
    await db.commit()
    await _allow(db, scope_jeongseong=True)
    service, _, synth = _make(db, tmp_path)
    with pytest.raises(TtsError) as exc:
        await service.reading_audio(reading.id, 0, "sulafat", owner.id)
    assert exc.value.status_code == 404
    synth.assert_not_awaited()
