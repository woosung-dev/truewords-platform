"""채팅 Service. 검색 + 생성 + DB 기록 오케스트레이션."""

import time
import uuid

from src.chat.generator import generate_answer
from src.chat.models import (
    AnswerCitation,
    AnswerFeedback,
    MessageRole,
    ResearchSession,
    SearchEvent,
    SessionMessage,
)
from src.chat.repository import ChatRepository
from src.chat.schemas import ChatRequest, ChatResponse, FeedbackRequest, Source
from src.chatbot.service import ChatbotService
from src.qdrant_client import get_async_client
from src.search.cascading import cascading_search


class ChatService:
    def __init__(
        self,
        chat_repo: ChatRepository,
        chatbot_service: ChatbotService,
    ) -> None:
        self.chat_repo = chat_repo
        self.chatbot_service = chatbot_service

    async def process_chat(self, request: ChatRequest) -> ChatResponse:
        """채팅 처리: 세션 관리 → 검색 → 생성 → DB 기록."""
        # 1. 세션 판단
        session = await self._get_or_create_session(request)

        # 2. 사용자 메시지 저장
        user_msg = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.USER,
                content=request.query,
            )
        )
        await self.chat_repo.commit()

        # 3. 검색 실행
        qdrant = get_async_client()
        cascading_config = await self.chatbot_service.get_cascading_config(request.chatbot_id)

        start_time = time.monotonic()
        results = await cascading_search(qdrant, request.query, cascading_config, top_k=10)
        latency_ms = int((time.monotonic() - start_time) * 1000)

        # 4. 답변 생성
        answer = await generate_answer(request.query, results)

        # 5. 답변 메시지 저장
        assistant_msg = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.ASSISTANT,
                content=answer,
            )
        )
        await self.chat_repo.commit()

        # 6. 검색 이벤트 + 인용 기록 (동기로 — 응답 반환 전 기록)
        await self._record_search_event(assistant_msg.id, request, results, latency_ms)
        await self._record_citations(assistant_msg.id, results)
        await self.chat_repo.commit()

        # 7. 응답 반환
        return ChatResponse(
            answer=answer,
            sources=[
                Source(
                    volume=r.volume,
                    text=r.text,
                    score=r.score,
                    source=r.source,
                )
                for r in results[:3]
            ],
            session_id=session.id,
            message_id=assistant_msg.id,
        )

    async def get_session_history(self, session_id: uuid.UUID) -> dict:
        """세션 대화 이력 조회."""
        session = await self.chat_repo.get_session(session_id)
        if session is None:
            return {"session_id": session_id, "messages": []}
        messages = await self.chat_repo.get_messages_by_session(session_id)
        return {
            "session_id": session_id,
            "messages": [
                {"role": m.role, "content": m.content, "created_at": str(m.created_at)}
                for m in messages
            ],
        }

    async def submit_feedback(self, request: FeedbackRequest) -> AnswerFeedback:
        """답변 피드백 제출."""
        feedback = AnswerFeedback(
            message_id=request.message_id,
            feedback_type=request.feedback_type,
            comment=request.comment,
        )
        saved = await self.chat_repo.create_feedback(feedback)
        await self.chat_repo.commit()
        return saved

    # --- Private ---

    async def _get_or_create_session(self, request: ChatRequest) -> ResearchSession:
        """세션 ID가 있으면 기존 세션, 없으면 새로 생성."""
        if request.session_id:
            session = await self.chat_repo.get_session(request.session_id)
            if session:
                return session

        config_id = await self.chatbot_service.get_config_id(request.chatbot_id)
        # config_id가 None이면 기본 chatbot_config를 사용하거나 없이 생성
        session = ResearchSession(
            chatbot_config_id=config_id or uuid.uuid4(),
            client_fingerprint=None,
        )
        return await self.chat_repo.create_session(session)

    async def _record_search_event(
        self,
        message_id: uuid.UUID,
        request: ChatRequest,
        results: list,
        latency_ms: int,
    ) -> None:
        event = SearchEvent(
            message_id=message_id,
            query_text=request.query,
            applied_filters={"chatbot_id": request.chatbot_id},
            total_results=len(results),
            latency_ms=latency_ms,
        )
        await self.chat_repo.create_search_event(event)

    async def _record_citations(
        self, message_id: uuid.UUID, results: list
    ) -> None:
        citations = [
            AnswerCitation(
                message_id=message_id,
                source=r.source,
                volume=int(r.volume) if r.volume.isdigit() else 0,
                text_snippet=r.text[:500],
                relevance_score=r.score,
                rank_position=i,
            )
            for i, r in enumerate(results[:5])
        ]
        if citations:
            await self.chat_repo.create_citations(citations)
