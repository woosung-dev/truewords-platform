"""RerankStage — Gemini LLM Re-ranking."""

from __future__ import annotations

import time

from src.chat.pipeline.context import ChatContext
from src.search.reranker import rerank


class RerankStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        if ctx.runtime_config and ctx.runtime_config.retrieval.rerank_enabled and ctx.results:
            start = time.monotonic()
            ctx.results = await rerank(ctx.request.query, ctx.results, top_k=10)
            ctx.rerank_latency_ms = int((time.monotonic() - start) * 1000)
            ctx.reranked = any(r.rerank_score is not None for r in ctx.results)
        else:
            ctx.results = ctx.results[:10]
        return ctx
