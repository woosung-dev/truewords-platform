"""Gemini 클라이언트 중앙 관리. 모든 Gemini 호출은 이 모듈을 통해서만 수행.

§13.1 S1: 초기화는 src.common.gemini_client.get_client() 팩토리에 위임. 이 모듈은
고수준 API (임베딩/생성/스트리밍) 만 노출.
"""

from collections.abc import AsyncGenerator

from google.genai import types
from src.common.gemini_client import get_client

# 싱글턴 — retry_429=True (SDK 기본, 429 포함 재시도). chat 생성/쿼리 임베딩 전용.
_client = get_client()

MODEL_GENERATE = "gemini-3.1-flash-lite-preview"
MODEL_EMBEDDING = "gemini-embedding-001"


async def embed_dense_document(text: str) -> list[float]:
    """문서용 dense 임베딩 (비동기). output_dimensionality=1536 고정."""
    result = await _client.aio.models.embed_content(
        model=MODEL_EMBEDDING,
        contents=text,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=1536,
        ),
    )
    return result.embeddings[0].values


async def embed_dense_query(text: str) -> list[float]:
    """쿼리용 dense 임베딩 (비동기). output_dimensionality=1536 고정."""
    result = await _client.aio.models.embed_content(
        model=MODEL_EMBEDDING,
        contents=text,
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=1536,
        ),
    )
    return result.embeddings[0].values


async def generate_text(
    prompt: str,
    system_instruction: str = "",
    model: str = MODEL_GENERATE,
) -> str:
    """텍스트 생성 (비동기)."""
    config = types.GenerateContentConfig()
    if system_instruction:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
        )
    response = await _client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )
    return response.text


async def generate_text_stream(
    prompt: str,
    system_instruction: str = "",
    model: str = MODEL_GENERATE,
) -> AsyncGenerator[str, None]:
    """텍스트 스트리밍 생성 (비동기 제너레이터)."""
    config = types.GenerateContentConfig()
    if system_instruction:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
        )
    async for chunk in _client.aio.models.generate_content_stream(
        model=model,
        contents=prompt,
        config=config,
    ):
        if chunk.text:
            yield chunk.text
