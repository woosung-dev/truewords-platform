"""채팅 Service — RAG 파이프라인 오케스트레이션.

입력 검증 → 캐시 → 검색 → Re-ranking → 생성 → Safety → DB 기록의
전체 흐름을 조율하며, 동기/SSE 스트리밍 두 가지 모드를 지원한다.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator

from src.cache.service import SemanticCacheService
from src.chat.models import AnswerFeedback, MessageRole, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.cache_check import CacheCheckStage
from src.chat.pipeline.stages.embedding import EmbeddingStage
from src.chat.pipeline.stages.generation import GenerationStage
from src.chat.pipeline.stages.input_validation import InputValidationStage
from src.chat.pipeline.stages.persist import PersistStage
from src.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from src.chat.pipeline.stages.rerank import RerankStage
from src.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from src.chat.pipeline.stages.safety_output import SafetyOutputStage
from src.chat.pipeline.stages.search import SearchStage
from src.chat.pipeline.stages.session import SessionStage
from src.chat.pipeline.state import PipelineState, force_transition_to
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT
from src.chat.repository import ChatRepository
from src.chat.schemas import ChatRequest, ChatResponse, FeedbackRequest, Source
from src.chat.stream_generator import generate_answer_stream
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)
from src.chatbot.service import ChatbotService
from src.safety.output_filter import DISCLAIMER


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
        # R1 Phase 2 + 3: 전체 Stage 체인 (process_chat 동기 경로).
        self.input_validation_stage = InputValidationStage()
        self.session_stage = SessionStage(chat_repo, chatbot_service)
        self.embedding_stage = EmbeddingStage()
        self.cache_check_stage = CacheCheckStage(cache_service)
        self.runtime_config_stage = RuntimeConfigStage(
            chatbot_service, default_config=DEFAULT_RUNTIME_CONFIG
        )
        self.query_rewrite_stage = QueryRewriteStage()
        self.search_stage = SearchStage(default_tiers=DEFAULT_RUNTIME_CONFIG.search.tiers)
        self.rerank_stage = RerankStage()
        self.generation_stage = GenerationStage()
        self.safety_output_stage = SafetyOutputStage()
        self.persist_stage = PersistStage(chat_repo, cache_service)

    async def _run_pre_pipeline(self, request: ChatRequest) -> ChatContext:
        """입력 검증 → 세션 → 임베딩 → 캐시 체크. 양 경로 공통.

        cache_hit 분기는 호출자 책임 (동기는 ChatResponse, 스트림은 SSE yield).
        """
        ctx = ChatContext(request=request)
        ctx = await self.input_validation_stage.execute(ctx)
        ctx = await self.session_stage.execute(ctx)
        ctx = await self.embedding_stage.execute(ctx)
        ctx = await self.cache_check_stage.execute(ctx)
        return ctx

    async def process_chat(self, request: ChatRequest) -> ChatResponse:
        """동기 RAG 처리 — 전체 답변을 한 번에 반환.

        9단계 파이프라인:
        입력 검증 → 세션 → 임베딩 → 캐시 체크 → 검색(50) → Re-ranking(10) →
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
        ctx = await self._run_pre_pipeline(request)

        # Cache hit early return (mini-persist — full PersistStage 미실행)
        if ctx.cache_hit and ctx.cache_response and ctx.session:
            assistant_msg = await self.chat_repo.create_message(
                SessionMessage(
                    session_id=ctx.session.id,
                    role=MessageRole.ASSISTANT,
                    content=ctx.cache_response.answer,
                    pipeline_version=2,
                )
            )
            await self.chat_repo.commit()
            return ChatResponse(
                answer=ctx.cache_response.answer,
                sources=[Source(**s) for s in ctx.cache_response.sources],
                session_id=ctx.session.id,
                message_id=assistant_msg.id,
            )

        # Stage 체인: 런타임 설정 → 쿼리 재작성 → 검색 → 리랭킹 → 생성 → Safety → DB 기록
        ctx = await self.runtime_config_stage.execute(ctx)
        ctx = await self.query_rewrite_stage.execute(ctx)
        ctx = await self.search_stage.execute(ctx)
        ctx = await self.rerank_stage.execute(ctx)
        ctx = await self.generation_stage.execute(ctx)
        ctx = await self.safety_output_stage.execute(ctx)
        ctx = await self.persist_stage.execute(ctx)

        return ChatResponse(
            answer=ctx.answer or "",
            sources=[
                Source(volume=r.volume, text=r.text, score=r.score, source=r.source)
                for r in ctx.results[:3]
            ],
            session_id=ctx.session.id,
            message_id=ctx.assistant_message.id,
        )

    async def process_chat_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        """SSE 스트리밍 RAG 처리 — chunk/sources/done 이벤트를 순차 yield.

        Client disconnect 또는 task cancellation 시 force_transition_to 로
        ctx.pipeline_state = STREAM_ABORTED 갱신 후 re-raise (관찰성 baseline).
        """
        ctx = await self._run_pre_pipeline(request)

        # Cache hit early return (SSE — mini-persist)
        if ctx.cache_hit and ctx.cache_response and ctx.session:
            safe_answer = ctx.cache_response.answer
            assistant_msg = await self.chat_repo.create_message(
                SessionMessage(
                    session_id=ctx.session.id,
                    role=MessageRole.ASSISTANT,
                    content=safe_answer,
                    pipeline_version=2,
                )
            )
            await self.chat_repo.commit()
            yield f"event: chunk\ndata: {json.dumps({'text': safe_answer}, ensure_ascii=False)}\n\n"
            sources_data = ctx.cache_response.sources[:3]
            yield f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(ctx.session.id), 'message_id': str(assistant_msg.id)}, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
            return

        try:
            # Stage 체인: 런타임 설정 → 쿼리 재작성 → 검색 → 리랭킹
            ctx = await self.runtime_config_stage.execute(ctx)
            ctx = await self.query_rewrite_stage.execute(ctx)
            ctx = await self.search_stage.execute(ctx)
            ctx = await self.rerank_stage.execute(ctx)

            # 스트리밍 생성 (inline — async generator yield 때문에 Stage 분리 불가)
            context_results = ctx.results[:5]
            full_answer: list[str] = []
            async for chunk in generate_answer_stream(
                request.query,
                context_results,
                generation_config=ctx.runtime_config.generation,
            ):
                full_answer.append(chunk)
                yield f"event: chunk\ndata: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"

            # Safety + Persist (Stage 체인)
            ctx.answer = "".join(full_answer)
            ctx = await self.safety_output_stage.execute(ctx)
            ctx = await self.persist_stage.execute(ctx)

            # Sources + Done 이벤트 yield
            sources_data = [
                {"volume": r.volume, "text": r.text[:200], "score": r.score, "source": r.source}
                for r in ctx.results[:3]
            ]
            yield (
                f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(ctx.session.id), 'message_id': str(ctx.assistant_message.id)}, ensure_ascii=False)}\n\n"
            )
            yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            force_transition_to(ctx, PipelineState.STREAM_ABORTED, reason="client_disconnect")
            raise

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

