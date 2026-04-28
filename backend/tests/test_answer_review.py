"""P1-K — AnswerReview 모델/스키마/서비스/라우터 테스트.

전체 통합 테스트 (실제 DB) 는 chatbot_configs/research_sessions FK 의존이라
무거우므로 테이블 차원의 검증은 별도 PR. 본 모듈은:
  - ReviewLabel enum 안정성
  - Pydantic 스키마 검증
  - AnswerReview SQLModel 인스턴스화
  - Repository CRUD (AsyncMock 기반)
  - Endpoint 4가지 (queue / create / stats / 잘못된 label)
"""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from src.admin.answer_review_repository import AnswerReviewRepository
from src.admin.answer_review_schemas import (
    AnswerReviewCreate,
    AnswerReviewResponse,
    ReviewQueueItem,
    ReviewStatsResponse,
)
from src.admin.answer_review_service import AnswerReviewService
from src.chat.models import AnswerReview, ReviewLabel


# ---------------------------------------------------------------------------
# enum 안정성
# ---------------------------------------------------------------------------


class TestReviewLabelEnum:
    def test_approved_value(self) -> None:
        assert ReviewLabel.APPROVED.value == "approved"

    def test_theological_error_value(self) -> None:
        assert ReviewLabel.THEOLOGICAL_ERROR.value == "theological_error"

    def test_five_labels_only(self) -> None:
        assert {label.value for label in ReviewLabel} == {
            "approved",
            "theological_error",
            "citation_error",
            "tone_error",
            "off_domain",
        }


# ---------------------------------------------------------------------------
# Pydantic 스키마
# ---------------------------------------------------------------------------


class TestAnswerReviewCreate:
    def test_valid_payload(self) -> None:
        payload = AnswerReviewCreate(
            message_id=uuid.uuid4(),
            label="approved",
            notes="OK",
        )
        assert payload.label == "approved"
        assert payload.notes == "OK"

    def test_invalid_label_rejected(self) -> None:
        with pytest.raises(ValidationError):
            AnswerReviewCreate(
                message_id=uuid.uuid4(),
                label="heresy",  # type: ignore[arg-type]
            )

    def test_notes_optional(self) -> None:
        payload = AnswerReviewCreate(
            message_id=uuid.uuid4(),
            label="off_domain",
        )
        assert payload.notes is None


class TestSqlModelInstantiation:
    """DB 없이도 SQLModel 객체가 만들어지는지."""

    def test_instantiate(self) -> None:
        review = AnswerReview(
            message_id=uuid.uuid4(),
            reviewer_user_id=uuid.uuid4(),
            label=ReviewLabel.CITATION_ERROR,
            notes="권 정보가 빠졌음",
        )
        assert review.label == ReviewLabel.CITATION_ERROR
        assert review.notes == "권 정보가 빠졌음"


# ---------------------------------------------------------------------------
# Service / Repository (AsyncMock)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_service_create_review_invokes_repo_and_commits() -> None:
    repo = AsyncMock(spec=AnswerReviewRepository)
    fake_review = AnswerReview(
        message_id=uuid.uuid4(),
        reviewer_user_id=uuid.uuid4(),
        label=ReviewLabel.APPROVED,
        notes=None,
    )
    repo.create.return_value = fake_review

    service = AnswerReviewService(repo)
    resp = await service.create_review(
        message_id=fake_review.message_id,
        reviewer_user_id=fake_review.reviewer_user_id,
        label="approved",
        notes=None,
    )

    repo.create.assert_awaited_once()
    repo.commit.assert_awaited_once()
    assert isinstance(resp, AnswerReviewResponse)
    assert resp.label == "approved"


@pytest.mark.asyncio
async def test_service_get_queue_maps_rows_to_items() -> None:
    repo = AsyncMock(spec=AnswerReviewRepository)
    msg_id = uuid.uuid4()
    sess_id = uuid.uuid4()
    bot_id = uuid.uuid4()
    repo.get_unreviewed_queue.return_value = [
        {
            "message_id": msg_id,
            "session_id": sess_id,
            "chatbot_id": bot_id,
            "question_text": "축복가정이란?",
            "answer_text": "축복가정은…",
            "answered_at": datetime(2026, 4, 28, 10, 0),
            "has_negative_feedback": True,
        }
    ]

    service = AnswerReviewService(repo)
    resp = await service.get_queue(chatbot_id=bot_id, limit=20)

    assert resp.total == 1
    assert isinstance(resp.items[0], ReviewQueueItem)
    assert resp.items[0].has_negative_feedback is True
    repo.get_unreviewed_queue.assert_awaited_once_with(
        chatbot_id=bot_id, limit=20
    )


@pytest.mark.asyncio
async def test_service_get_stats_computes_approval_rate() -> None:
    repo = AsyncMock(spec=AnswerReviewRepository)
    repo.get_stats.return_value = {
        "period_days": 7,
        "total_reviewed": 10,
        "approved_count": 8,
        "rejected_count": 2,
        "approval_rate": 0.8,
        "distribution": [
            {"label": "approved", "count": 8},
            {"label": "tone_error", "count": 2},
        ],
    }
    service = AnswerReviewService(repo)
    resp = await service.get_stats(period_days=7)

    assert isinstance(resp, ReviewStatsResponse)
    assert resp.approval_rate == pytest.approx(0.8)
    assert resp.approved_count == 8
    assert resp.rejected_count == 2
    assert len(resp.distribution) == 2


@pytest.mark.asyncio
async def test_service_get_negative_examples_delegates_to_repo() -> None:
    """negative few-shot 후보 query placeholder — hook 자리 마련 확인."""
    repo = AsyncMock(spec=AnswerReviewRepository)
    fake = AnswerReview(
        message_id=uuid.uuid4(),
        reviewer_user_id=uuid.uuid4(),
        label=ReviewLabel.THEOLOGICAL_ERROR,
        notes="이단성 발언",
    )
    repo.list_negative_examples.return_value = [fake]
    service = AnswerReviewService(repo)

    rows = await service.get_negative_examples(limit=5)

    repo.list_negative_examples.assert_awaited_once_with(limit=5)
    assert rows == [fake]


# ---------------------------------------------------------------------------
# Endpoint level — FastAPI app + dependency override
# ---------------------------------------------------------------------------


with patch("main.init_db", new_callable=AsyncMock):
    from main import app  # noqa: E402

from src.admin.answer_review_router import _get_service  # noqa: E402
from src.admin.dependencies import get_current_admin  # noqa: E402


def _mock_admin_factory():
    admin_id = uuid.uuid4()

    def _admin() -> dict:
        return {"user_id": admin_id, "role": "admin"}

    return _admin, admin_id


@pytest.fixture
def async_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def override_admin_auth():
    admin_callable, admin_id = _mock_admin_factory()
    app.dependency_overrides[get_current_admin] = admin_callable
    yield admin_id
    app.dependency_overrides.pop(get_current_admin, None)


def _override_service(service: AsyncMock) -> None:
    app.dependency_overrides[_get_service] = lambda: service


def _clear_service_override() -> None:
    app.dependency_overrides.pop(_get_service, None)


@pytest.mark.asyncio
async def test_endpoint_queue_returns_items(async_client, override_admin_auth):
    service = AsyncMock(spec=AnswerReviewService)
    msg_id = uuid.uuid4()
    sess_id = uuid.uuid4()
    from src.admin.answer_review_schemas import ReviewQueueResponse

    service.get_queue.return_value = ReviewQueueResponse(
        items=[
            ReviewQueueItem(
                message_id=msg_id,
                session_id=sess_id,
                chatbot_id=None,
                question_text="질문",
                answer_text="답변 내용",
                answered_at=datetime(2026, 4, 28, 12, 0),
                has_negative_feedback=False,
            )
        ],
        total=1,
    )
    _override_service(service)
    try:
        async with async_client as client:
            resp = await client.get("/admin/answer-reviews/queue")
    finally:
        _clear_service_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["message_id"] == str(msg_id)
    service.get_queue.assert_awaited_once_with(chatbot_id=None, limit=20)


@pytest.mark.asyncio
async def test_endpoint_create_review_returns_201(
    async_client, override_admin_auth
):
    admin_id = override_admin_auth
    msg_id = uuid.uuid4()
    review_id = uuid.uuid4()

    service = AsyncMock(spec=AnswerReviewService)
    service.create_review.return_value = AnswerReviewResponse(
        id=review_id,
        message_id=msg_id,
        reviewer_user_id=admin_id,
        label="approved",
        notes="문제 없음",
        created_at=datetime(2026, 4, 28, 12, 30),
    )
    _override_service(service)
    try:
        async with async_client as client:
            resp = await client.post(
                "/admin/answer-reviews",
                json={
                    "message_id": str(msg_id),
                    "label": "approved",
                    "notes": "문제 없음",
                },
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
    finally:
        _clear_service_override()

    assert resp.status_code == 201
    body = resp.json()
    assert body["label"] == "approved"
    assert body["reviewer_user_id"] == str(admin_id)
    service.create_review.assert_awaited_once()
    call_kwargs = service.create_review.await_args.kwargs
    assert call_kwargs["reviewer_user_id"] == admin_id
    assert call_kwargs["label"] == "approved"


@pytest.mark.asyncio
async def test_endpoint_create_review_rejects_invalid_label(
    async_client, override_admin_auth
):
    msg_id = uuid.uuid4()
    service = AsyncMock(spec=AnswerReviewService)
    _override_service(service)
    try:
        async with async_client as client:
            resp = await client.post(
                "/admin/answer-reviews",
                json={
                    "message_id": str(msg_id),
                    "label": "heresy",  # 알 수 없는 라벨
                },
                headers={"X-Requested-With": "XMLHttpRequest"},
            )
    finally:
        _clear_service_override()

    assert resp.status_code == 422
    service.create_review.assert_not_awaited()


@pytest.mark.asyncio
async def test_endpoint_stats_returns_distribution(
    async_client, override_admin_auth
):
    service = AsyncMock(spec=AnswerReviewService)
    from src.admin.answer_review_schemas import ReviewLabelCount

    service.get_stats.return_value = ReviewStatsResponse(
        period_days=7,
        total_reviewed=5,
        approved_count=4,
        rejected_count=1,
        approval_rate=0.8,
        distribution=[
            ReviewLabelCount(label="approved", count=4),
            ReviewLabelCount(label="citation_error", count=1),
        ],
    )
    _override_service(service)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/answer-reviews/stats",
                params={"period": "7d"},
            )
    finally:
        _clear_service_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["period_days"] == 7
    assert body["total_reviewed"] == 5
    assert body["approval_rate"] == pytest.approx(0.8)
    assert len(body["distribution"]) == 2
    service.get_stats.assert_awaited_once_with(period_days=7)


@pytest.mark.asyncio
async def test_endpoint_stats_rejects_bad_period_format(
    async_client, override_admin_auth
):
    service = AsyncMock(spec=AnswerReviewService)
    _override_service(service)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/answer-reviews/stats",
                params={"period": "weekly"},  # pattern 위반
            )
    finally:
        _clear_service_override()
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_endpoint_queue_requires_auth(async_client):
    """admin auth 없으면 401."""
    async with async_client as client:
        resp = await client.get("/admin/answer-reviews/queue")
    assert resp.status_code == 401
