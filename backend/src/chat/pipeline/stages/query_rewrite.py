"""QueryRewriteStage — 검색 전 쿼리 재작성."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.common.gemini import embed_dense_query
from src.search.query_rewriter import rewrite_query


class QueryRewriteStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        ctx.search_query = ctx.request.query
        if ctx.runtime_config and ctx.runtime_config.retrieval.query_rewrite_enabled:
            rewritten = await rewrite_query(ctx.request.query, enabled=True)
            if rewritten != ctx.request.query:
                ctx.search_query = rewritten
                ctx.rewritten_query = rewritten
                ctx.query_embedding = await embed_dense_query(rewritten)
        ctx.pipeline_state = PipelineState.QUERY_REWRITTEN
        return ctx
