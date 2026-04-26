"""PersistStage — DB 기록 (답변 메시지 + 검색 이벤트 + 인용 + 캐시 저장 + commit)."""

from __future__ import annotations

from src.cache.service import SemanticCacheService
from src.chat.models import (
    AnswerCitation,
    MessageRole,
    SearchEvent,
    SessionMessage,
)
from src.chat.pipeline.context import ChatContext
from src.chat.repository import ChatRepository


class PersistStage:
    def __init__(
        self,
        chat_repo: ChatRepository,
        cache_service: SemanticCacheService | None = None,
    ) -> None:
        self.chat_repo = chat_repo
        self.cache_service = cache_service

    async def execute(self, ctx: ChatContext) -> ChatContext:
        session = ctx.session
        if not session or not ctx.answer:
            return ctx

        # 답변 메시지 저장 (N7: 신규 파이프라인 = v2)
        ctx.assistant_message = await self.chat_repo.create_message(
            SessionMessage(
                session_id=session.id,
                role=MessageRole.ASSISTANT,
                content=ctx.answer,
                pipeline_version=2,
            )
        )

        # 검색 이벤트 기록
        event = SearchEvent(
            message_id=ctx.assistant_message.id,
            query_text=ctx.request.query,
            rewritten_query=ctx.rewritten_query,
            applied_filters={
                "chatbot_id": ctx.request.chatbot_id,
                "reranked": ctx.reranked,
                "rerank_latency_ms": ctx.rerank_latency_ms,
                "fallback_type": ctx.fallback_type,
            },
            total_results=len(ctx.results),
            latency_ms=ctx.search_latency_ms + ctx.rerank_latency_ms,
        )
        await self.chat_repo.create_search_event(event)

        # 인용 기록 (상위 5건)
        citations = [
            AnswerCitation(
                message_id=ctx.assistant_message.id,
                source=r.source,
                volume=int(r.volume) if r.volume.isdigit() else 0,
                volume_raw=r.volume,
                text_snippet=r.text[:500],
                relevance_score=r.score,
                rank_position=i,
            )
            for i, r in enumerate(ctx.results[:5])
        ]
        if citations:
            await self.chat_repo.create_citations(citations)

        # 캐시 저장 (빈 응답은 저장 X)
        if self.cache_service and ctx.results and ctx.answer and "찾지 못했습니다" not in ctx.answer:
            sources_for_cache = [
                {"volume": r.volume, "text": r.text, "score": r.score, "source": r.source}
                for r in ctx.results[:3]
            ]
            collection_name = ctx.resolved_collections.cache if ctx.resolved_collections else None
            await self.cache_service.store_cache(
                query=ctx.request.query,
                query_embedding=ctx.query_embedding or [],
                answer=ctx.answer,
                sources=sources_for_cache,
                chatbot_id=ctx.request.chatbot_id,
                collection_name=collection_name,
            )

        # 단일 commit
        await self.chat_repo.commit()
        return ctx
