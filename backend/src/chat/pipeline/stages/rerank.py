"""RerankStage — Gemini Flash reranker 호출 + 점수 분포 로깅. intent 별 top_k 분기."""

from __future__ import annotations

import logging
import time

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.search.intent_classifier import rerank_top_k_for
from src.search.reranker import rerank

logger = logging.getLogger(__name__)


class RerankStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        if ctx.runtime_config and ctx.runtime_config.retrieval.rerank_enabled and ctx.results:
            top_k = rerank_top_k_for(ctx.intent)
            ctx.results_before_rerank = list(ctx.results)
            start = time.monotonic()
            ctx.results = await rerank(ctx.request.query, ctx.results, top_k=top_k)
            ctx.rerank_latency_ms = int((time.monotonic() - start) * 1000)
            ctx.reranked = any(r.rerank_score is not None for r in ctx.results)

            # PR 6 — Phase 0 cascade_score_dist 패턴을 reranker 에 동일 적용.
            # 운영 모니터링 (백로그 #1, p95/p99 latency) 데이터원.
            # 모든 결과의 rerank_score 가 None 이면 graceful degradation 으로 본다 → 로그 생략.
            rerank_scores = sorted(
                [r.rerank_score for r in ctx.results if r.rerank_score is not None],
                reverse=True,
            )
            if rerank_scores:
                logger.info(
                    "rerank_score_dist",
                    extra={
                        "intent": str(ctx.intent),
                        "n_input": len(ctx.results_before_rerank),
                        "n_output": len(ctx.results),
                        "score_top": rerank_scores[0],
                        "score_p50": rerank_scores[len(rerank_scores) // 2],
                        "score_bottom": rerank_scores[-1],
                        "latency_ms": ctx.rerank_latency_ms,
                    },
                )
        else:
            ctx.results = ctx.results[:10]
        ctx.pipeline_state = PipelineState.RERANKED
        return ctx
