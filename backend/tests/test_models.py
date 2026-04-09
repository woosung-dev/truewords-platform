"""DB 모델 단위 테스트 (테이블 생성 없이 인스턴스 검증)."""

import uuid
from datetime import datetime, timezone

from src.admin.models import AdminRole, AdminUser, AdminAuditLog
from src.chat.models import (
    FeedbackType,
    MessageRole,
    ResearchSession,
    SessionMessage,
    SearchEvent,
    AnswerCitation,
    AnswerFeedback,
)
from src.chatbot.models import ChatbotConfig


def test_admin_user_defaults():
    user = AdminUser(email="admin@test.com", hashed_password="hashed")
    assert user.role == AdminRole.ADMIN
    assert user.is_active is True
    assert user.organization_id is None


def test_chatbot_config_defaults():
    config = ChatbotConfig(
        chatbot_id="test_bot",
        display_name="테스트 봇",
        search_tiers={"tiers": []},
    )
    assert config.is_active is True
    assert config.description == ""


def test_research_session_defaults():
    config_id = uuid.uuid4()
    session = ResearchSession(chatbot_config_id=config_id)
    assert session.user_id is None
    assert session.client_fingerprint is None
    assert session.ended_at is None


def test_session_message_roles():
    msg = SessionMessage(
        session_id=uuid.uuid4(),
        role=MessageRole.USER,
        content="질문입니다",
    )
    assert msg.role == MessageRole.USER
    assert msg.token_count is None


def test_feedback_types():
    feedback = AnswerFeedback(
        message_id=uuid.uuid4(),
        feedback_type=FeedbackType.HELPFUL,
    )
    assert feedback.feedback_type == FeedbackType.HELPFUL
    assert feedback.comment is None
    assert feedback.user_id is None


def test_answer_citation_fields():
    citation = AnswerCitation(
        message_id=uuid.uuid4(),
        source="A",
        volume=45,
        text_snippet="말씀 인용문",
        relevance_score=0.95,
        rank_position=0,
    )
    assert citation.source == "A"
    assert citation.volume == 45
    assert citation.chapter is None


def test_search_event_fields():
    event = SearchEvent(
        message_id=uuid.uuid4(),
        query_text="사랑이란",
        applied_filters={"chatbot_id": "all"},
        total_results=10,
        latency_ms=150,
    )
    assert event.total_results == 10
    assert event.search_tier == 0
