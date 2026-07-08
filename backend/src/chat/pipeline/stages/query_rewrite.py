"""QueryRewriteStage — 검색 전 쿼리 재작성 (첫 턴: 용어 변환 / 후속 턴: condense)."""

from __future__ import annotations

from src.chat.history import select_history_window
from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.state import PipelineState, check_precondition
from src.common.gemini import embed_dense_query
from src.search.query_rewriter import condense_query, rewrite_query

# condense 입력 이력은 직전 1~3턴이면 충분 — 생성용(1200)보다 타이트한 예산으로
# LLM 입력 토큰·지연 절감.
CONDENSE_HISTORY_TOKEN_BUDGET = 800


class QueryRewriteStage:
    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        ctx.search_query = ctx.request.query
        rewrite_enabled = bool(
            ctx.runtime_config and ctx.runtime_config.retrieval.query_rewrite_enabled
        )

        if ctx.history:
            # 멀티턴 후속 턴 — 문맥 해소(standalone question) 재작성. 검색 전용이며
            # 생성 단계는 원본 질문+이력을 계속 사용한다. condense 게이트는
            # query_rewrite_enabled 토글과 독립 (DEFAULT_RUNTIME_CONFIG 가
            # rewrite_enabled=False 라 종속시키면 기본 봇에서 멀티턴 검색이 죽는다).
            # rewrite_enabled=True 면 종교 용어 변환까지 LLM 1회로 결합 수행.
            rewritten = await condense_query(
                ctx.request.query,
                select_history_window(ctx.history, token_budget=CONDENSE_HISTORY_TOKEN_BUDGET),
                term_rewrite=rewrite_enabled,
            )
        elif rewrite_enabled:
            rewritten = await rewrite_query(ctx.request.query, enabled=True)
        else:
            rewritten = ctx.request.query

        if rewritten != ctx.request.query:
            ctx.search_query = rewritten
            ctx.rewritten_query = rewritten
            # 검색용 임베딩만 갱신 — original_query_embedding 은 불변 (캐시 일관성).
            ctx.query_embedding = await embed_dense_query(rewritten)
        ctx.pipeline_state = PipelineState.QUERY_REWRITTEN
        return ctx
