"""Analytics sessions/{id} 엔드포인트 + negative feedback 의 session_id 추적성 테스트."""

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
async def test_session_detail_returns_404_when_missing(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_session_detail.return_value = None
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                f"/admin/analytics/sessions/{uuid.uuid4()}"
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "session not found"
    finally:
        _clear_repo_override()


@pytest.mark.asyncio
async def test_session_detail_returns_messages_with_reactions_and_feedback(
    async_client, override_admin_auth
):
    session_id = uuid.uuid4()
    user_msg_id = uuid.uuid4()
    asst_msg_id = uuid.uuid4()
    chatbot_id = uuid.uuid4()

    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_session_detail.return_value = {
        "session_id": session_id,
        "chatbot_id": chatbot_id,
        "chatbot_name": "축복AI",
        "started_at": datetime(2026, 5, 3, 9, 0, 0),
        "ended_at": None,
        "messages": [
            {
                "id": user_msg_id,
                "role": "user",
                "content": "축복 절차에 대해서 알려줘",
                "created_at": datetime(2026, 5, 3, 9, 6, 0),
                "resolved_answer_mode": None,
                "persona_overridden": None,
                "reactions": [],
                "feedback": None,
                "citations": [],
            },
            {
                "id": asst_msg_id,
                "role": "assistant",
                "content": "축복 절차는 다음과 같습니다...",
                "created_at": datetime(2026, 5, 3, 9, 6, 5),
                "resolved_answer_mode": "default",
                "persona_overridden": False,
                "reactions": [{"kind": "thumbs_down", "count": 1}],
                "feedback": {
                    "feedback_type": "inaccurate",
                    "comment": "정확하지 않음",
                    "created_at": datetime(2026, 5, 3, 9, 7, 0),
                },
                "citations": [
                    {
                        "source": "B",
                        "volume": 5,
                        "chapter": None,
                        "text_snippet": "참어머님 말씀...",
                        "relevance_score": 0.5,
                        "rank_position": 1,
                    }
                ],
            },
        ],
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(f"/admin/analytics/sessions/{session_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["session_id"] == str(session_id)
        assert body["chatbot_name"] == "축복AI"
        assert len(body["messages"]) == 2
        assert body["messages"][0]["role"] == "user"
        assert body["messages"][1]["role"] == "assistant"
        assert body["messages"][1]["reactions"] == [
            {"kind": "thumbs_down", "count": 1}
        ]
        assert body["messages"][1]["feedback"]["feedback_type"] == "inaccurate"
        assert len(body["messages"][1]["citations"]) == 1
    finally:
        _clear_repo_override()


@pytest.mark.asyncio
async def test_negative_feedback_includes_session_id_for_drilldown(
    async_client, override_admin_auth
):
    """피드백 row 에서 모달 진입에 필요한 session_id + chatbot_name 노출 확인."""
    feedback_id = uuid.uuid4()
    session_id = uuid.uuid4()

    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_feedback_list.return_value = [
        {
            "id": feedback_id,
            "session_id": session_id,
            "chatbot_name": "축복AI",
            "question": "축복 절차?",
            "answer_snippet": "축복 절차는...",
            "feedback_type": "inaccurate",
            "comment": None,
            "created_at": datetime(2026, 5, 3, 9, 7, 0),
        }
    ]
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/feedback/negative", params={"limit": 20}
            )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["session_id"] == str(session_id)
        assert items[0]["chatbot_name"] == "축복AI"
        # repo 가 polarity="negative" 로 호출됐는지
        repo.get_feedback_list.assert_called_with("negative", 20, 0)
    finally:
        _clear_repo_override()


@pytest.mark.asyncio
async def test_feedback_list_supports_positive_polarity(
    async_client, override_admin_auth
):
    """긍정 피드백 (polarity=positive) 도 동일 schema 로 반환."""
    feedback_id = uuid.uuid4()
    session_id = uuid.uuid4()

    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_feedback_list.return_value = [
        {
            "id": feedback_id,
            "session_id": session_id,
            "chatbot_name": "축복AI",
            "question": "감사합니다",
            "answer_snippet": "도움이 되어 기쁩니다",
            "feedback_type": "helpful",
            "comment": "정확했어요",
            "created_at": datetime(2026, 5, 3, 9, 8, 0),
        }
    ]
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/feedback/list",
                params={"polarity": "positive", "limit": 10},
            )
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["feedback_type"] == "helpful"
        repo.get_feedback_list.assert_called_with("positive", 10, 0)
    finally:
        _clear_repo_override()


@pytest.mark.asyncio
async def test_feedback_list_rejects_invalid_polarity(
    async_client, override_admin_auth
):
    """폴라리티 값이 positive/negative 외엔 422."""
    repo = AsyncMock(spec=AnalyticsRepository)
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/feedback/list",
                params={"polarity": "neutral"},
            )
        assert resp.status_code == 422
    finally:
        _clear_repo_override()
