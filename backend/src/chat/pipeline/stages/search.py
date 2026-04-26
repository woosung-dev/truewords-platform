"""SearchStage — 하이브리드 검색 (cascading / weighted) + fallback."""

from __future__ import annotations

import time

from qdrant_client import AsyncQdrantClient

from src.chat.pipeline.context import ChatContext
from src.chatbot.runtime_config import SearchModeConfig, TierConfig
from src.search.cascading import CascadingConfig, SearchTier, cascading_search
from src.search.collection_resolver import resolve_collections
from src.search.fallback import fallback_search
from src.search.weighted import WeightedConfig, WeightedSource, weighted_search


def _to_search_config(smc: SearchModeConfig, default_tiers: list[TierConfig]) -> CascadingConfig | WeightedConfig:
    if smc.mode == "weighted":
        return WeightedConfig(
            sources=[
                WeightedSource(source=ws.source, weight=ws.weight, score_threshold=ws.score_threshold)
                for ws in smc.weighted_sources
            ]
        )
    tiers = smc.tiers or default_tiers
    return CascadingConfig(
        tiers=[
            SearchTier(sources=t.sources, min_results=t.min_results, score_threshold=t.score_threshold)
            for t in tiers
        ]
    )


class SearchStage:
    def __init__(self, qdrant: AsyncQdrantClient, default_tiers: list[TierConfig]) -> None:
        self.qdrant = qdrant
        self.default_tiers = default_tiers

    async def execute(self, ctx: ChatContext) -> ChatContext:
        if not ctx.runtime_config:
            return ctx

        search_config = _to_search_config(ctx.runtime_config.search, self.default_tiers)
        resolved = resolve_collections(ctx.runtime_config)
        ctx.resolved_collections = resolved

        start = time.monotonic()
        if isinstance(search_config, WeightedConfig):
            ctx.results = await weighted_search(
                self.qdrant, ctx.search_query or ctx.request.query,
                search_config, top_k=50,
                dense_embedding=ctx.query_embedding,
                collection_name=resolved.main,
            )
        else:
            ctx.results = await cascading_search(
                self.qdrant, ctx.search_query or ctx.request.query,
                search_config, top_k=50,
                dense_embedding=ctx.query_embedding,
                collection_name=resolved.main,
            )
        ctx.search_latency_ms = int((time.monotonic() - start) * 1000)

        if not ctx.results:
            ctx.results, ctx.fallback_type = await fallback_search(
                client=self.qdrant,
                query=ctx.search_query or ctx.request.query,
                original_results=ctx.results,
                dense_embedding=ctx.query_embedding or [],
                collection_name=resolved.main,
            )

        return ctx
