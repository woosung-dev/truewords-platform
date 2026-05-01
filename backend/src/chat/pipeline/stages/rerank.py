"""RerankStage — Reranker factory 분기. intent 별 top_k 분기."""

from __future__ import annotations

import time

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.search.intent_classifier import rerank_top_k_for
from src.search.rerank import get_reranker


class RerankStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        if ctx.runtime_config and ctx.runtime_config.retrieval.rerank_enabled and ctx.results:
            top_k = rerank_top_k_for(ctx.intent)
            reranker = get_reranker(ctx.runtime_config.retrieval.reranker_model)
            start = time.monotonic()
            ctx.results = await reranker.rerank(ctx.request.query, ctx.results, top_k=top_k)
            ctx.rerank_latency_ms = int((time.monotonic() - start) * 1000)
            ctx.reranked = any(r.rerank_score is not None for r in ctx.results)
        else:
            ctx.results = ctx.results[:10]
        ctx.pipeline_state = PipelineState.RERANKED
        return ctx
