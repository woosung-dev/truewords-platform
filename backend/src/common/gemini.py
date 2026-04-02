"""Gemini 클라이언트 중앙 관리. 모든 Gemini 호출은 이 모듈을 통해서만 수행."""

from google import genai
from google.genai import types
from src.config import settings

# 싱글턴 클라이언트 — sync/async 모두 이 인스턴스 사용
_client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())

MODEL_FLASH = "gemini-2.5-flash"
MODEL_EMBEDDING = "gemini-embedding-001"


async def embed_dense_document(text: str) -> list[float]:
    """문서용 dense 임베딩 (비동기)."""
    result = await _client.aio.models.embed_content(
        model=MODEL_EMBEDDING,
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return result.embeddings[0].values


async def embed_dense_query(text: str) -> list[float]:
    """쿼리용 dense 임베딩 (비동기)."""
    result = await _client.aio.models.embed_content(
        model=MODEL_EMBEDDING,
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


async def generate_text(
    prompt: str,
    system_instruction: str = "",
    model: str = MODEL_FLASH,
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
