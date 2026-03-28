import time
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import embed_dense_document, embed_sparse

# Gemini 무료 티어: 임베딩 API 분당 1500 요청 (초당 25)
# 안전하게 초당 5 요청으로 제한
_EMBED_DELAY_SEC = 0.2
# 429 오류 발생 시 재시도 대기 시간 (초)
_RETRY_WAIT_SEC = 60
_MAX_RETRIES = 3
# 중간 저장: N개 청크마다 upsert
_BATCH_SIZE = 10


def _embed_with_retry(text: str) -> list[float]:
    """Rate limit 대응용 재시도 임베딩 함수."""
    import google.api_core.exceptions
    for attempt in range(_MAX_RETRIES):
        try:
            result = embed_dense_document(text)
            time.sleep(_EMBED_DELAY_SEC)
            return result
        except google.api_core.exceptions.ResourceExhausted:
            if attempt < _MAX_RETRIES - 1:
                print(f"  Rate limit 초과, {_RETRY_WAIT_SEC}초 대기 후 재시도... (시도 {attempt + 1}/{_MAX_RETRIES})")
                time.sleep(_RETRY_WAIT_SEC)
            else:
                raise
    raise RuntimeError(f"임베딩 실패: {_MAX_RETRIES}회 재시도 소진")


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
) -> None:
    if not chunks:
        return

    batch: list[PointStruct] = []
    for i, chunk in enumerate(chunks):
        dense = _embed_with_retry(chunk.text)
        sparse_indices, sparse_values = embed_sparse(chunk.text)

        batch.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector={
                    "dense": dense,
                    "sparse": SparseVector(
                        indices=sparse_indices,
                        values=sparse_values,
                    ),
                },
                payload={
                    "text": chunk.text,
                    "volume": chunk.volume,
                    "chunk_index": chunk.chunk_index,
                },
            )
        )

        # 배치 단위로 upsert (중간 저장)
        if len(batch) >= _BATCH_SIZE:
            client.upsert(collection_name=collection_name, points=batch)
            print(f"  [{i + 1}/{len(chunks)}] 청크 적재 중...")
            batch = []

    # 남은 청크 처리
    if batch:
        client.upsert(collection_name=collection_name, points=batch)
        print(f"  [{len(chunks)}/{len(chunks)}] 청크 적재 완료")
