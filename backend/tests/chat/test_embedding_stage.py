"""EmbeddingStage 단위 테스트."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.embedding import EmbeddingStage
from src.chat.schemas import ChatRequest
from src.search.exceptions import EmbeddingFailedError


class TestEmbeddingStage:
    @pytest.mark.asyncio
    async def test_sets_query_embedding(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="축복이란 무엇인가?"))

        with patch(
            "src.chat.pipeline.stages.embedding.embed_dense_query",
            new_callable=AsyncMock,
            return_value=[0.1] * 1536,
        ):
            result = await EmbeddingStage().execute(ctx)

        assert result is ctx
        assert result.query_embedding == [0.1] * 1536

    @pytest.mark.asyncio
    async def test_raises_embedding_failed_on_api_error(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="질문"))

        with patch(
            "src.chat.pipeline.stages.embedding.embed_dense_query",
            new_callable=AsyncMock,
            side_effect=RuntimeError("API down"),
        ):
            with pytest.raises(EmbeddingFailedError, match="임베딩 생성 실패"):
                await EmbeddingStage().execute(ctx)
