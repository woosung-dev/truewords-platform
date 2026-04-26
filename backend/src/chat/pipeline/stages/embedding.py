"""EmbeddingStage — 사용자 질의의 dense embedding 생성 (캐시 체크 + 검색 공용)."""

from __future__ import annotations

from src.chat.pipeline.context import ChatContext
from src.common.gemini import embed_dense_query
from src.search.exceptions import EmbeddingFailedError


class EmbeddingStage:
    """ctx.request.query 의 dense embedding 을 ctx.query_embedding 에 저장.

    실패 시 EmbeddingFailedError 로 변환.
    """

    async def execute(self, ctx: ChatContext) -> ChatContext:
        try:
            ctx.query_embedding = await embed_dense_query(ctx.request.query)
        except Exception as e:
            raise EmbeddingFailedError(f"임베딩 생성 실패: {e}") from e
        return ctx
