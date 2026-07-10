"""채팅 Service — RAG 파이프라인 오케스트레이션.

입력 검증 → 캐시 → 검색 → Re-ranking → 생성 → Safety → DB 기록의
전체 흐름을 조율하며, 동기/SSE 스트리밍 두 가지 모드를 지원한다.
"""

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator

from sqlalchemy.exc import IntegrityError

from src.cache.service import SemanticCacheService
from src.chat.models import AnswerFeedback, MessageRole, SessionMessage
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.cache_check import CacheCheckStage
from src.chat.pipeline.stages.closing_template import ClosingTemplateStage
from src.chat.pipeline.stages.embedding import EmbeddingStage
from src.chat.pipeline.stages.generation import (
    GenerationStage,
    configure_generation_for_mode,
)
from src.chat.pipeline.stages.input_validation import InputValidationStage
from src.chat.pipeline.stages.intent_classifier import IntentClassifierStage
from src.chat.pipeline.stages.persist import PersistStage
from src.chat.pipeline.stages.query_rewrite import QueryRewriteStage
from src.chat.pipeline.stages.rerank import RerankStage
from src.chat.pipeline.stages.runtime_config import RuntimeConfigStage
from src.chat.pipeline.stages.safety_output import SafetyOutputStage
from src.chat.pipeline.stages.search import SearchStage
from src.chat.pipeline.stages.session import SessionStage
from src.chat.pipeline.stages.suggested_followups import SuggestedFollowupsStage
from src.chat.pipeline.state import PipelineState, force_transition_to
from src.search.intent_classifier import generation_context_slice_for
from src.chat.prompt import BASE_SYSTEM_PROMPT
from src.chat.repository import ChatRepository
from src.chat.schemas import ChatRequest, ChatResponse, FeedbackRequest, Source
from src.chat.stream_generator import generate_answer_stream
from src.malssum.service import pick_malssum_for_answer
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
    TierConfig,
)
from src.chatbot.service import ChatbotService
from src.common.ingestion_facade import build_display_name_lookup, get_corpus_updated_at
from src.pipeline.ingestion_repository import IngestionJobRepository
from src.safety.output_filter import DISCLAIMER, StreamingSanitizer


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
    generation=GenerationConfig(system_prompt=BASE_SYSTEM_PROMPT),
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
        ingestion_repo: IngestionJobRepository | None = None,
    ) -> None:
        self.chat_repo = chat_repo
        self.chatbot_service = chatbot_service
        self.cache_service = cache_service
        # Cache invalidation 의 corpus_updated_at trigger 조회용. None 이면 cache
        # 가 corpus 갱신 검증 없이 동작 (테스트 fixture 호환).
        self.ingestion_repo = ingestion_repo
        # R1 Phase 2 + 3: 전체 Stage 체인 (process_chat 동기 경로).
        self.input_validation_stage = InputValidationStage()
        self.session_stage = SessionStage(chat_repo, chatbot_service)
        self.embedding_stage = EmbeddingStage()
        self.cache_check_stage = CacheCheckStage(cache_service)
        self.runtime_config_stage = RuntimeConfigStage(
            chatbot_service, default_config=DEFAULT_RUNTIME_CONFIG
        )
        # Phase D — IntentClassifierStage. RuntimeConfig 다음, QueryRewrite 전.
        # 후속 Stage(Rerank/Generation/스트림 inline)는 ctx.intent 로 K 분기.
        self.intent_classifier_stage = IntentClassifierStage()
        self.query_rewrite_stage = QueryRewriteStage()
        self.search_stage = SearchStage(default_tiers=DEFAULT_RUNTIME_CONFIG.search.tiers)
        self.rerank_stage = RerankStage()
        self.generation_stage = GenerationStage()
        # P0-A 후속 질문 추천 + P1-J 기도문/결의문 (asyncio.gather 병렬 실행)
        # 두 stage 모두 0.5s timeout 으로 실패 시 silent fallback (None).
        # runtime_config 가 None 이거나 enable_* 토글이 꺼져있으면 즉시 skip.
        self.suggested_followups_stage = SuggestedFollowupsStage()
        self.closing_template_stage = ClosingTemplateStage()
        self.safety_output_stage = SafetyOutputStage()
        self.persist_stage = PersistStage(chat_repo, cache_service)

    async def _persist_assistant_message_only(
        self, session_id: uuid.UUID, content: str, *, pipeline_version: int = 2
    ) -> SessionMessage:
        """mini-persist — cache hit / META intent 경로의 SessionMessage 저장 + commit.

        full ``PersistStage`` 가 SearchEvent / Citations / SemanticCache 까지 묶어
        처리하는 데 비해, 답변 메시지 1건 + commit 만 필요한 경로 (cache hit /
        meta intent × sync/stream) 의 inline 중복 4건을 한 helper 로 통일한다.
        """
        msg = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session_id,
                role=MessageRole.ASSISTANT,
                content=content,
                pipeline_version=pipeline_version,
            )
        )
        await self.chat_repo.commit()
        return msg

    async def _build_display_name_lookup(self) -> dict[tuple[str, str], str]:
        """(source_category, payload_volume) → display_name 매핑.

        audit P1-9 (2026-05-15): cross-domain 의존을 `common/ingestion_facade` 로
        좁힘. chat 도메인은 facade 두 함수만 의존하고 ingestion 의 내부 표현
        (derive_volume 등) 은 facade 안에 격리.
        """
        if self.ingestion_repo is None:
            return {}
        return await build_display_name_lookup(self.ingestion_repo)

    async def _run_pre_pipeline(
        self, request: ChatRequest, user_id: uuid.UUID | None = None
    ) -> ChatContext:
        """입력 검증 → 세션 → 임베딩 → 캐시 체크. 양 경로 공통.

        cache_hit 분기는 호출자 책임 (동기는 ChatResponse, 스트림은 SSE yield).

        Cache invalidation: ingestion_repo 가 주입돼 있으면 max(completed_at) 을
        ctx.corpus_updated_at 에 주입하여 CacheCheck/Persist 가 사용한다. 조회
        실패는 silent (graceful) — corpus_updated_at=0.0 으로 두면 모든 cache 가
        valid 로 처리되며, 이는 cache invalidation 만 비활성화하고 RAG 본 흐름엔
        영향 없다.
        """
        ctx = ChatContext(request=request, user_id=user_id)
        if self.ingestion_repo is not None:
            # facade 로 cross-domain 조회 좁힘 (audit P1-9).
            ctx.corpus_updated_at = await get_corpus_updated_at(self.ingestion_repo)
        ctx = await self.input_validation_stage.execute(ctx)
        ctx = await self.session_stage.execute(ctx)
        ctx = await self.embedding_stage.execute(ctx)
        ctx = await self.cache_check_stage.execute(ctx)
        return ctx

    async def process_chat(
        self, request: ChatRequest, user_id: uuid.UUID | None = None
    ) -> ChatResponse:
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
        ctx = await self._run_pre_pipeline(request, user_id)

        # Cache hit early return (mini-persist — full PersistStage 미실행)
        if ctx.cache_hit and ctx.cache_response and ctx.session:
            assistant_msg = await self._persist_assistant_message_only(
                ctx.session.id, ctx.cache_response.answer
            )
            display_name_lookup = await self._build_display_name_lookup()
            cache_sources: list[Source] = []
            for s in ctx.cache_response.sources:
                src = Source(**s)
                src.display_name = display_name_lookup.get((src.source, src.volume))
                cache_sources.append(src)
            # 레드팀 시연 — 캐시 답변에도 주제 매칭 말씀 (매 응답 fresh, 캐시 미저장).
            featured = await pick_malssum_for_answer(ctx.cache_response.answer)
            return ChatResponse(
                answer=ctx.cache_response.answer,
                sources=cache_sources,
                session_id=ctx.session.id,
                message_id=assistant_msg.id,
                featured_malssum=featured,
            )

        # Stage 체인: 런타임 설정 → intent 분류
        ctx = await self.runtime_config_stage.execute(ctx)
        ctx = await self.intent_classifier_stage.execute(ctx)

        # Meta intent early return (Search/Rerank/Generation 스킵, Safety + mini-persist 만)
        if ctx.pipeline_state == PipelineState.META_TERMINATED and ctx.session:
            ctx = await self.safety_output_stage.execute(ctx)
            assistant_msg = await self._persist_assistant_message_only(
                ctx.session.id, ctx.answer or ""
            )
            return ChatResponse(
                answer=ctx.answer or "",
                sources=[],
                session_id=ctx.session.id,
                message_id=assistant_msg.id,
                # 메타(범위 밖/거부) 응답엔 말씀 카드 미표시.
                featured_malssum=None,
            )

        # 본 chain: 쿼리 재작성 → 검색 → 리랭킹 → 생성 → Safety → DB 기록
        ctx = await self.query_rewrite_stage.execute(ctx)
        ctx = await self.search_stage.execute(ctx)
        ctx = await self.rerank_stage.execute(ctx)
        ctx = await self.generation_stage.execute(ctx)
        ctx = await self.safety_output_stage.execute(ctx)
        # P0-A + P1-J + 말씀 주제 매칭: 세 작업 모두 본 답변과 독립적이라 병렬 실행.
        # 말씀 LLM 분류를 여기 끼워 main 경로 추가 지연 0 (followups/closing 과 overlap).
        # 실패해도 답변 본체에 영향 없도록 return_exceptions=True.
        gathered = await asyncio.gather(
            self.suggested_followups_stage.execute(ctx),
            self.closing_template_stage.execute(ctx),
            pick_malssum_for_answer(ctx.answer or ""),
            return_exceptions=True,
        )
        featured = gathered[2] if isinstance(gathered[2], dict) else None
        ctx = await self.persist_stage.execute(ctx)

        display_name_lookup = await self._build_display_name_lookup()
        return ChatResponse(
            answer=ctx.answer or "",
            sources=[
                Source(
                    volume=r.volume,
                    text=r.text,
                    score=r.score,
                    source=r.source,
                    chunk_id=r.chunk_id,
                    display_name=display_name_lookup.get((r.source, r.volume)),
                )
                for r in ctx.results[:3]
            ],
            session_id=ctx.session.id,
            message_id=ctx.assistant_message.id,
            suggested_followups=ctx.suggested_followups,
            closing=ctx.closing,
            persona_overridden=getattr(ctx, "persona_overridden", False),
            featured_malssum=featured,
        )

    async def process_chat_stream(
        self, request: ChatRequest, user_id: uuid.UUID | None = None
    ) -> AsyncGenerator[str, None]:
        """SSE 스트리밍 RAG 처리 — chunk/sources/done 이벤트를 순차 yield.

        Client disconnect 또는 task cancellation 시 force_transition_to 로
        ctx.pipeline_state = STREAM_ABORTED 갱신 후 re-raise (관찰성 baseline).
        """
        ctx = await self._run_pre_pipeline(request, user_id)

        # Cache hit early return (SSE — mini-persist)
        if ctx.cache_hit and ctx.cache_response and ctx.session:
            safe_answer = ctx.cache_response.answer
            assistant_msg = await self._persist_assistant_message_only(
                ctx.session.id, safe_answer
            )
            yield f"event: chunk\ndata: {json.dumps({'text': safe_answer}, ensure_ascii=False)}\n\n"
            display_name_lookup = await self._build_display_name_lookup()
            sources_data = []
            for s in ctx.cache_response.sources[:3]:
                enriched = {**s, "display_name": display_name_lookup.get((s.get("source", ""), s.get("volume", "")))}
                sources_data.append(enriched)
            # 레드팀 시연 — 캐시 답변에도 주제 매칭 말씀 (매 응답 fresh).
            featured = await pick_malssum_for_answer(safe_answer)
            # cache hit 경로는 closing/suggested_followups 가 cache 에 저장되지 않아 None.
            cache_sources_payload = {
                "sources": sources_data,
                "session_id": str(ctx.session.id),
                "message_id": str(assistant_msg.id),
                "closing": None,
                "suggested_followups": None,
                "featured_malssum": featured,
            }
            yield f"event: sources\ndata: {json.dumps(cache_sources_payload, ensure_ascii=False)}\n\n"
            yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
            return

        try:
            # Stage 체인: 런타임 설정 → intent 분류
            ctx = await self.runtime_config_stage.execute(ctx)
            ctx = await self.intent_classifier_stage.execute(ctx)

            # Meta intent early return (SSE chunk + sources + done + mini-persist)
            if ctx.pipeline_state == PipelineState.META_TERMINATED and ctx.session:
                ctx = await self.safety_output_stage.execute(ctx)
                assistant_msg = await self._persist_assistant_message_only(
                    ctx.session.id, ctx.answer or ""
                )
                yield f"event: chunk\ndata: {json.dumps({'text': ctx.answer or ''}, ensure_ascii=False)}\n\n"
                # META 응답은 검색/closing/followups 가 없어 None 으로 키만 유지 —
                # frontend SSE 컨슈머가 어느 분기에서든 같은 schema 로 dict.get 가능.
                meta_sources_payload = {
                    "sources": [],
                    "session_id": str(ctx.session.id),
                    "message_id": str(assistant_msg.id),
                    "closing": None,
                    "suggested_followups": None,
                    # 메타(범위 밖/거부) 응답엔 말씀 카드 미표시.
                    "featured_malssum": None,
                }
                yield f"event: sources\ndata: {json.dumps(meta_sources_payload, ensure_ascii=False)}\n\n"
                yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
                return

            # 본 chain: 쿼리 재작성 → 검색 → 리랭킹
            ctx = await self.query_rewrite_stage.execute(ctx)
            ctx = await self.search_stage.execute(ctx)
            ctx = await self.rerank_stage.execute(ctx)

            # 스트리밍 생성 (inline — async generator yield 때문에 Stage 분리 불가).
            # 동기 GenerationStage 와 동일 intent 분기 슬라이스 사용.
            #
            # P0-E — 모드별 system_prompt 옵션 C 합성. configure_generation_for_mode 가
            # resolve_answer_mode + select_system_prompt 를 일괄 수행하고 ctx 의
            # resolved_answer_mode/persona_overridden/crisis_trigger 도 세팅한다.
            # stream 경로는 runtime_config 가 항상 존재해야 진행 가능 (위 search/rerank
            # stage 가 이미 ctx.runtime_config 를 참조하므로 None 이면 그 전에 깨짐).
            gen_cfg_for_call = configure_generation_for_mode(ctx)
            assert gen_cfg_for_call is not None, "stream 경로엔 runtime_config 가 필요합니다"
            context_results = ctx.results[: generation_context_slice_for(ctx.intent)]
            # P0-9: SSE chunk 단위 sanitizer. SafetyOutputStage 는 full answer 에만 동작하므로
            # SENSITIVE_PATTERNS 매칭 시 raw chunk 가 사용자에 도달하는 누출을 막는다.
            # SENSITIVE_PATTERNS 가 빈 리스트인 한 사실상 pass-through (200자 tail 버퍼링만).
            sanitizer = StreamingSanitizer()
            full_answer: list[str] = []
            abort_guidance: str | None = None
            async for chunk in generate_answer_stream(
                request.query,
                context_results,
                generation_config=gen_cfg_for_call,
            ):
                released = sanitizer.feed(chunk)
                if sanitizer.aborted:
                    abort_guidance = released
                    if released:
                        yield f"event: chunk\ndata: {json.dumps({'text': released}, ensure_ascii=False)}\n\n"
                    break
                full_answer.append(chunk)
                if released:
                    yield f"event: chunk\ndata: {json.dumps({'text': released}, ensure_ascii=False)}\n\n"

            if not sanitizer.aborted:
                tail = sanitizer.flush()
                if tail:
                    yield f"event: chunk\ndata: {json.dumps({'text': tail}, ensure_ascii=False)}\n\n"

            # Safety + 후속 stage (P0-A followups, P1-J closing) 병렬 실행 + Persist.
            # 동기 process_chat 과 동일한 흐름이라 stream 응답에도 closing/suggested_followups
            # 가 포함된다 (#12 streaming UI).
            # abort 분기: guidance 만 persist (raw partial answer 가 DB 에 남지 않도록).
            ctx.answer = abort_guidance if abort_guidance is not None else "".join(full_answer)
            ctx = await self.safety_output_stage.execute(ctx)
            # 말씀 주제 매칭 LLM 분류를 followups/closing 과 병렬 → 추가 지연 0.
            gathered = await asyncio.gather(
                self.suggested_followups_stage.execute(ctx),
                self.closing_template_stage.execute(ctx),
                pick_malssum_for_answer(ctx.answer or ""),
                return_exceptions=True,
            )
            featured = gathered[2] if isinstance(gathered[2], dict) else None
            ctx = await self.persist_stage.execute(ctx)

            # Sources + Done 이벤트 yield (closing / suggested_followups 포함).
            # chunk_id 는 frontend 의 출처 카드 클릭 → 원문보기 모달 trigger 에 필수.
            # 누락 시 카드가 "원문 미연결" 로 비활성. 동기 process_chat 응답과 동일 schema.
            display_name_lookup = await self._build_display_name_lookup()
            sources_data = [
                {
                    "volume": r.volume,
                    "text": r.text[:200],
                    "score": r.score,
                    "source": r.source,
                    "chunk_id": r.chunk_id,
                    "display_name": display_name_lookup.get((r.source, r.volume)),
                }
                for r in ctx.results[:3]
            ]
            sources_payload = {
                "sources": sources_data,
                "session_id": str(ctx.session.id),
                "message_id": str(ctx.assistant_message.id),
                "closing": ctx.closing,
                "suggested_followups": ctx.suggested_followups,
                "featured_malssum": featured,
            }
            yield (
                f"event: sources\ndata: {json.dumps(sources_payload, ensure_ascii=False)}\n\n"
            )
            yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            force_transition_to(ctx, PipelineState.STREAM_ABORTED, reason="client_disconnect")
            raise

    async def get_session_history(
        self, session_id: uuid.UUID, user_id: uuid.UUID
    ) -> dict | None:
        """세션 대화 이력 조회 (소유권 검증).

        Args:
            session_id: 조회할 세션 UUID.
            user_id: 요청 사용자 id — 세션 소유자와 일치해야 열람 가능.

        Returns:
            ``{"session_id", "messages": [{"role", "content", "created_at"}]}`` 형태 dict.
            세션이 없거나 요청자 소유가 아니면 None (라우터가 404 처리 — 존재 여부 노출 방지).
        """
        session = await self.chat_repo.get_session(session_id)
        if session is None or session.user_id != user_id:
            return None
        messages = await self.chat_repo.get_messages_by_session(session_id)
        return {
            "session_id": session_id,
            "messages": [
                {"role": m.role, "content": m.content, "created_at": str(m.created_at)}
                for m in messages
            ],
        }

    async def list_user_sessions(
        self, user_id: uuid.UUID, limit: int = 100, offset: int = 0
    ) -> dict:
        """로그인 사용자의 대화 세션 목록 (최근 활동순) + 총 개수."""
        items, total = await self.chat_repo.list_sessions_by_user(user_id, limit, offset)
        return {"items": items, "total": total}

    async def upsert_feedback(
        self, request: FeedbackRequest, user_session_id: str
    ) -> tuple[str, AnswerFeedback]:
        """답변 피드백 upsert — (message_id, user_session_id) 당 현재 상태 1행.

        같은 세션이 같은 메시지에 이미 피드백했으면 feedback_type/comment 를
        교체(UPDATE), 없으면 INSERT. 좋아요↔싫어요 전환도 이 경로로 교체된다.

        race: 두 동시 요청이 모두 existing=None 으로 읽고 INSERT → unique 위반.
        IntegrityError catch 후 재조회하여 UPDATE 로 수렴 (reactions_service 패턴).

        Returns:
            ("created" | "updated", 저장된 AnswerFeedback).
        """
        existing = await self.chat_repo.get_feedback(
            request.message_id, user_session_id
        )
        if existing is not None:
            existing.feedback_type = request.feedback_type
            existing.comment = request.comment
            await self.chat_repo.commit()
            return "updated", existing

        feedback = AnswerFeedback(
            message_id=request.message_id,
            user_session_id=user_session_id,
            feedback_type=request.feedback_type,
            comment=request.comment,
        )
        try:
            saved = await self.chat_repo.create_feedback(feedback)
            await self.chat_repo.commit()
            return "created", saved
        except IntegrityError:
            await self.chat_repo.rollback()
            current = await self.chat_repo.get_feedback(
                request.message_id, user_session_id
            )
            if current is None:  # pragma: no cover — race 후 재조회 실패는 이례적
                raise
            current.feedback_type = request.feedback_type
            current.comment = request.comment
            await self.chat_repo.commit()
            return "updated", current

    async def delete_feedback(
        self, message_id: uuid.UUID, user_session_id: str
    ) -> bool:
        """답변 피드백 취소 — (message_id, user_session_id) 행 삭제. 멱등."""
        deleted = await self.chat_repo.delete_feedback(message_id, user_session_id)
        await self.chat_repo.commit()
        return deleted

