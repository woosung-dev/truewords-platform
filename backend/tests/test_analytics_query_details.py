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
