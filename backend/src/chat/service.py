"""채팅 Service — RAG 파이프라인 오케스트레이션.

입력 검증 → 캐시 → 검색 → Re-ranking → 생성 → Safety → DB 기록의
전체 흐름을 조율하며, 동기/SSE 스트리밍 두 가지 모드를 지원한다.
"""

import json
import time
import uuid
from collections.abc import AsyncGenerator

from src.cache.service import SemanticCacheService
from src.chat.generator import generate_answer
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT
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
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)
from src.chatbot.service import ChatbotService
from src.common.gemini import embed_dense_query
from src.qdrant_client import get_async_client
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.input_validation import InputValidationStage
from src.chat.pipeline.stages.session import SessionStage
from src.safety.output_filter import DISCLAIMER, apply_safety_layer
from src.search.cascading import CascadingConfig, SearchTier, cascading_search
from src.search.collection_resolver import resolve_collections
from src.search.weighted import WeightedConfig, WeightedSource, weighted_search
from src.search.exceptions import EmbeddingFailedError
from src.search.fallback import fallback_search
from src.search.query_rewriter import rewrite_query
from src.search.reranker import rerank


# R2: chatbot_id=None 일 때 사용할 시스템 기본 RuntimeConfig.
# 기존 DEFAULT_RERANK_ENABLED=False / DEFAULT_QUERY_REWRITE_ENABLED=False 보존.
DEFAULT_RUNTIME_CONFIG = ChatbotRuntimeConfig(
    chatbot_id="<system-default>",
    name="default",
    search=SearchModeConfig(
        mode="cascading",
        tiers=[
            TierConfig(sources=["A", "B", "C"], min_results=3, score_threshold=0.1),
        ],
    ),
    generation=GenerationConfig(system_prompt=DEFAULT_SYSTEM_PROMPT),
    retrieval=RetrievalConfig(rerank_enabled=False, query_rewrite_enabled=False),
    safety=SafetyConfig(),
)


def _to_search_config(smc: SearchModeConfig) -> CascadingConfig | WeightedConfig:
    """SearchModeConfig (Pydantic) → 기존 search 함수가 기대하는 SearchConfig 변환.

    weighted 분기는 score_threshold 까지 보존 (기존 ChatbotService._parse_search_config
    가 갖던 변환 책임을 흡수). cascading 분기는 빈 tiers 면 시스템 기본값 fallback.
    """
    if smc.mode == "weighted":
        return WeightedConfig(
            sources=[
                WeightedSource(
                    source=ws.source,
                    weight=ws.weight,
                    score_threshold=ws.score_threshold,
                )
                for ws in smc.weighted_sources
            ]
        )
    tiers = smc.tiers or DEFAULT_RUNTIME_CONFIG.search.tiers
    return CascadingConfig(
        tiers=[
            SearchTier(
                sources=t.sources,
                min_results=t.min_results,
                score_threshold=t.score_threshold,
            )
            for t in tiers
        ]
    )


class ChatService:
    """RAG 채팅 오케스트레이터.

    검색 파이프라인(cascading → rerank), LLM 생성, 캐시, DB 기록을
    단일 트랜잭션으로 조율한다. Router에서 DI로 주입받아 사용.

    Attributes:
        chat_repo: 세션·메시지·피드백 DB 접근 레포지토리.
        chatbot_service: 챗봇별 검색 설정(CascadingConfig) 조회.
        cache_service: Semantic Cache (None이면 캐시 비활성).
    """

    def __init__(
        self,
        chat_repo: ChatRepository,
        chatbot_service: ChatbotService,
        cache_service: SemanticCacheService | None = None,
    ) -> None:
        self.chat_repo = chat_repo
        self.chatbot_service = chatbot_service
        self.cache_service = cache_service
        # R1 Phase 1: 첫 2 Stage. 나머지는 inline 유지 (점진 전환).
        self.input_validation_stage = InputValidationStage()
        self.session_stage = SessionStage(chat_repo, chatbot_service)

    @staticmethod
    async def _execute_search(qdrant, query, config, top_k, dense_embedding, collection_name=None):
        """검색 모드에 따라 cascading 또는 weighted 검색 디스패치."""
        if isinstance(config, WeightedConfig):
            return await weighted_search(
                qdrant, query, config, top_k=top_k, dense_embedding=dense_embedding,
                collection_name=collection_name,
            )
        return await cascading_search(
            qdrant, query, config, top_k=top_k, dense_embedding=dense_embedding,
            collection_name=collection_name,
        )

    async def process_chat(self, request: ChatRequest) -> ChatResponse:
        """동기 RAG 처리 — 전체 답변을 한 번에 반환.

        9단계 파이프라인:
        입력 검증 → 세션 → 캐시 체크 → 검색(50) → Re-ranking(10) →
        생성(context 5) → Safety → 캐시 저장 → DB 기록.

        Args:
            request: 사용자 질의 (query, chatbot_id, session_id).

        Returns:
            ChatResponse: 답변 텍스트, 출처 3건, session_id, message_id.

        Raises:
            InputBlockedError: Prompt Injection 탐지 시.
            EmbeddingFailedError: 임베딩 API 실패 시.
            SearchFailedError: 모든 검색 티어 실패 시.
        """
        # R1 Phase 1: 첫 2 Stage (입력 검증 + 세션)
        ctx = ChatContext(request=request)
        ctx = await self.input_validation_stage.execute(ctx)
        ctx = await self.session_stage.execute(ctx)
        session = ctx.session

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
        # R2: 단일 ChatbotRuntimeConfig 로 검색/생성 설정 통합
        runtime_config = (
            await self.chatbot_service.build_runtime_config(request.chatbot_id)
            or DEFAULT_RUNTIME_CONFIG
        )
        search_config = _to_search_config(runtime_config.search)
        resolved = resolve_collections(runtime_config)

        # [Query Rewrite] 쿼리 재작성 (활성화된 경우)
        search_query = request.query
        rewritten_query = None
        if runtime_config.retrieval.query_rewrite_enabled:
            search_query = await rewrite_query(request.query, enabled=True)
            if search_query != request.query:
                rewritten_query = search_query
                # 재작성된 쿼리로 임베딩 재계산
                query_embedding = await embed_dense_query(search_query)

        start_time = time.monotonic()
        results = await self._execute_search(
            qdrant, search_query, search_config, top_k=50,
            dense_embedding=query_embedding,
            collection_name=resolved.main,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        # [Fallback] 검색 결과 0건 시 fallback
        fallback_type = "none"
        if not results:
            results, fallback_type = await fallback_search(
                client=qdrant,
                query=search_query,
                original_results=results,
                dense_embedding=query_embedding,
                collection_name=resolved.main,
            )

        # 4. Re-ranking (활성화된 경우)
        reranked = False
        rerank_latency_ms = 0
        if runtime_config.retrieval.rerank_enabled and results:
            rerank_start = time.monotonic()
            results = await rerank(request.query, results, top_k=10)
            rerank_latency_ms = int((time.monotonic() - rerank_start) * 1000)
            reranked = any(r.rerank_score is not None for r in results)
        else:
            results = results[:10]

        total_latency_ms = search_latency_ms + rerank_latency_ms

        # 5. 답변 생성 (상위 5개 context만 전달)
        # R2: GenerationConfig 단일 객체 — system_prompt + persona 치환 완료 상태
        context_results = results[:5]
        answer = await generate_answer(
            request.query,
            context_results,
            generation_config=runtime_config.generation,
        )

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
            rewritten_query=rewritten_query, fallback_type=fallback_type,
        )
        await self._record_citations(assistant_msg.id, results)

        # [Cache] Step 9 — 캐시 저장 (빈 응답은 저장하지 않음)
        sources_for_cache = [
            {"volume": r.volume, "text": r.text, "score": r.score, "source": r.source}
            for r in results[:3]
        ]
        if self.cache_service and results and "찾지 못했습니다" not in answer:
            await self.cache_service.store_cache(
                query=request.query,
                query_embedding=query_embedding,
                answer=answer,
                sources=sources_for_cache,
                chatbot_id=request.chatbot_id,
                collection_name=resolved.cache,
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
        """SSE 스트리밍 RAG 처리 — chunk/sources/done 이벤트를 순차 yield.

        검색·Re-ranking은 블로킹으로 선행 처리한 뒤,
        Gemini 스트리밍 응답을 chunk 이벤트로 실시간 전송한다.
        스트림 완료 후 Safety 필터 → DB 기록 → sources/done 이벤트.

        Args:
            request: 사용자 질의 (query, chatbot_id, session_id).

        Yields:
            SSE 포맷 문자열 (event: chunk|sources|done).

        Raises:
            InputBlockedError: Prompt Injection 탐지 시.
            EmbeddingFailedError: 임베딩 API 실패 시.
            SearchFailedError: 모든 검색 티어 실패 시.
        """
        # R1 Phase 1: 첫 2 Stage (입력 검증 + 세션)
        ctx = ChatContext(request=request)
        ctx = await self.input_validation_stage.execute(ctx)
        ctx = await self.session_stage.execute(ctx)
        session = ctx.session

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
        # R2: 단일 ChatbotRuntimeConfig 로 검색/생성 설정 통합
        runtime_config = (
            await self.chatbot_service.build_runtime_config(request.chatbot_id)
            or DEFAULT_RUNTIME_CONFIG
        )
        search_config = _to_search_config(runtime_config.search)
        resolved = resolve_collections(runtime_config)

        # [Query Rewrite] 쿼리 재작성 (활성화된 경우)
        search_query = request.query
        rewritten_query = None
        if runtime_config.retrieval.query_rewrite_enabled:
            search_query = await rewrite_query(request.query, enabled=True)
            if search_query != request.query:
                rewritten_query = search_query
                query_embedding = await embed_dense_query(search_query)

        start_time = time.monotonic()
        results = await self._execute_search(
            qdrant, search_query, search_config, top_k=50,
            dense_embedding=query_embedding,
            collection_name=resolved.main,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        # [Fallback] 검색 결과 0건 시 fallback
        fallback_type = "none"
        if not results:
            results, fallback_type = await fallback_search(
                client=qdrant,
                query=search_query,
                original_results=results,
                dense_embedding=query_embedding,
                collection_name=resolved.main,
            )

        reranked = False
        rerank_latency_ms = 0
        if runtime_config.retrieval.rerank_enabled and results:
            rerank_start = time.monotonic()
            results = await rerank(request.query, results, top_k=10)
            rerank_latency_ms = int((time.monotonic() - rerank_start) * 1000)
            reranked = any(r.rerank_score is not None for r in results)
        else:
            results = results[:10]

        total_latency_ms = search_latency_ms + rerank_latency_ms

        # 3. 스트리밍 생성 — chunk 이벤트 yield (R2: GenerationConfig 단일 인자)
        context_results = results[:5]
        full_answer: list[str] = []
        async for chunk in generate_answer_stream(
            request.query,
            context_results,
            generation_config=runtime_config.generation,
        ):
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
            rewritten_query=rewritten_query, fallback_type=fallback_type,
        )
        await self._record_citations(assistant_msg.id, results)

        # [Cache] 캐시 저장 (빈 응답은 저장하지 않음)
        sources_data = [
            {"volume": r.volume, "text": r.text[:200], "score": r.score, "source": r.source}
            for r in results[:3]
        ]
        if self.cache_service and results and "찾지 못했습니다" not in safe_answer:
            await self.cache_service.store_cache(
                query=request.query,
                query_embedding=query_embedding,
                answer=safe_answer,
                sources=sources_data,
                chatbot_id=request.chatbot_id,
                collection_name=resolved.cache,
            )

        await self.chat_repo.commit()

        # 6. 메타데이터 이벤트 yield
        yield (
            f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(session.id), 'message_id': str(assistant_msg.id)}, ensure_ascii=False)}\n\n"
        )

        # 7. 종료 이벤트 (면책 고지)
        yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"

    async def get_session_history(self, session_id: uuid.UUID) -> dict:
        """세션 대화 이력 조회.

        Args:
            session_id: 조회할 세션 UUID.

        Returns:
            ``{"session_id", "messages": [{"role", "content", "created_at"}]}`` 형태 dict.
            세션이 존재하지 않으면 빈 messages 리스트 반환.
        """
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
        """답변 피드백(좋아요/싫어요) 제출 및 DB 저장.

        Args:
            request: message_id, feedback_type, 선택적 comment.

        Returns:
            저장된 AnswerFeedback 모델 인스턴스.
        """
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
        """기존 세션 조회 또는 신규 생성.

        request.session_id가 유효한 기존 세션이면 재사용,
        없거나 찾을 수 없으면 chatbot_config_id로 새 세션을 생성한다.
        """
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
        rewritten_query: str | None = None,
        fallback_type: str = "none",
    ) -> None:
        """검색 이벤트(쿼리, 필터, 레이턴시 등)를 DB에 기록."""
        event = SearchEvent(
            message_id=message_id,
            query_text=request.query,
            rewritten_query=rewritten_query,
            applied_filters={
                "chatbot_id": request.chatbot_id,
                "reranked": reranked,
                "rerank_latency_ms": rerank_latency_ms,
                "fallback_type": fallback_type,
            },
            total_results=len(results),
            latency_ms=latency_ms,
        )
        await self.chat_repo.create_search_event(event)

    async def _record_citations(
        self, message_id: uuid.UUID, results: list
    ) -> None:
        """검색 결과 상위 5건을 AnswerCitation으로 DB에 기록."""
        citations = [
            AnswerCitation(
                message_id=message_id,
                source=r.source,
                volume=int(r.volume) if r.volume.isdigit() else 0,
                volume_raw=r.volume,
                text_snippet=r.text[:500],
                relevance_score=r.score,
                rank_position=i,
            )
            for i, r in enumerate(results[:5])
        ]
        if citations:
            await self.chat_repo.create_citations(citations)
