"""임베딩 생성. API 레이어는 common/gemini.py의 async 함수 사용.
이 모듈은 pipeline(데이터 적재) 전용 동기 함수 + async sparse 래퍼 제공.

§13.1 S1: Gemini 클라이언트 초기화는 src.common.gemini_client 팩토리에 위임.
retry_429=False — SDK 기본 retry 가 429 를 재시도하면 ingestor.py 의 수동 rate-limit
제어와 이중 retry 가 되어 RPD 가 조기 소진되므로 SDK 는 5xx/408 만 재시도.
"""

import asyncio
import logging

from fastembed import SparseTextEmbedding
from google.genai import types
from src.common.gemini_client import get_client

logger = logging.getLogger(__name__)

# 429 제외 + 5xx/408 만 3회 재시도. rate limit 은 ingestor.py 가 직접 제어.
_client = get_client(retry_429=False)

_sparse_model: SparseTextEmbedding | None = None

# 동적 배치: config.embed_max_chars_per_batch (글자 수)로 TPM 제어.
# Gemini API 1회 호출 최대 텍스트 수 제한 (안전 상한)
MAX_TEXTS_PER_BATCH = 100


def get_sparse_model() -> SparseTextEmbedding:
    global _sparse_model
    if _sparse_model is None:
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


# --- 동기 함수 (pipeline/ingestor.py 전용) ---

def embed_dense_document(text: str) -> list[float]:
    result = _client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return result.embeddings[0].values


def embed_dense_batch(texts: list[str], title: str = "") -> list[list[float]]:
    """여러 텍스트를 1회 API 호출로 배치 임베딩. RPD 소비를 1/90로 줄임.

    title 제공 시 RETRIEVAL_DOCUMENT 품질 향상 (Gemini 공식 권장).
    output_dimensionality=1536: 3072 대비 품질 손실 ~1%, 저장 50% 절감."""
    if not texts:
        return []
    contents: list[str | types.Part] = list(texts)
    embed_config = types.EmbedContentConfig(
        task_type="RETRIEVAL_DOCUMENT",
        output_dimensionality=1536,
        title=title if title else None,
    )
    result = _client.models.embed_content(
        model="gemini-embedding-001",
        contents=contents,
        config=embed_config,
    )
    embeddings = result.embeddings or []
    return [emb.values for emb in embeddings if emb.values is not None]


def embed_sparse_batch(texts: list[str]) -> list[tuple[list[int], list[float]]]:
    """여러 텍스트를 한 번에 sparse 임베딩. fastembed 네이티브 배치 지원."""
    if not texts:
        return []
    model = get_sparse_model()
    return [(e.indices.tolist(), e.values.tolist()) for e in model.embed(texts)]


def embed_dense_query(text: str) -> list[float]:
    result = _client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


def embed_sparse(text: str) -> tuple[list[int], list[float]]:
    model = get_sparse_model()
    embeddings = list(model.embed([text]))
    sparse = embeddings[0]
    return sparse.indices.tolist(), sparse.values.tolist()


# --- 비동기 래퍼 (API 레이어용) ---

async def embed_sparse_async(text: str) -> tuple[list[int], list[float]]:
    """CPU-bound fastembed을 run_in_executor로 래핑하여 이벤트 루프 블로킹 방지."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, embed_sparse, text)
