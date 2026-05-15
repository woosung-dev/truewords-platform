"""Gemini 클라이언트 중앙 관리. 모든 Gemini 호출은 이 모듈을 통해서만 수행.

§13.1 S1: 초기화는 src.common.gemini_client.get_client() 팩토리에 위임. 이 모듈은
고수준 API (임베딩/생성/스트리밍) 만 노출.

audit 2차 S-4 (2026-05-15): chat 생성/스트림에 application-level hard timeout 적용.
이전엔 retry_429=True 만으로 SDK 기본 동작에 의존 → 동시 요청 시 Gemini 무한 대기로
Cloud Run concurrency 잠김 + 비용 폭증 (메타 β single biggest production risk).
``asyncio.timeout`` (Python 3.11+) 으로 단발/스트림 별 cutoff 강제. TimeoutError 발생
시 caller (chat service / global exception handler) 가 사용자에 503 메시지 반환.
"""

import asyncio
from collections.abc import AsyncGenerator

from google.genai import types
from src.common.gemini_client import get_client
from src.config import settings

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
    """텍스트 생성 (비동기).

    audit 2차 S-4: ``settings.gemini_generate_timeout_seconds`` hard cutoff.
    """
    config = types.GenerateContentConfig()
    if system_instruction:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
        )
    async with asyncio.timeout(settings.gemini_generate_timeout_seconds):
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
    """텍스트 스트리밍 생성 (비동기 제너레이터).

    audit 2차 S-4: ``settings.gemini_stream_timeout_seconds`` 가 stream 누적 시간
    상한. chunk 단위가 아닌 전체 stream lifetime cutoff — 마지막 chunk 가 시간 안
    yield 되지 않으면 TimeoutError. caller 는 partial result 도 손실 가능성 가정.
    """
    config = types.GenerateContentConfig()
    if system_instruction:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
        )
    # google-genai >=0.8.0 에서 generate_content_stream 이 coroutine 으로 변경됨.
    # 직접 async for 시 'object with __aiter__ method, got coroutine' TypeError.
    # await 로 AsyncIterator 를 먼저 받은 뒤 async for 로 chunk 소비.
    async with asyncio.timeout(settings.gemini_stream_timeout_seconds):
        stream = await _client.aio.models.generate_content_stream(
            model=model,
            contents=prompt,
            config=config,
        )
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
