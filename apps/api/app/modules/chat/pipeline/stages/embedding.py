"""EmbeddingStage — 사용자 질의의 dense embedding 생성 (캐시 체크 + 검색 공용)."""

from __future__ import annotations

from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.state import PipelineState, check_precondition
from app.core.common.gemini import embed_dense_query
from app.modules.search.exceptions import EmbeddingFailedError


class EmbeddingStage:
    """ctx.request.query 의 dense embedding 을 ctx.query_embedding 에 저장.

    실패 시 EmbeddingFailedError 로 변환.
    """

    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        try:
            embedding = await embed_dense_query(ctx.request.query)
            ctx.query_embedding = embedding
            ctx.original_query_embedding = embedding
        except Exception as e:
            raise EmbeddingFailedError(f"임베딩 생성 실패: {e}") from e
        ctx.pipeline_state = PipelineState.EMBEDDED
        return ctx
