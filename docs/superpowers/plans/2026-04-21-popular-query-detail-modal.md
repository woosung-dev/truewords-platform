# 인기 질문 상세 모달 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin Dashboard `/analytics` 페이지의 인기 질문 Top 10 행을 클릭하면 해당 질문의 모든 발생(봇·시점·답변·매칭 출처·피드백)을 한 모달에서 분석할 수 있는 기능 구현.

**Architecture:** DB 변경 없이 기존 5개 테이블(`search_events`, `session_messages`, `research_sessions`, `chatbot_configs`, `answer_citations`, `answer_feedback`)을 JOIN하는 새 백엔드 엔드포인트 `GET /admin/analytics/search/query-details`를 추가하고, 프론트엔드에서는 `@base-ui/react/dialog` 기반 모달과 아코디언 UI로 각 발생을 펼쳐서 분석할 수 있게 한다.

**Tech Stack:** FastAPI + SQLAlchemy (raw SQL `text`) · Pydantic v2 · Next.js 16 App Router · React Query · `@base-ui/react/dialog` · Tailwind CSS v4 · pytest + vitest

**Spec:** `docs/superpowers/specs/2026-04-21-popular-query-detail-modal-design.md`

---

## File Structure

### Backend

| 파일 | 유형 | 책임 |
|------|------|------|
| `backend/src/admin/analytics_schemas.py` | 수정 | `CitationItem`, `FeedbackItem`, `QueryOccurrence`, `QueryDetailResponse` 4개 Pydantic 클래스 추가 |
| `backend/src/admin/analytics_repository.py` | 수정 | `get_query_details(query_text, days, limit)` 메서드 추가 |
| `backend/src/admin/analytics_router.py` | 수정 | `GET /admin/analytics/search/query-details` 엔드포인트 추가 |
| `backend/tests/test_analytics_query_details.py` | 신규 | Router + Repository 통합 테스트 |

### Frontend

| 파일 | 유형 | 책임 |
|------|------|------|
| `admin/src/features/analytics/types.ts` | 수정 | `CitationItem`, `FeedbackItem`, `QueryOccurrence`, `QueryDetail` 타입 추가 |
| `admin/src/features/analytics/api.ts` | 수정 | `getQueryDetails(queryText, days)` 추가 |
| `admin/src/features/analytics/components/query-detail-occurrence.tsx` | 신규 | 단일 발생 아코디언 아이템 (봇/시간/답변/출처/피드백) |
| `admin/src/features/analytics/components/query-detail-modal.tsx` | 신규 | 모달 컨테이너 + 발생 리스트 렌더링 |
| `admin/src/app/(dashboard)/analytics/page.tsx` | 수정 | `TopQueriesTable` 행 클릭 → 모달 오픈 상태 관리 |
| `admin/src/test/query-detail-modal.test.tsx` | 신규 | 모달 컴포넌트 vitest |

---

## Task 1: Backend — Pydantic 응답 스키마 추가

**Files:**
- Modify: `backend/src/admin/analytics_schemas.py`

- [ ] **Step 1: 스키마 추가**

파일 끝에 4개 클래스를 추가한다.

```python
# backend/src/admin/analytics_schemas.py 의 파일 끝에 추가

class CitationItem(BaseModel):
    source: str
    volume: int
    chapter: str | None = None
    text_snippet: str
    relevance_score: float
    rank_position: int


class FeedbackItem(BaseModel):
    feedback_type: str
    comment: str | None = None
    created_at: datetime


class QueryOccurrence(BaseModel):
    search_event_id: uuid.UUID
    user_message_id: uuid.UUID
    assistant_message_id: uuid.UUID | None = None
    session_id: uuid.UUID
    chatbot_id: uuid.UUID | None = None
    chatbot_name: str | None = None
    asked_at: datetime
    rewritten_query: str | None = None
    search_tier: int
    total_results: int
    latency_ms: int
    applied_filters: dict = {}
    answer_text: str | None = None
    citations: list[CitationItem] = []
    feedback: FeedbackItem | None = None


class QueryDetailResponse(BaseModel):
    query_text: str
    total_count: int
    returned_count: int
    days: int
    occurrences: list[QueryOccurrence]
```

- [ ] **Step 2: 임포트 검증**

Run: `cd backend && uv run python -c "from src.admin.analytics_schemas import QueryDetailResponse, QueryOccurrence, CitationItem, FeedbackItem; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/analytics_schemas.py
git commit -m "feat(analytics): add query detail response schemas"
```

---

## Task 2: Backend — Repository 쿼리 구현 (TDD: 단위 테스트 먼저)

**Files:**
- Test: `backend/tests/test_analytics_query_details.py` (신규)
- Modify: `backend/src/admin/analytics_repository.py`

현재 `conftest.py`에는 실 DB 세션 픽스처가 없다. Repository는 **순수 SQL + 데이터 매핑** 책임만 지므로, 여기서는 **라우터 계층에서 AsyncMock으로 repo를 덮어쓰는 방식**으로 엔드투엔드 검증한다. Repository 구현 자체는 로컬 PostgreSQL에 대해 수동 확인(Task 6에서 스모크) + 코드 리뷰로 통과시킨다.

- [ ] **Step 1: Repository 메서드 추가**

`backend/src/admin/analytics_repository.py` 파일 끝에 메서드 추가한다. 또한 파일 상단 `from sqlalchemy import text` 바로 아래 `from uuid import UUID` 가 없으면 추가한다 (기존에 없음).

```python
# 파일 상단 import 블록에 추가
from uuid import UUID
```

그리고 `AnalyticsRepository` 클래스의 마지막 메서드로 아래를 추가:

```python
    async def get_query_details(
        self,
        query_text: str,
        days: int = 30,
        limit: int = 50,
    ) -> dict:
        """특정 질문의 모든 발생 상세 조회.

        반환 구조:
            {
                "query_text": str,
                "total_count": int,       # 기간 내 전체 발생 수
                "returned_count": int,    # 응답에 담긴 수 (<= limit)
                "days": int,
                "occurrences": list[dict] # asked_at desc
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=days)

        # 1) 전체 발생 수 (limit 초과 감지용)
        count_result = await self.session.execute(
            text("""
                SELECT COUNT(*) AS total
                FROM search_events se
                JOIN session_messages sm ON sm.id = se.message_id
                WHERE se.query_text = :q
                  AND sm.role = 'USER'
                  AND se.created_at >= :cutoff
            """),
            {"q": query_text, "cutoff": cutoff},
        )
        total_count = count_result.scalar_one() or 0

        if total_count == 0:
            return {
                "query_text": query_text,
                "total_count": 0,
                "returned_count": 0,
                "days": days,
                "occurrences": [],
            }

        # 2) 발생 목록 + 봇명 조회
        occ_result = await self.session.execute(
            text("""
                SELECT
                    se.id AS search_event_id,
                    se.message_id AS user_message_id,
                    se.rewritten_query,
                    se.search_tier,
                    se.total_results,
                    se.latency_ms,
                    se.applied_filters,
                    sm.session_id,
                    sm.created_at AS asked_at,
                    rs.chatbot_config_id AS chatbot_id,
                    cc.display_name AS chatbot_name
                FROM search_events se
                JOIN session_messages sm ON sm.id = se.message_id
                JOIN research_sessions rs ON rs.id = sm.session_id
                LEFT JOIN chatbot_configs cc ON cc.id = rs.chatbot_config_id
                WHERE se.query_text = :q
                  AND sm.role = 'USER'
                  AND se.created_at >= :cutoff
                ORDER BY sm.created_at DESC
                LIMIT :limit
            """),
            {"q": query_text, "cutoff": cutoff, "limit": limit},
        )
        occ_rows = occ_result.all()

        if not occ_rows:
            return {
                "query_text": query_text,
                "total_count": total_count,
                "returned_count": 0,
                "days": days,
                "occurrences": [],
            }

        user_message_ids = [row.user_message_id for row in occ_rows]
        session_ids = [row.session_id for row in occ_rows]

        # 3) 답변 조회 — 각 session에서 user 메시지 직후 assistant 최초 메시지
        answer_result = await self.session.execute(
            text("""
                SELECT
                    assistant_sm.id AS assistant_message_id,
                    assistant_sm.session_id,
                    assistant_sm.content AS answer_text,
                    assistant_sm.created_at AS answered_at,
                    user_sm.id AS user_message_id
                FROM session_messages user_sm
                JOIN LATERAL (
                    SELECT id, session_id, content, created_at
                    FROM session_messages
                    WHERE session_id = user_sm.session_id
                      AND role = 'ASSISTANT'
                      AND created_at > user_sm.created_at
                    ORDER BY created_at ASC
                    LIMIT 1
                ) assistant_sm ON TRUE
                WHERE user_sm.id = ANY(:user_ids)
            """),
            {"user_ids": user_message_ids},
        )
        answer_map: dict[UUID, dict] = {}
        for row in answer_result.all():
            answer_map[row.user_message_id] = {
                "assistant_message_id": row.assistant_message_id,
                "answer_text": row.answer_text,
            }

        # 4) 출처 조회 — assistant 메시지 기준 (없으면 빈 리스트)
        assistant_ids = [
            answer_map[uid]["assistant_message_id"]
            for uid in user_message_ids
            if uid in answer_map
        ]
        citations_map: dict[UUID, list[dict]] = {aid: [] for aid in assistant_ids}
        if assistant_ids:
            cite_result = await self.session.execute(
                text("""
                    SELECT
                        message_id,
                        source,
                        volume,
                        chapter,
                        text_snippet,
                        relevance_score,
                        rank_position
                    FROM answer_citations
                    WHERE message_id = ANY(:ids)
                    ORDER BY rank_position ASC
                """),
                {"ids": assistant_ids},
            )
            for row in cite_result.all():
                citations_map.setdefault(row.message_id, []).append({
                    "source": row.source,
                    "volume": row.volume,
                    "chapter": row.chapter,
                    "text_snippet": row.text_snippet,
                    "relevance_score": float(row.relevance_score),
                    "rank_position": row.rank_position,
                })

        # 5) 피드백 조회 — assistant 메시지 기준 최신 1건
        feedback_map: dict[UUID, dict] = {}
        if assistant_ids:
            fb_result = await self.session.execute(
                text("""
                    SELECT DISTINCT ON (message_id)
                        message_id,
                        feedback_type,
                        comment,
                        created_at
                    FROM answer_feedback
                    WHERE message_id = ANY(:ids)
                    ORDER BY message_id, created_at DESC
                """),
                {"ids": assistant_ids},
            )
            for row in fb_result.all():
                feedback_map[row.message_id] = {
                    "feedback_type": row.feedback_type,
                    "comment": row.comment,
                    "created_at": row.created_at,
                }

        # 6) 조합
        occurrences: list[dict] = []
        for row in occ_rows:
            uid = row.user_message_id
            answer = answer_map.get(uid)
            aid = answer["assistant_message_id"] if answer else None
            occurrences.append({
                "search_event_id": row.search_event_id,
                "user_message_id": uid,
                "assistant_message_id": aid,
                "session_id": row.session_id,
                "chatbot_id": row.chatbot_id,
                "chatbot_name": row.chatbot_name,
                "asked_at": row.asked_at,
                "rewritten_query": row.rewritten_query,
                "search_tier": row.search_tier,
                "total_results": row.total_results,
                "latency_ms": row.latency_ms,
                "applied_filters": row.applied_filters or {},
                "answer_text": answer["answer_text"] if answer else None,
                "citations": citations_map.get(aid, []) if aid else [],
                "feedback": feedback_map.get(aid) if aid else None,
            })

        return {
            "query_text": query_text,
            "total_count": total_count,
            "returned_count": len(occurrences),
            "days": days,
            "occurrences": occurrences,
        }
```

- [ ] **Step 2: 임포트 검증**

Run: `cd backend && uv run python -c "from src.admin.analytics_repository import AnalyticsRepository; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/analytics_repository.py
git commit -m "feat(analytics): add get_query_details repository query"
```

---

## Task 3: Backend — Router 엔드포인트 추가

**Files:**
- Modify: `backend/src/admin/analytics_router.py`

- [ ] **Step 1: 스키마 임포트 추가**

`backend/src/admin/analytics_router.py:7-15` 블록을 아래처럼 수정:

```python
from src.admin.analytics_schemas import (
    DailyCount,
    DashboardSummary,
    FeedbackSummary,
    FeedbackDistribution,
    NegativeFeedbackItem,
    QueryDetailResponse,
    SearchStats,
    TopQuery,
)
```

- [ ] **Step 2: 엔드포인트 추가**

파일 끝(`get_negative_feedback` 함수 뒤)에 추가:

```python
@router.get("/search/query-details", response_model=QueryDetailResponse)
async def get_query_details(
    query_text: str = Query(..., min_length=1, max_length=1000),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=50, ge=1, le=100),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> QueryDetailResponse:
    """인기 질문의 모든 발생 상세 조회."""
    data = await repo.get_query_details(query_text, days, limit)
    return QueryDetailResponse(**data)
```

- [ ] **Step 3: 임포트 검증**

Run: `cd backend && uv run python -c "from src.admin.analytics_router import router; routes = [r.path for r in router.routes]; assert '/admin/analytics/search/query-details' in routes, routes; print('ok')"`
Expected: `ok`

- [ ] **Step 4: 커밋**

```bash
git add backend/src/admin/analytics_router.py
git commit -m "feat(analytics): add query details endpoint"
```

---

## Task 4: Backend — Router 통합 테스트

**Files:**
- Create: `backend/tests/test_analytics_query_details.py`

기존 `test_api.py` 패턴처럼 ASGITransport + `app.dependency_overrides`로 Repository를 AsyncMock으로 대체한다.

- [ ] **Step 1: 빈 결과 테스트 작성**

```python
# backend/tests/test_analytics_query_details.py 신규 생성
"""Analytics query-details 엔드포인트 테스트."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

with patch("main.init_db", new_callable=AsyncMock):
    from main import app

from src.admin.analytics_repository import AnalyticsRepository
from src.admin.analytics_router import _get_repo
from src.admin.dependencies import get_current_admin


def _mock_admin():
    return {"user_id": uuid.uuid4(), "role": "admin"}


@pytest.fixture
def async_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def override_admin_auth():
    app.dependency_overrides[get_current_admin] = _mock_admin
    yield
    app.dependency_overrides.pop(get_current_admin, None)


def _override_repo(repo: AsyncMock):
    app.dependency_overrides[_get_repo] = lambda: repo


def _clear_repo_override():
    app.dependency_overrides.pop(_get_repo, None)


@pytest.mark.asyncio
async def test_query_details_returns_empty_when_no_occurrences(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_query_details.return_value = {
        "query_text": "존재하지 않는 질문",
        "total_count": 0,
        "returned_count": 0,
        "days": 30,
        "occurrences": [],
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/query-details",
                params={"query_text": "존재하지 않는 질문"},
            )
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["query_text"] == "존재하지 않는 질문"
    assert body["total_count"] == 0
    assert body["occurrences"] == []
```

- [ ] **Step 2: 테스트 실행 (실패 확인 — 아직 구현은 있지만 fixture/flow 검증)**

Run: `cd backend && uv run pytest tests/test_analytics_query_details.py -v`
Expected: PASS (이미 Task 3에서 구현 완료됨 — 이 테스트는 endpoint 배선을 검증)

- [ ] **Step 3: 풀 occurrence 페이로드 테스트 추가**

위 파일에 이어서 추가:

```python
@pytest.mark.asyncio
async def test_query_details_returns_full_occurrence_payload(
    async_client, override_admin_auth
):
    user_msg_id = uuid.uuid4()
    assistant_msg_id = uuid.uuid4()
    session_id = uuid.uuid4()
    chatbot_id = uuid.uuid4()
    event_id = uuid.uuid4()
    asked_at = datetime(2026, 4, 21, 10, 0, 0)
    feedback_at = datetime(2026, 4, 21, 10, 1, 30)

    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_query_details.return_value = {
        "query_text": "천일국의 구원 조건은?",
        "total_count": 1,
        "returned_count": 1,
        "days": 30,
        "occurrences": [
            {
                "search_event_id": event_id,
                "user_message_id": user_msg_id,
                "assistant_message_id": assistant_msg_id,
                "session_id": session_id,
                "chatbot_id": chatbot_id,
                "chatbot_name": "기본 챗봇",
                "asked_at": asked_at,
                "rewritten_query": "천일국 구원 조건",
                "search_tier": 0,
                "total_results": 5,
                "latency_ms": 342,
                "applied_filters": {"sources": ["A"]},
                "answer_text": "천일국의 구원 조건은 ...",
                "citations": [
                    {
                        "source": "A",
                        "volume": 1,
                        "chapter": "제3장",
                        "text_snippet": "원문 발췌...",
                        "relevance_score": 0.87,
                        "rank_position": 0,
                    }
                ],
                "feedback": {
                    "feedback_type": "INACCURATE",
                    "comment": "답이 이상해요",
                    "created_at": feedback_at,
                },
            }
        ],
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/query-details",
                params={"query_text": "천일국의 구원 조건은?", "days": 30},
            )
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total_count"] == 1
    assert body["returned_count"] == 1
    occ = body["occurrences"][0]
    assert occ["chatbot_name"] == "기본 챗봇"
    assert occ["rewritten_query"] == "천일국 구원 조건"
    assert occ["answer_text"].startswith("천일국의 구원 조건")
    assert len(occ["citations"]) == 1
    assert occ["citations"][0]["source"] == "A"
    assert occ["citations"][0]["rank_position"] == 0
    assert occ["feedback"]["feedback_type"] == "INACCURATE"
```

- [ ] **Step 4: 답변 없음 / 챗봇 삭제 케이스 테스트 추가**

```python
@pytest.mark.asyncio
async def test_query_details_handles_missing_answer_and_deleted_bot(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_query_details.return_value = {
        "query_text": "안녕",
        "total_count": 1,
        "returned_count": 1,
        "days": 30,
        "occurrences": [
            {
                "search_event_id": uuid.uuid4(),
                "user_message_id": uuid.uuid4(),
                "assistant_message_id": None,
                "session_id": uuid.uuid4(),
                "chatbot_id": None,
                "chatbot_name": None,
                "asked_at": datetime(2026, 4, 20, 9, 0, 0),
                "rewritten_query": None,
                "search_tier": 0,
                "total_results": 0,
                "latency_ms": 120,
                "applied_filters": {},
                "answer_text": None,
                "citations": [],
                "feedback": None,
            }
        ],
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/query-details",
                params={"query_text": "안녕"},
            )
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    occ = resp.json()["occurrences"][0]
    assert occ["answer_text"] is None
    assert occ["chatbot_name"] is None
    assert occ["citations"] == []
    assert occ["feedback"] is None
```

- [ ] **Step 5: 인증 미통과 케이스 테스트 추가**

```python
@pytest.mark.asyncio
async def test_query_details_requires_admin_auth(async_client):
    # admin 오버라이드 없음 → get_current_admin이 쿠키 없음으로 401 발생
    repo = AsyncMock(spec=AnalyticsRepository)
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/query-details",
                params={"query_text": "x"},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 401
```

- [ ] **Step 6: 쿼리 파라미터 validation 테스트 추가**

```python
@pytest.mark.asyncio
async def test_query_details_rejects_empty_query_text(async_client, override_admin_auth):
    async with async_client as client:
        resp = await client.get(
            "/admin/analytics/search/query-details",
            params={"query_text": ""},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_query_details_respects_days_param(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_query_details.return_value = {
        "query_text": "foo",
        "total_count": 0,
        "returned_count": 0,
        "days": 7,
        "occurrences": [],
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/query-details",
                params={"query_text": "foo", "days": 7, "limit": 10},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_query_details.assert_awaited_once_with("foo", 7, 10)
```

- [ ] **Step 7: 전체 테스트 실행 & 통과 확인**

Run: `cd backend && uv run pytest tests/test_analytics_query_details.py -v`
Expected: 6 tests PASS

- [ ] **Step 8: 커밋**

```bash
git add backend/tests/test_analytics_query_details.py
git commit -m "test(analytics): integration tests for query-details endpoint"
```

---

## Task 5: Backend — 로컬 스모크 테스트 (수동 검증)

**Files:** (없음, 수동 실행)

Repository의 실제 SQL은 단위 테스트로 검증이 어려우므로 로컬 PostgreSQL에 실제 데이터가 있는 환경에서 수동 확인한다.

- [ ] **Step 1: 백엔드 로컬 실행**

Run: `cd backend && uv run uvicorn main:app --reload --port 8000`
Expected: 정상 시작 (log에 `Application startup complete`)

- [ ] **Step 2: 관리자 로그인 쿠키 획득**

```bash
curl -i -c /tmp/admin-cookie.txt -X POST http://localhost:8000/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<관리자 이메일>","password":"<비번>"}'
```
Expected: `Set-Cookie: access_token=...` 포함된 200 응답

- [ ] **Step 3: Top 10에 있는 질문 하나로 엔드포인트 호출**

```bash
# 예: "안녕"처럼 간단한 질문
curl -s -b /tmp/admin-cookie.txt \
  "http://localhost:8000/admin/analytics/search/query-details?query_text=%EC%95%88%EB%85%95&days=30&limit=50" | jq .
```
Expected:
- `total_count >= 1`
- `occurrences[0]`에 `chatbot_name`, `answer_text`, `citations`(있다면) 노출
- 에러 없이 정상 JSON 반환

- [ ] **Step 4: 존재하지 않는 질문 확인**

```bash
curl -s -b /tmp/admin-cookie.txt \
  "http://localhost:8000/admin/analytics/search/query-details?query_text=xxxxxxxxx-없는질문" | jq .
```
Expected: `total_count: 0, occurrences: []`

- [ ] **Step 5: 이슈 있으면 수정 후 재배포, 없으면 다음 Task로**

(스모크 실패 시 Task 2 쿼리 로직을 조정. 예: PostgreSQL JSONB 바인딩 이슈, LATERAL JOIN 이슈 등은 로그 확인 후 수정 — 별도 커밋)

---

## Task 6: Frontend — 타입 정의

**Files:**
- Modify: `admin/src/features/analytics/types.ts`

- [ ] **Step 1: 타입 추가**

파일 끝에 추가:

```typescript
// admin/src/features/analytics/types.ts 에 추가

export interface CitationItem {
  source: string;
  volume: number;
  chapter: string | null;
  text_snippet: string;
  relevance_score: number;
  rank_position: number;
}

export interface FeedbackItem {
  feedback_type: string;
  comment: string | null;
  created_at: string;
}

export interface QueryOccurrence {
  search_event_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  session_id: string;
  chatbot_id: string | null;
  chatbot_name: string | null;
  asked_at: string;
  rewritten_query: string | null;
  search_tier: number;
  total_results: number;
  latency_ms: number;
  applied_filters: Record<string, unknown>;
  answer_text: string | null;
  citations: CitationItem[];
  feedback: FeedbackItem | null;
}

export interface QueryDetail {
  query_text: string;
  total_count: number;
  returned_count: number;
  days: number;
  occurrences: QueryOccurrence[];
}
```

- [ ] **Step 2: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: 커밋**

```bash
git add admin/src/features/analytics/types.ts
git commit -m "feat(analytics): add query detail types"
```

---

## Task 7: Frontend — API 클라이언트 함수 추가

**Files:**
- Modify: `admin/src/features/analytics/api.ts`

- [ ] **Step 1: 임포트에 QueryDetail 추가**

`admin/src/features/analytics/api.ts:2-9` 임포트 블록을 수정:

```typescript
import type {
  DashboardSummary,
  DailyCount,
  SearchStats,
  TopQuery,
  FeedbackSummary,
  NegativeFeedbackItem,
  QueryDetail,
} from "./types";
```

- [ ] **Step 2: API 메서드 추가**

`analyticsAPI` 객체의 끝(`getNegativeFeedback` 다음)에 추가:

```typescript
  getQueryDetails: (queryText: string, days = 30, limit = 50) =>
    fetchAPI<QueryDetail>(
      `/admin/analytics/search/query-details?query_text=${encodeURIComponent(
        queryText
      )}&days=${days}&limit=${limit}`
    ),
```

- [ ] **Step 3: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: 커밋**

```bash
git add admin/src/features/analytics/api.ts
git commit -m "feat(analytics): add getQueryDetails API client"
```

---

## Task 8: Frontend — QueryDetailOccurrence 컴포넌트 (아코디언 아이템)

**Files:**
- Create: `admin/src/features/analytics/components/query-detail-occurrence.tsx`

단일 발생 하나를 렌더링하는 아코디언 아이템 컴포넌트. 펼침 상태는 props로 제어한다.

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// admin/src/features/analytics/components/query-detail-occurrence.tsx
"use client";

import { ChevronDown, ChevronRight, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { QueryOccurrence } from "@/features/analytics/types";

interface Props {
  index: number;
  occurrence: QueryOccurrence;
  expanded: boolean;
  onToggle: () => void;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function FeedbackIcon({ type }: { type: string | undefined }) {
  if (!type) {
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" aria-label="피드백 없음" />;
  }
  if (type.toUpperCase() === "HELPFUL") {
    return <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" aria-label="도움됨" />;
  }
  return <ThumbsDown className="h-3.5 w-3.5 text-rose-600" aria-label="부정 피드백" />;
}

export default function QueryDetailOccurrence({
  index,
  occurrence,
  expanded,
  onToggle,
}: Props) {
  const botLabel = occurrence.chatbot_name ?? "(삭제된 봇)";
  const feedbackType = occurrence.feedback?.feedback_type;

  const headerId = `occ-header-${index}`;
  const panelId = `occ-panel-${index}`;

  return (
    <div className="rounded-lg border bg-card">
      <button
        id={headerId}
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-xs text-muted-foreground w-6 shrink-0">
          #{index + 1}
        </span>
        <Badge variant="outline" className="shrink-0 text-xs">
          {botLabel}
        </Badge>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDateTime(occurrence.asked_at)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <FeedbackIcon type={feedbackType} />
        </span>
      </button>

      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="border-t px-4 py-4 space-y-4 text-sm"
        >
          {/* 검색 메타 */}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>tier {occurrence.search_tier}</span>
            <span>·</span>
            <span>{occurrence.total_results}건</span>
            <span>·</span>
            <span>{occurrence.latency_ms} ms</span>
            {occurrence.rewritten_query && (
              <>
                <span>·</span>
                <span>
                  재작성:{" "}
                  <span className="text-foreground">
                    &ldquo;{occurrence.rewritten_query}&rdquo;
                  </span>
                </span>
              </>
            )}
          </div>

          {/* 답변 */}
          <div className="space-y-1">
            <h3 className="text-xs font-semibold text-muted-foreground">답변</h3>
            {occurrence.answer_text ? (
              <p className="whitespace-pre-wrap leading-relaxed">
                {occurrence.answer_text}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                답변이 저장되지 않았습니다
              </p>
            )}
          </div>

          {/* 출처 */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              매칭 출처 ({occurrence.citations.length}건)
            </h3>
            {occurrence.citations.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                매칭된 출처가 없습니다
              </p>
            ) : (
              <ol className="space-y-2">
                {occurrence.citations.map((c, i) => (
                  <li
                    key={`${c.source}-${c.volume}-${c.rank_position}-${i}`}
                    className="rounded-md border bg-muted/30 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">#{c.rank_position + 1}</span>
                      <Badge variant="outline" className="text-xs">
                        {c.source}
                      </Badge>
                      <span>권 {c.volume}</span>
                      {c.chapter && <span>· {c.chapter}</span>}
                      <span className="ml-auto font-mono">
                        score {c.relevance_score.toFixed(3)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">
                      {c.text_snippet}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* 피드백 */}
          {occurrence.feedback && (
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-muted-foreground">피드백</h3>
              <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {occurrence.feedback.feedback_type}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDateTime(occurrence.feedback.created_at)}
                  </span>
                </div>
                {occurrence.feedback.comment && (
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {occurrence.feedback.comment}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: 커밋**

```bash
git add admin/src/features/analytics/components/query-detail-occurrence.tsx
git commit -m "feat(analytics): add query detail occurrence accordion item"
```

---

## Task 9: Frontend — QueryDetailModal 컴포넌트

**Files:**
- Create: `admin/src/features/analytics/components/query-detail-modal.tsx`

- [ ] **Step 1: 모달 컴포넌트 작성**

```typescript
// admin/src/features/analytics/components/query-detail-modal.tsx
"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { analyticsAPI } from "@/features/analytics/api";
import QueryDetailOccurrence from "./query-detail-occurrence";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queryText: string | null;
  days?: number;
}

export default function QueryDetailModal({
  open,
  onOpenChange,
  queryText,
  days = 30,
}: Props) {
  const enabled = open && !!queryText;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["query-details", queryText, days],
    queryFn: () => analyticsAPI.getQueryDetails(queryText!, days),
    enabled,
    staleTime: 30_000,
  });

  // 모달이 다시 열릴 때 펼침 상태 초기화
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  useEffect(() => {
    if (open && data) {
      setExpanded({ 0: true }); // 첫 발생만 기본 펼침
    }
  }, [open, data]);

  const toggle = (i: number) =>
    setExpanded((prev) => ({ ...prev, [i]: !prev[i] }));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 m-auto flex h-fit max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-popover shadow-2xl transition duration-200 data-ending-style:opacity-0 data-ending-style:scale-95 data-starting-style:opacity-0 data-starting-style:scale-95">
          {/* 헤더 */}
          <div className="flex items-start justify-between border-b px-6 py-4 gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold line-clamp-2 break-words">
                {queryText ?? "질문 상세"}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground mt-1">
                {data
                  ? `총 ${data.total_count}건 발생 · 최근 ${data.days}일` +
                    (data.total_count > data.returned_count
                      ? ` (상위 ${data.returned_count}건만 표시)`
                      : "")
                  : "불러오는 중..."}
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* 본문 */}
          <div className="overflow-y-auto px-6 py-4 space-y-3">
            {isLoading && (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center gap-3 py-10">
                <p className="text-sm text-muted-foreground">
                  상세 정보를 불러오지 못했습니다
                </p>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  다시 시도
                </Button>
              </div>
            )}

            {!isLoading && !isError && data && data.occurrences.length === 0 && (
              <p className="text-sm text-muted-foreground py-10 text-center">
                최근 {days}일 내 발생이 없습니다
              </p>
            )}

            {!isLoading &&
              !isError &&
              data &&
              data.occurrences.map((occ, i) => (
                <QueryDetailOccurrence
                  key={occ.search_event_id}
                  index={i}
                  occurrence={occ}
                  expanded={!!expanded[i]}
                  onToggle={() => toggle(i)}
                />
              ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: 커밋**

```bash
git add admin/src/features/analytics/components/query-detail-modal.tsx
git commit -m "feat(analytics): add query detail modal container"
```

---

## Task 10: Frontend — Analytics 페이지 통합 (모달 연결)

**Files:**
- Modify: `admin/src/app/(dashboard)/analytics/page.tsx`

`TopQueriesTable`의 각 행에 onClick을 붙이고, 페이지 최상단 `AnalyticsPage`에서 `selectedQuery` state를 관리하여 `QueryDetailModal`을 렌더링한다.

- [ ] **Step 1: 임포트 추가**

`admin/src/app/(dashboard)/analytics/page.tsx:1-14` 블록을 수정:

```typescript
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { analyticsAPI } from "@/features/analytics/api";
import type { SearchStats, DailyCount, TopQuery } from "@/features/analytics/types";
import { Skeleton } from "@/components/ui/skeleton";
import QueryDetailModal from "@/features/analytics/components/query-detail-modal";
```

- [ ] **Step 2: `TopQueriesTable` 시그니처 및 행 onClick 추가**

`admin/src/app/(dashboard)/analytics/page.tsx:95-147` 블록을 아래로 교체:

```typescript
function TopQueriesTable({
  queries,
  loading,
  onSelect,
}: {
  queries?: TopQuery[];
  loading: boolean;
  onSelect: (queryText: string) => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold">인기 질문 Top 10</h2>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : !queries || queries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          인기 질문이 없습니다
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-10">
                  순위
                </th>
                <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                  질문
                </th>
                <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-16">
                  횟수
                </th>
              </tr>
            </thead>
            <tbody>
              {queries.map((q, i) => (
                <tr
                  key={i}
                  className={
                    (i !== 0 ? "border-t " : "") +
                    "cursor-pointer hover:bg-muted/40 transition-colors"
                  }
                  onClick={() => onSelect(q.query_text)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(q.query_text);
                    }
                  }}
                  title="클릭하면 상세 정보를 확인할 수 있습니다"
                >
                  <td className="py-2 px-3 text-muted-foreground font-mono text-xs">
                    {i + 1}
                  </td>
                  <td className="py-2 px-3 truncate max-w-0 w-full">
                    <span className="block truncate" title={q.query_text}>
                      {q.query_text}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {q.count.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 페이지 컴포넌트에서 state + 모달 렌더링**

`AnalyticsPage` 함수 상단(`const { data: stats ...` 위)에 상태 추가:

```typescript
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
```

그리고 `TopQueriesTable` 사용처(파일 하단의 `<FallbackDistribution ... />` 옆)를 수정:

```typescript
        <FallbackDistribution stats={stats} loading={statsLoading} />
        <TopQueriesTable
          queries={topQueries}
          loading={topQueriesLoading}
          onSelect={(q) => setSelectedQuery(q)}
        />
```

마지막 `</div>` 바로 전에 모달 추가:

```typescript
      <QueryDetailModal
        open={selectedQuery !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedQuery(null);
        }}
        queryText={selectedQuery}
        days={30}
      />
```

- [ ] **Step 4: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 5: dev 서버 실행 + 수동 UI 확인**

Run: `cd admin && pnpm dev`

브라우저 `http://localhost:3000/analytics` 열고:
1. 로그인 상태인지 확인
2. 인기 질문 Top 10의 한 행 클릭 → 모달 오픈
3. 첫 발생 펼침 + 나머지 접힘 확인
4. 아코디언 토글 확인
5. Esc / × / 백드롭 클릭으로 닫기 확인
6. 다른 행 클릭 시 새 데이터로 모달 오픈

Expected: 모든 인터랙션 정상, 콘솔 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add admin/src/app/\(dashboard\)/analytics/page.tsx
git commit -m "feat(analytics): open query detail modal from top queries table"
```

---

## Task 11: Frontend — 모달 Vitest 테스트

**Files:**
- Create: `admin/src/test/query-detail-modal.test.tsx`

- [ ] **Step 1: 테스트 작성**

```typescript
// admin/src/test/query-detail-modal.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryDetail } from "@/features/analytics/types";

const mockGetQueryDetails = vi.fn();
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getQueryDetails: (...args: unknown[]) => mockGetQueryDetails(...args),
  },
}));

import QueryDetailModal from "@/features/analytics/components/query-detail-modal";

function renderModal(props: Partial<React.ComponentProps<typeof QueryDetailModal>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QueryDetailModal
        open={true}
        onOpenChange={() => {}}
        queryText="천일국"
        days={30}
        {...props}
      />
    </QueryClientProvider>
  );
}

function occurrenceFixture(
  overrides: Partial<QueryDetail["occurrences"][number]> = {}
): QueryDetail["occurrences"][number] {
  return {
    search_event_id: "11111111-1111-1111-1111-111111111111",
    user_message_id: "22222222-2222-2222-2222-222222222222",
    assistant_message_id: "33333333-3333-3333-3333-333333333333",
    session_id: "44444444-4444-4444-4444-444444444444",
    chatbot_id: "55555555-5555-5555-5555-555555555555",
    chatbot_name: "기본 챗봇",
    asked_at: "2026-04-21T10:00:00",
    rewritten_query: null,
    search_tier: 0,
    total_results: 3,
    latency_ms: 200,
    applied_filters: {},
    answer_text: "천일국이란...",
    citations: [
      {
        source: "A",
        volume: 1,
        chapter: "제3장",
        text_snippet: "원문 스니펫",
        relevance_score: 0.87,
        rank_position: 0,
      },
    ],
    feedback: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetQueryDetails.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("QueryDetailModal", () => {
  it("로딩 중엔 스켈레톤을 렌더한다", () => {
    mockGetQueryDetails.mockReturnValue(new Promise(() => {})); // pending
    const { container } = renderModal();
    expect(container.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length).toBeGreaterThan(0);
  });

  it("occurrences가 0건이면 안내 문구를 노출한다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 0,
      returned_count: 0,
      days: 30,
      occurrences: [],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/발생이 없습니다/)).toBeDefined();
  });

  it("첫 번째 발생은 기본으로 펼쳐져 답변과 출처를 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [occurrenceFixture()],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText("천일국이란...")).toBeDefined();
    expect(screen.getByText(/매칭 출처/)).toBeDefined();
    expect(screen.getByText("원문 스니펫")).toBeDefined();
  });

  it("답변이 없는 발생은 '답변이 저장되지 않았습니다' 플레이스홀더를 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [
        occurrenceFixture({
          assistant_message_id: null,
          answer_text: null,
          citations: [],
        }),
      ],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/답변이 저장되지 않았습니다/)).toBeDefined();
    expect(screen.getByText(/매칭된 출처가 없습니다/)).toBeDefined();
  });

  it("봇이 삭제된 발생은 '(삭제된 봇)' 라벨을 보여준다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 1,
      returned_count: 1,
      days: 30,
      occurrences: [occurrenceFixture({ chatbot_name: null })],
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText("(삭제된 봇)")).toBeDefined();
  });

  it("total_count > returned_count 일 때 상위 N건 표시 문구가 노출된다", async () => {
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 120,
      returned_count: 50,
      days: 30,
      occurrences: Array.from({ length: 50 }, (_, i) =>
        occurrenceFixture({
          search_event_id: `event-${i}`,
        })
      ),
    } satisfies QueryDetail);

    renderModal();
    expect(await screen.findByText(/상위 50건만 표시/)).toBeDefined();
  });

  it("두 번째 발생 헤더를 클릭하면 본문이 펼쳐진다", async () => {
    const user = userEvent.setup();
    mockGetQueryDetails.mockResolvedValue({
      query_text: "천일국",
      total_count: 2,
      returned_count: 2,
      days: 30,
      occurrences: [
        occurrenceFixture({
          search_event_id: "a",
          answer_text: "첫 번째 답",
        }),
        occurrenceFixture({
          search_event_id: "b",
          answer_text: "두 번째 답",
        }),
      ],
    } satisfies QueryDetail);

    renderModal();
    await screen.findByText("첫 번째 답"); // #1 펼침 확인
    expect(screen.queryByText("두 번째 답")).toBeNull();

    const headers = screen.getAllByRole("button", { expanded: false });
    // 첫 번째 false-expanded 버튼 = 두 번째 발생 헤더
    await user.click(headers[0]);
    expect(await screen.findByText("두 번째 답")).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd admin && pnpm test src/test/query-detail-modal.test.tsx`
Expected: 7 tests PASS

- [ ] **Step 3: 커밋**

```bash
git add admin/src/test/query-detail-modal.test.tsx
git commit -m "test(analytics): add query detail modal vitest cases"
```

---

## Task 12: 최종 검증 & 회귀 테스트

**Files:** (없음, 검증)

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `cd backend && uv run pytest tests/ -q`
Expected: 기존 테스트 + Task 4 신규 6건 모두 PASS

- [ ] **Step 2: 프론트엔드 전체 테스트**

Run: `cd admin && pnpm test`
Expected: 기존 테스트 + Task 11 신규 7건 모두 PASS

- [ ] **Step 3: 프론트 타입체크 & 린트**

Run: `cd admin && pnpm tsc --noEmit && pnpm lint`
Expected: no errors

- [ ] **Step 4: 브라우저에서 end-to-end 수동 확인**

1. `pnpm dev` 실행
2. `/analytics` 페이지 이동
3. Top 10의 다른 질문 3개 열어보기
4. 답변 null, 피드백 null, 봇 없음 같은 에지 케이스가 데이터에 있다면 깨지지 않는지 확인
5. 네트워크 탭에서 모달이 처음 열릴 때만 요청 1회, 다시 열면 캐시 재사용(30초 이내) 확인

- [ ] **Step 5: 변경 파일 전체 diff 확인 & PR 생성 준비**

Run: `git log --oneline main..HEAD`
Expected: Task 1~11의 커밋 9~11개

---

## Done Criteria

- 인기 질문 Top 10 행 클릭 → 모달 오픈 → 모든 발생을 아코디언으로 펼쳐봄 가능
- 각 발생의 봇명/시간/재작성쿼리/검색지표/답변/매칭 출처/피드백을 확인 가능
- 답변·출처·피드백 누락 / 봇 삭제 에지 케이스에서 모달이 깨지지 않음
- pytest 6건 + vitest 7건 신규 테스트 모두 통과
- 타입체크·린트 통과
