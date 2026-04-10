"""채팅 Service. 검색 + 생성 + DB 기록 오케스트레이션."""

import json
import time
import uuid
from collections.abc import AsyncGenerator

from src.cache.service import SemanticCacheService
from src.chat.generator import generate_answer
from src.chat.stream_generator import generate_answer_stream
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
from src.common.gemini import embed_dense_query
from src.qdrant_client import get_async_client
from src.safety.input_validator import validate_input
from src.safety.output_filter import DISCLAIMER, apply_safety_layer
from src.search.cascading import cascading_search
from src.search.exceptions import EmbeddingFailedError
from src.search.reranker import rerank


class ChatService:
    def __init__(
        self,
        chat_repo: ChatRepository,
        chatbot_service: ChatbotService,
        cache_service: SemanticCacheService | None = None,
    ) -> None:
        self.chat_repo = chat_repo
        self.chatbot_service = chatbot_service
        self.cache_service = cache_service

    async def process_chat(self, request: ChatRequest) -> ChatResponse:
        """RAG 9단계: 입력 검증 → 캐시 체크 → 검색 → Re-ranking → 생성 → Safety → 캐시 저장 → DB 기록."""
        # [Safety] 입력 검증 — Prompt Injection 방어
        await validate_input(request.query)

        # 1. 세션 판단
        session = await self._get_or_create_session(request)

        # 2. 사용자 메시지 저장
        await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.USER,
                content=request.query,
            )
        )

        # [Cache] Step 1 — 캐시 체크 (임베딩은 검색에서 재사용)
        try:
            query_embedding = await embed_dense_query(request.query)
        except Exception as e:
            raise EmbeddingFailedError(f"임베딩 생성 실패: {e}") from e
        if self.cache_service:
            cache_hit = await self.cache_service.check_cache(
                query_embedding, request.chatbot_id
            )
            if cache_hit:
                safe_answer = await apply_safety_layer(cache_hit.answer)
                assistant_msg = await self.chat_repo.create_message(
                    SessionMessage(
                        session_id=session.id,
                        role=MessageRole.ASSISTANT,
                        content=safe_answer,
                    )
                )
                await self.chat_repo.commit()
                return ChatResponse(
                    answer=safe_answer,
                    sources=[Source(**s) for s in cache_hit.sources],
                    session_id=session.id,
                    message_id=assistant_msg.id,
                )

        # 3. 검색 실행 (넓은 후보 풀)
        qdrant = get_async_client()
        cascading_config, rerank_enabled = await self.chatbot_service.get_search_config(
            request.chatbot_id
        )

        start_time = time.monotonic()
        results = await cascading_search(
            qdrant, request.query, cascading_config, top_k=50,
            dense_embedding=query_embedding,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        # 4. Re-ranking (활성화된 경우)
        reranked = False
        rerank_latency_ms = 0
        if rerank_enabled and results:
            rerank_start = time.monotonic()
            results = await rerank(request.query, results, top_k=10)
            rerank_latency_ms = int((time.monotonic() - rerank_start) * 1000)
            reranked = any(r.rerank_score is not None for r in results)
        else:
            results = results[:10]

        total_latency_ms = search_latency_ms + rerank_latency_ms

        # 5. 답변 생성 (상위 5개 context만 전달)
        context_results = results[:5]
        answer = await generate_answer(request.query, context_results)

        # [Safety] 출력 안전 레이어 — 면책 고지 + 민감 인명 필터
        answer = await apply_safety_layer(answer)

        # 6. 답변 메시지 저장
        assistant_msg = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.ASSISTANT,
                content=answer,
            )
        )

        # 7. 검색 이벤트 + 인용 기록
        await self._record_search_event(
            assistant_msg.id, request, results, total_latency_ms,
            reranked=reranked, rerank_latency_ms=rerank_latency_ms,
        )
        await self._record_citations(assistant_msg.id, results)

        # [Cache] Step 9 — 캐시 저장
        sources_for_cache = [
            {"volume": r.volume, "text": r.text, "score": r.score, "source": r.source}
            for r in results[:3]
        ]
        if self.cache_service:
            await self.cache_service.store_cache(
                query=request.query,
                query_embedding=query_embedding,
                answer=answer,
                sources=sources_for_cache,
                chatbot_id=request.chatbot_id,
            )

        # 8. 단일 commit (전체 트랜잭션)
        await self.chat_repo.commit()

        # 9. 응답 반환 (상위 3개 출처)
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

    async def process_chat_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        """SSE 스트리밍: 입력 검증 → 캐시 체크 → 검색 → 스트리밍 생성 → Safety → 캐시 저장 → DB."""
        # [Safety] 입력 검증
        await validate_input(request.query)

        # 1. 세션 + 사용자 메시지 저장
        session = await self._get_or_create_session(request)
        await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.USER,
                content=request.query,
            )
        )

        # [Cache] 캐시 체크
        try:
            query_embedding = await embed_dense_query(request.query)
        except Exception as e:
            raise EmbeddingFailedError(f"임베딩 생성 실패: {e}") from e
        if self.cache_service:
            cache_hit = await self.cache_service.check_cache(
                query_embedding, request.chatbot_id
            )
            if cache_hit:
                safe_answer = await apply_safety_layer(cache_hit.answer)
                assistant_msg = await self.chat_repo.create_message(
                    SessionMessage(
                        session_id=session.id,
                        role=MessageRole.ASSISTANT,
                        content=safe_answer,
                    )
                )
                await self.chat_repo.commit()
                yield f"event: chunk\ndata: {json.dumps({'text': safe_answer}, ensure_ascii=False)}\n\n"
                sources_data = cache_hit.sources[:3]
                yield f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(session.id), 'message_id': str(assistant_msg.id)}, ensure_ascii=False)}\n\n"
                yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
                return

        # 2. 검색 + Re-ranking (스트림 시작 전 블로킹)
        qdrant = get_async_client()
        cascading_config, rerank_enabled = await self.chatbot_service.get_search_config(
            request.chatbot_id
        )

        start_time = time.monotonic()
        results = await cascading_search(
            qdrant, request.query, cascading_config, top_k=50,
            dense_embedding=query_embedding,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        reranked = False
        rerank_latency_ms = 0
        if rerank_enabled and results:
            rerank_start = time.monotonic()
            results = await rerank(request.query, results, top_k=10)
            rerank_latency_ms = int((time.monotonic() - rerank_start) * 1000)
            reranked = any(r.rerank_score is not None for r in results)
        else:
            results = results[:10]

        total_latency_ms = search_latency_ms + rerank_latency_ms

        # 3. 스트리밍 생성 — chunk 이벤트 yield
        context_results = results[:5]
        full_answer: list[str] = []
        async for chunk in generate_answer_stream(request.query, context_results):
            full_answer.append(chunk)
            yield f"event: chunk\ndata: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

        # 4. [Safety] 출력 안전 레이어 (스트림 완료 후)
        answer_text = "".join(full_answer)
        safe_answer = await apply_safety_layer(answer_text)

        # 5. DB 기록 (스트림 완료 후)
        assistant_msg = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.ASSISTANT,
                content=safe_answer,
            )
        )
        await self._record_search_event(
            assistant_msg.id, request, results, total_latency_ms,
            reranked=reranked, rerank_latency_ms=rerank_latency_ms,
        )
        await self._record_citations(assistant_msg.id, results)

        # [Cache] 캐시 저장
        sources_data = [
            {"volume": r.volume, "text": r.text[:200], "score": r.score, "source": r.source}
            for r in results[:3]
        ]
        if self.cache_service:
            await self.cache_service.store_cache(
                query=request.query,
                query_embedding=query_embedding,
                answer=safe_answer,
                sources=sources_data,
                chatbot_id=request.chatbot_id,
            )

        await self.chat_repo.commit()

        # 6. 메타데이터 이벤트 yield
        yield (
            f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(session.id), 'message_id': str(assistant_msg.id)}, ensure_ascii=False)}\n\n"
        )

        # 7. 종료 이벤트 (면책 고지)
        yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"

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
        session = ResearchSession(
            chatbot_config_id=config_id,
            client_fingerprint=None,
        )
        return await self.chat_repo.create_session(session)

    async def _record_search_event(
        self,
        message_id: uuid.UUID,
        request: ChatRequest,
        results: list,
        latency_ms: int,
        reranked: bool = False,
        rerank_latency_ms: int = 0,
    ) -> None:
        event = SearchEvent(
            message_id=message_id,
            query_text=request.query,
            applied_filters={
                "chatbot_id": request.chatbot_id,
                "reranked": reranked,
                "rerank_latency_ms": rerank_latency_ms,
            },
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
