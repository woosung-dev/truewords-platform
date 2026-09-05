# TrueWords RAG PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가정연합 말씀 텍스트(샘플)로 하이브리드 RAG 파이프라인을 구축하고, `/chat` API에서 질문 → 검색 → 생성 → 출처 포함 답변이 동작함을 검증한다.

**Architecture:** 텍스트 파일 → 청킹 → Gemini 임베딩(dense) + BM25(sparse) → Qdrant 적재. 질의 시 RRF 퓨전으로 Top-10 검색 후 Gemini 2.5 Flash로 답변 생성. 시스템 프롬프트에 핵심 용어 20개 고정.

**Tech Stack:** FastAPI 0.115, Qdrant 1.12 (Docker), google-generativeai 0.8, fastembed (BM25), pytest, uv

---

## 사전 요건

- Docker Desktop 실행 중
- `uv` 설치: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Gemini API 키 보유 (`GEMINI_API_KEY`)
- 말씀 텍스트 파일 준비 (UTF-8 `.txt`, 권별 1파일, `data/sample/` 에 위치)

---

## 파일 구조

```
truewords-platform/
├── backend/
│   ├── pyproject.toml
│   ├── .env.example
│   ├── docker-compose.yml
│   ├── src/
│   │   ├── __init__.py
│   │   ├── config.py              # pydantic-settings 환경변수
│   │   ├── qdrant_client.py       # Qdrant 연결 + 컬렉션 생성
│   │   ├── pipeline/
│   │   │   ├── __init__.py
│   │   │   ├── chunker.py         # 텍스트 → Chunk 리스트
│   │   │   ├── embedder.py        # dense(Gemini) + sparse(BM25)
│   │   │   └── ingestor.py        # Chunk 리스트 → Qdrant upsert
│   │   ├── search/
│   │   │   ├── __init__.py
│   │   │   └── hybrid.py          # RRF 하이브리드 검색
│   │   └── chat/
│   │       ├── __init__.py
│   │       ├── prompt.py          # 시스템 프롬프트 + 컨텍스트 조립
│   │       └── generator.py       # Gemini 2.5 Flash 생성
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes.py              # POST /chat
│   ├── main.py                    # FastAPI app 진입점
│   ├── scripts/
│   │   └── ingest.py              # 데이터 적재 실행 스크립트
│   └── tests/
│       ├── conftest.py
│       ├── test_chunker.py
│       ├── test_embedder.py
│       ├── test_search.py
│       ├── test_generator.py
│       └── test_api.py
└── data/
    └── sample/                    # vol_001.txt, vol_002.txt ...
```

---

## Task 1: 프로젝트 초기화

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.yml`
- Create: `backend/src/__init__.py`
- Create: `backend/src/pipeline/__init__.py`
- Create: `backend/src/search/__init__.py`
- Create: `backend/src/chat/__init__.py`
- Create: `backend/api/__init__.py`

- [ ] **Step 1: 디렉토리 생성**

```bash
cd /Users/woosung/project/agy-project/truewords-platform
mkdir -p backend/src/pipeline backend/src/search backend/src/chat backend/api backend/scripts backend/tests data/sample
touch backend/src/__init__.py backend/src/pipeline/__init__.py backend/src/search/__init__.py backend/src/chat/__init__.py backend/api/__init__.py
```

- [ ] **Step 2: pyproject.toml 작성**

`backend/pyproject.toml`:
```toml
[project]
name = "truewords-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "qdrant-client[fastembed]>=1.12.0",
    "google-generativeai>=0.8.0",
    "pydantic-settings>=2.6.0",
    "httpx>=0.27.0",
]

[dependency-groups]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "pytest-mock>=3.14.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 3: .env.example 작성**

`backend/.env.example`:
```
GEMINI_API_KEY=your_gemini_api_key_here
QDRANT_URL=http://localhost:6333
COLLECTION_NAME=malssum_poc
```

- [ ] **Step 4: docker-compose.yml 작성**

`backend/docker-compose.yml`:
```yaml
services:
  qdrant:
    image: qdrant/qdrant:v1.12.0
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  qdrant_data:
```

- [ ] **Step 5: 의존성 설치**

```bash
cd backend
cp .env.example .env
# .env 파일 열어서 GEMINI_API_KEY 실제 값으로 수정
uv sync --group dev
```

Expected: `Resolved N packages` 메시지 출력

- [ ] **Step 6: Qdrant 실행**

```bash
cd backend
docker compose up -d
```

Expected:
```
✔ Container backend-qdrant-1  Started
```

- [ ] **Step 7: Qdrant 동작 확인**

```bash
curl http://localhost:6333/healthz
```

Expected: `{"title":"qdrant - vector search engine","version":"1.12.x"}`

- [ ] **Step 8: 커밋**

```bash
cd /Users/woosung/project/agy-project/truewords-platform
git init
git add backend/ data/
git commit -m "chore: 프로젝트 초기화 및 Qdrant Docker 설정"
```

---

## Task 2: Config + Qdrant 컬렉션

**Files:**
- Create: `backend/src/config.py`
- Create: `backend/src/qdrant_client.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/conftest.py`:
```python
import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_qdrant():
    return MagicMock()
```

`backend/tests/test_qdrant_setup.py`:
```python
from unittest.mock import MagicMock, call
from src.qdrant_client import create_collection


def test_create_collection_uses_dense_and_sparse_vectors():
    mock_client = MagicMock()
    create_collection(mock_client, "test_collection")

    mock_client.create_collection.assert_called_once()
    call_kwargs = mock_client.create_collection.call_args.kwargs

    assert call_kwargs["collection_name"] == "test_collection"
    assert "dense" in call_kwargs["vectors_config"]
    assert "sparse" in call_kwargs["sparse_vectors_config"]
    assert call_kwargs["vectors_config"]["dense"].size == 768
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_qdrant_setup.py -v
```

Expected: `FAILED` — `ModuleNotFoundError: No module named 'src'`

- [ ] **Step 3: config.py 작성**

`backend/src/config.py`:
```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "malssum_poc"

    model_config = {"env_file": ".env"}


settings = Settings()
```

- [ ] **Step 4: qdrant_client.py 작성**

`backend/src/qdrant_client.py`:
```python
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    SparseVectorParams,
    SparseIndexParams,
)
from src.config import settings


def get_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url)


def create_collection(client: QdrantClient, collection_name: str) -> None:
    client.create_collection(
        collection_name=collection_name,
        vectors_config={
            "dense": VectorParams(size=768, distance=Distance.COSINE)
        },
        sparse_vectors_config={
            "sparse": SparseVectorParams(
                index=SparseIndexParams(on_disk=False)
            )
        },
    )
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_qdrant_setup.py -v
```

Expected: `PASSED`

- [ ] **Step 6: 실제 Qdrant에 컬렉션 생성 확인**

```bash
cd backend
uv run python -c "
from src.qdrant_client import get_client, create_collection
from src.config import settings
client = get_client()
create_collection(client, settings.collection_name)
print('컬렉션 생성 완료:', settings.collection_name)
"
```

Expected: `컬렉션 생성 완료: malssum_poc`

- [ ] **Step 7: 커밋**

```bash
git add backend/src/config.py backend/src/qdrant_client.py backend/tests/
git commit -m "feat: Qdrant 연결 및 하이브리드 벡터 컬렉션 생성"
```

---

## Task 3: 텍스트 청커

**Files:**
- Create: `backend/src/pipeline/chunker.py`
- Create: `backend/tests/test_chunker.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_chunker.py`:
```python
from src.pipeline.chunker import Chunk, chunk_text


def test_chunk_returns_chunks_with_metadata():
    text = "첫 번째 문단입니다.\n\n두 번째 문단입니다.\n\n세 번째 문단입니다."
    chunks = chunk_text(text, volume="vol_001", max_chars=30)

    assert len(chunks) > 0
    assert all(isinstance(c, Chunk) for c in chunks)
    assert all(c.volume == "vol_001" for c in chunks)
    assert all(c.chunk_index >= 0 for c in chunks)


def test_chunk_indices_are_sequential():
    text = "\n\n".join([f"문단 {i}입니다." for i in range(10)])
    chunks = chunk_text(text, volume="vol_001", max_chars=30)

    indices = [c.chunk_index for c in chunks]
    assert indices == list(range(len(chunks)))


def test_chunk_text_not_empty():
    text = "내용이 있는 문단.\n\n또 다른 내용."
    chunks = chunk_text(text, volume="vol_001", max_chars=500)

    assert all(c.text.strip() for c in chunks)


def test_single_paragraph_becomes_one_chunk():
    text = "짧은 단일 문단."
    chunks = chunk_text(text, volume="vol_002", max_chars=500)

    assert len(chunks) == 1
    assert chunks[0].text == "짧은 단일 문단."
    assert chunks[0].volume == "vol_002"


def test_empty_text_returns_empty_list():
    chunks = chunk_text("", volume="vol_001", max_chars=500)
    assert chunks == []


def test_whitespace_only_paragraphs_are_skipped():
    text = "첫 문단.\n\n   \n\n두 번째 문단."
    chunks = chunk_text(text, volume="vol_001", max_chars=500)

    texts = [c.text for c in chunks]
    assert not any(t.strip() == "" for t in texts)
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_chunker.py -v
```

Expected: `FAILED` — `ModuleNotFoundError`

- [ ] **Step 3: chunker.py 구현**

`backend/src/pipeline/chunker.py`:
```python
from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int


def chunk_text(
    text: str,
    volume: str,
    max_chars: int = 500,
    overlap: int = 50,
) -> list[Chunk]:
    if not text.strip():
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[Chunk] = []
    buffer = ""
    chunk_index = 0

    for para in paragraphs:
        candidate = (buffer + "\n\n" + para).strip() if buffer else para

        if len(candidate) > max_chars and buffer:
            chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index))
            chunk_index += 1
            tail = buffer[-overlap:] if overlap > 0 and len(buffer) > overlap else ""
            buffer = (tail + "\n\n" + para).strip() if tail else para
        else:
            buffer = candidate

    if buffer.strip():
        chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index))

    return chunks
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_chunker.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 5: 커밋**

```bash
git add backend/src/pipeline/chunker.py backend/tests/test_chunker.py
git commit -m "feat: 텍스트 청킹 구현 (단락 기반, 오버랩 지원)"
```

---

## Task 4: 임베더 (Dense + Sparse)

**Files:**
- Create: `backend/src/pipeline/embedder.py`
- Create: `backend/tests/test_embedder.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_embedder.py`:
```python
from unittest.mock import patch, MagicMock
from src.pipeline.embedder import embed_dense_document, embed_dense_query, embed_sparse


def test_embed_dense_document_returns_768_floats():
    mock_result = {"embedding": [0.1] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result):
        result = embed_dense_document("테스트 텍스트")

    assert len(result) == 768
    assert all(isinstance(v, float) for v in result)


def test_embed_dense_document_uses_retrieval_document_task():
    mock_result = {"embedding": [0.0] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result) as mock_embed:
        embed_dense_document("텍스트")

    _, kwargs = mock_embed.call_args
    assert kwargs.get("task_type") == "RETRIEVAL_DOCUMENT"


def test_embed_dense_query_uses_retrieval_query_task():
    mock_result = {"embedding": [0.0] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result) as mock_embed:
        embed_dense_query("질문")

    _, kwargs = mock_embed.call_args
    assert kwargs.get("task_type") == "RETRIEVAL_QUERY"


def test_embed_sparse_returns_indices_and_values():
    mock_sparse = MagicMock()
    mock_sparse.indices.tolist.return_value = [1, 5, 10]
    mock_sparse.values.tolist.return_value = [0.5, 0.3, 0.8]

    with patch("src.pipeline.embedder.get_sparse_model") as mock_get:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([mock_sparse])
        mock_get.return_value = mock_model

        indices, values = embed_sparse("텍스트")

    assert indices == [1, 5, 10]
    assert values == [0.5, 0.3, 0.8]
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_embedder.py -v
```

Expected: `FAILED` — `ModuleNotFoundError`

- [ ] **Step 3: embedder.py 구현**

`backend/src/pipeline/embedder.py`:
```python
import google.generativeai as genai
from fastembed import SparseTextEmbedding
from src.config import settings

genai.configure(api_key=settings.gemini_api_key)

_sparse_model: SparseTextEmbedding | None = None


def get_sparse_model() -> SparseTextEmbedding:
    global _sparse_model
    if _sparse_model is None:
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


def embed_dense_document(text: str) -> list[float]:
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="RETRIEVAL_DOCUMENT",
    )
    return result["embedding"]


def embed_dense_query(text: str) -> list[float]:
    result = genai.embed_content(
        model="models/text-embedding-004",
        content=text,
        task_type="RETRIEVAL_QUERY",
    )
    return result["embedding"]


def embed_sparse(text: str) -> tuple[list[int], list[float]]:
    model = get_sparse_model()
    embeddings = list(model.embed([text]))
    sparse = embeddings[0]
    return sparse.indices.tolist(), sparse.values.tolist()
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_embedder.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 5: 커밋**

```bash
git add backend/src/pipeline/embedder.py backend/tests/test_embedder.py
git commit -m "feat: Gemini dense 임베딩 + BM25 sparse 임베딩 구현"
```

---

## Task 5: 인제스터 (Qdrant 적재)

**Files:**
- Create: `backend/src/pipeline/ingestor.py`
- Create: `backend/tests/test_ingestor.py`
- Create: `backend/scripts/ingest.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ingestor.py`:
```python
from unittest.mock import MagicMock, patch
from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import ingest_chunks


def test_ingest_calls_upsert_with_correct_payload():
    mock_client = MagicMock()
    chunks = [
        Chunk(text="말씀 내용입니다.", volume="vol_001", chunk_index=0),
        Chunk(text="두 번째 말씀입니다.", volume="vol_001", chunk_index=1),
    ]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 768),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    mock_client.upsert.assert_called_once()
    call_kwargs = mock_client.upsert.call_args.kwargs
    assert call_kwargs["collection_name"] == "test_collection"
    points = call_kwargs["points"]
    assert len(points) == 2


def test_ingest_payload_contains_text_and_volume():
    mock_client = MagicMock()
    chunks = [Chunk(text="참부모님 말씀.", volume="vol_005", chunk_index=0)]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.0] * 768),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([0], [1.0])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    points = mock_client.upsert.call_args.kwargs["points"]
    payload = points[0].payload
    assert payload["text"] == "참부모님 말씀."
    assert payload["volume"] == "vol_005"
    assert payload["chunk_index"] == 0


def test_empty_chunks_does_not_call_upsert():
    mock_client = MagicMock()
    ingest_chunks(mock_client, "test_collection", [])
    mock_client.upsert.assert_not_called()
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_ingestor.py -v
```

Expected: `FAILED` — `ModuleNotFoundError`

- [ ] **Step 3: ingestor.py 구현**

`backend/src/pipeline/ingestor.py`:
```python
import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import embed_dense_document, embed_sparse


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
) -> None:
    if not chunks:
        return

    points: list[PointStruct] = []
    for chunk in chunks:
        dense = embed_dense_document(chunk.text)
        sparse_indices, sparse_values = embed_sparse(chunk.text)

        points.append(
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

    client.upsert(collection_name=collection_name, points=points)
```

- [ ] **Step 4: 실행 스크립트 작성**

`backend/scripts/ingest.py`:
```python
"""
사용법: uv run python scripts/ingest.py ../data/sample/
"""
import sys
from pathlib import Path

# src/ 를 import 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.config import settings
from src.qdrant_client import get_client
from src.pipeline.chunker import chunk_text
from src.pipeline.ingestor import ingest_chunks


def main(data_dir: str) -> None:
    client = get_client()
    txt_files = sorted(Path(data_dir).glob("*.txt"))

    if not txt_files:
        print(f"오류: {data_dir} 에 .txt 파일이 없습니다.")
        sys.exit(1)

    print(f"{len(txt_files)}개 파일 발견. 적재 시작...")

    for txt_file in txt_files:
        volume = txt_file.stem  # 예: vol_001
        text = txt_file.read_text(encoding="utf-8")
        chunks = chunk_text(text, volume=volume, max_chars=500, overlap=50)
        ingest_chunks(client, settings.collection_name, chunks)
        print(f"  {volume}: {len(chunks)}개 청크 적재 완료")

    print("전체 적재 완료.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("사용법: python scripts/ingest.py <data_dir>")
        sys.exit(1)
    main(sys.argv[1])
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_ingestor.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 6: 커밋**

```bash
git add backend/src/pipeline/ingestor.py backend/tests/test_ingestor.py backend/scripts/ingest.py
git commit -m "feat: Qdrant 청크 적재 파이프라인 구현"
```

---

## Task 6: 하이브리드 검색 (RRF)

**Files:**
- Create: `backend/src/search/hybrid.py`
- Create: `backend/tests/test_search.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_search.py`:
```python
from unittest.mock import MagicMock, patch
from src.search.hybrid import hybrid_search, SearchResult


def _make_mock_point(text: str, volume: str, score: float):
    point = MagicMock()
    point.payload = {"text": text, "volume": volume, "chunk_index": 0}
    point.score = score
    return point


def test_hybrid_search_returns_search_results():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.points = [
        _make_mock_point("하나님의 사랑", "vol_001", 0.95),
        _make_mock_point("참부모님 말씀", "vol_002", 0.88),
    ]
    mock_client.query_points.return_value = mock_response

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        results = hybrid_search(mock_client, "하나님 사랑이란", top_k=10)

    assert len(results) == 2
    assert all(isinstance(r, SearchResult) for r in results)
    assert results[0].text == "하나님의 사랑"
    assert results[0].volume == "vol_001"
    assert results[0].score == 0.95


def test_hybrid_search_calls_query_points_with_rrf():
    mock_client = MagicMock()
    mock_client.query_points.return_value = MagicMock(points=[])

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.0] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([0], [1.0])),
    ):
        hybrid_search(mock_client, "질문", top_k=5)

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs["limit"] == 5
    # RRF fusion 사용 확인
    assert call_kwargs["query"] is not None
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_search.py -v
```

Expected: `FAILED`

- [ ] **Step 3: hybrid.py 구현**

`backend/src/search/hybrid.py`:
```python
from dataclasses import dataclass
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
)
from src.pipeline.embedder import embed_dense_query, embed_sparse
from src.config import settings


@dataclass
class SearchResult:
    text: str
    volume: str
    chunk_index: int
    score: float


def hybrid_search(
    client: QdrantClient,
    query: str,
    top_k: int = 10,
) -> list[SearchResult]:
    dense = embed_dense_query(query)
    sparse_indices, sparse_values = embed_sparse(query)

    response = client.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=dense, using="dense", limit=50),
            Prefetch(
                query=SparseVector(
                    indices=sparse_indices,
                    values=sparse_values,
                ),
                using="sparse",
                limit=50,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        limit=top_k,
    )

    return [
        SearchResult(
            text=point.payload["text"],
            volume=point.payload["volume"],
            chunk_index=point.payload.get("chunk_index", 0),
            score=point.score,
        )
        for point in response.points
    ]
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_search.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 5: 커밋**

```bash
git add backend/src/search/hybrid.py backend/tests/test_search.py
git commit -m "feat: RRF 하이브리드 검색 구현 (dense + sparse)"
```

---

## Task 7: 프롬프트 조립 + Gemini 생성

**Files:**
- Create: `backend/src/chat/prompt.py`
- Create: `backend/src/chat/generator.py`
- Create: `backend/tests/test_generator.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_generator.py`:
```python
from unittest.mock import patch, MagicMock
from src.chat.prompt import build_context_prompt, SYSTEM_PROMPT
from src.chat.generator import generate_answer
from src.search.hybrid import SearchResult


def _make_results():
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95),
        SearchResult(text="참부모님의 가르침은 참사랑이다.", volume="vol_002", chunk_index=1, score=0.88),
    ]


def test_system_prompt_contains_core_terms():
    assert "참부모님" in SYSTEM_PROMPT
    assert "말씀" in SYSTEM_PROMPT
    assert "원리강론" in SYSTEM_PROMPT


def test_build_context_prompt_includes_all_sources():
    results = _make_results()
    prompt = build_context_prompt("사랑이란 무엇인가?", results)

    assert "하나님은 사랑이시다." in prompt
    assert "참부모님의 가르침은 참사랑이다." in prompt
    assert "vol_001" in prompt
    assert "vol_002" in prompt
    assert "사랑이란 무엇인가?" in prompt


def test_generate_answer_calls_gemini_and_returns_text():
    mock_response = MagicMock()
    mock_response.text = "사랑은 하나님의 본질입니다."

    with patch("src.chat.generator.model") as mock_model:
        mock_model.generate_content.return_value = mock_response
        answer = generate_answer("사랑이란?", _make_results())

    assert answer == "사랑은 하나님의 본질입니다."
    mock_model.generate_content.assert_called_once()


def test_generate_answer_passes_context_in_prompt():
    mock_response = MagicMock()
    mock_response.text = "답변"

    with patch("src.chat.generator.model") as mock_model:
        mock_model.generate_content.return_value = mock_response
        generate_answer("질문", _make_results())

    call_args = mock_model.generate_content.call_args
    prompt_text = call_args.args[0]
    assert "하나님은 사랑이시다." in prompt_text
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_generator.py -v
```

Expected: `FAILED`

- [ ] **Step 3: prompt.py 구현**

`backend/src/chat/prompt.py`:
```python
from src.search.hybrid import SearchResult

SYSTEM_PROMPT = """당신은 가정연합 말씀 학습 도우미입니다.

[핵심 용어 기준 — 반드시 이 정의를 따르십시오]
- 참부모님: 문선명 총재와 한학자 총재를 함께 지칭하는 가정연합 최고 권위 용어
- 말씀: 참부모님의 가르침 및 훈독회 성훈 텍스트 전체
- 원리강론: 가정연합의 핵심 교리 문서. 창조원리, 타락론, 복귀원리로 구성
- 천일국: 하늘 부모님 아래 인류 한 가족 세계. 가정연합이 추구하는 이상세계
- 훈독회: 매일 아침 말씀을 낭독하는 가정연합 신앙 활동
- 참사랑: 자기희생적 사랑. 가정연합 신앙의 핵심 가치
- 하늘 부모님: 하나님을 지칭하는 가정연합 용어

[답변 규칙]
1. 반드시 제공된 말씀 문단만을 근거로 답변하십시오.
2. 말씀 문단에 없는 내용을 추가하거나 추론하지 마십시오.
3. 관련 말씀을 찾지 못한 경우 "해당 내용을 말씀에서 찾지 못했습니다."라고 명확히 말씀드리십시오.
4. 답변 마지막에 반드시 출처(권 이름)를 명시하십시오.
5. 한국어로 답변하십시오.
"""


def build_context_prompt(query: str, results: list[SearchResult]) -> str:
    context_parts = [
        f"[출처: {r.volume}]\n{r.text}"
        for r in results
    ]
    context_text = "\n\n".join(context_parts)
    return f"말씀 문단:\n{context_text}\n\n질문: {query}"
```

- [ ] **Step 4: generator.py 구현**

`backend/src/chat/generator.py`:
```python
import google.generativeai as genai
from src.config import settings
from src.chat.prompt import SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult

genai.configure(api_key=settings.gemini_api_key)

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=SYSTEM_PROMPT,
)


def generate_answer(query: str, results: list[SearchResult]) -> str:
    prompt = build_context_prompt(query, results)
    response = model.generate_content(prompt)
    return response.text
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_generator.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 6: 커밋**

```bash
git add backend/src/chat/ backend/tests/test_generator.py
git commit -m "feat: 시스템 프롬프트 + Gemini 2.5 Flash 답변 생성 구현"
```

---

## Task 8: FastAPI 엔드포인트

**Files:**
- Create: `backend/api/routes.py`
- Create: `backend/main.py`
- Create: `backend/tests/test_api.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_api.py`:
```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from main import app

client = TestClient(app)


def _mock_search_results():
    from src.search.hybrid import SearchResult
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95),
    ]


def test_chat_endpoint_returns_200():
    with (
        patch("api.routes.hybrid_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란 무엇인가?"})

    assert response.status_code == 200


def test_chat_endpoint_response_has_answer_and_sources():
    with (
        patch("api.routes.hybrid_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란?"})

    data = response.json()
    assert "answer" in data
    assert "sources" in data
    assert data["answer"] == "사랑은 하나님의 본질입니다."
    assert len(data["sources"]) == 1
    assert data["sources"][0]["volume"] == "vol_001"


def test_chat_endpoint_requires_query_field():
    response = client.post("/chat", json={})
    assert response.status_code == 422


def test_chat_endpoint_empty_query_handled():
    with (
        patch("api.routes.hybrid_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "존재하지않는질문"})

    assert response.status_code == 200
    assert "answer" in response.json()
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend
uv run pytest tests/test_api.py -v
```

Expected: `FAILED`

- [ ] **Step 3: routes.py 구현**

`backend/api/routes.py`:
```python
from fastapi import APIRouter
from pydantic import BaseModel
from src.search.hybrid import hybrid_search
from src.chat.generator import generate_answer
from src.qdrant_client import get_client

router = APIRouter()


class ChatRequest(BaseModel):
    query: str


class Source(BaseModel):
    volume: str
    text: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    client = get_client()
    results = hybrid_search(client, request.query, top_k=10)
    answer = generate_answer(request.query, results)
    return ChatResponse(
        answer=answer,
        sources=[
            Source(volume=r.volume, text=r.text, score=r.score)
            for r in results[:3]
        ],
    )
```

- [ ] **Step 4: main.py 작성**

`backend/main.py`:
```python
from fastapi import FastAPI
from api.routes import router

app = FastAPI(title="TrueWords RAG PoC", version="0.1.0")
app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend
uv run pytest tests/test_api.py -v
```

Expected: 모든 테스트 `PASSED`

- [ ] **Step 6: 전체 테스트 통과 확인**

```bash
cd backend
uv run pytest -v
```

Expected: 전체 테스트 `PASSED`, 0 failures

- [ ] **Step 7: 커밋**

```bash
git add backend/api/routes.py backend/main.py backend/tests/test_api.py
git commit -m "feat: POST /chat 엔드포인트 구현 (검색 + 생성 + 출처)"
```

---

## Task 9: 데이터 적재 + 품질 검증

**Files:**
- Create: `data/sample/` (사용자 제공 txt 파일)
- Create: `backend/scripts/evaluate.py`

- [ ] **Step 1: 샘플 데이터 준비**

`data/sample/` 디렉토리에 말씀 텍스트 파일을 배치합니다.
- 파일명 형식: `vol_001.txt`, `vol_002.txt` 등
- 인코딩: UTF-8
- 형식: 문단 사이 빈 줄(\n\n) 포함 평문 텍스트

최소 1개 파일, 권장 5-10권.

- [ ] **Step 2: 데이터 적재 실행**

```bash
cd backend
uv run python scripts/ingest.py ../data/sample/
```

Expected:
```
N개 파일 발견. 적재 시작...
  vol_001: XX개 청크 적재 완료
  ...
전체 적재 완료.
```

- [ ] **Step 3: Qdrant 적재 확인**

```bash
curl http://localhost:6333/collections/malssum_poc
```

Expected: `"points_count"` 값이 0 이상

- [ ] **Step 4: 서버 실행**

```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

- [ ] **Step 5: 품질 평가 스크립트 작성**

`backend/scripts/evaluate.py`:
```python
"""
사용법: uv run python scripts/evaluate.py
서버가 localhost:8000에서 실행 중이어야 합니다.
"""
import json
import httpx

TEST_QUESTIONS = [
    "참사랑이란 무엇인가?",
    "천일국은 어떤 세계인가?",
    "훈독회는 왜 해야 하는가?",
    "하나님의 창조 목적은 무엇인가?",
    "타락의 원인은 무엇인가?",
]

def evaluate():
    results = []
    for q in TEST_QUESTIONS:
        response = httpx.post("http://localhost:8000/chat", json={"query": q}, timeout=30.0)
        data = response.json()
        results.append({
            "question": q,
            "answer": data["answer"],
            "sources": [s["volume"] for s in data["sources"]],
        })
        print(f"\n질문: {q}")
        print(f"답변: {data['answer'][:200]}...")
        print(f"출처: {[s['volume'] for s in data['sources']]}")

    with open("eval_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n평가 완료. 결과: eval_results.json")

if __name__ == "__main__":
    evaluate()
```

- [ ] **Step 6: 품질 평가 실행**

별도 터미널에서 서버가 실행 중인 상태에서:

```bash
cd backend
uv run python scripts/evaluate.py
```

Expected: 각 질문에 대한 답변과 출처가 출력됨

- [ ] **Step 7: 품질 체크포인트**

다음 기준으로 직접 확인:
- [ ] 답변이 말씀 문단과 관련 있는가?
- [ ] 출처(volume)가 명시되는가?
- [ ] 관련 없는 질문에서 "찾지 못했습니다" 응답이 나오는가?
- [ ] 핵심 용어(참부모님, 원리강론 등)가 올바르게 사용되는가?

- [ ] **Step 8: 최종 커밋**

```bash
git add backend/scripts/ eval_results.json
git commit -m "test: RAG PoC 품질 평가 스크립트 및 결과"
```

---

## 완료 체크리스트

- [ ] Qdrant 컬렉션 생성 완료 (dense 768차원 + sparse BM25)
- [ ] 텍스트 청킹 동작 확인
- [ ] 샘플 데이터 적재 완료
- [ ] 하이브리드 검색 (RRF) 동작 확인
- [ ] `/chat` API 응답 확인 (답변 + 출처 3개)
- [ ] 전체 단위 테스트 통과
- [ ] 품질 평가 5개 질문 답변 확인

---

## 클라이언트 데모 시나리오

```bash
# 서버 실행
cd backend && uv run uvicorn main:app --port 8000

# 테스트 요청
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "참사랑이란 무엇인가?"}'
```

Expected response:
```json
{
  "answer": "...(말씀 기반 답변)...\n\n출처: vol_XXX",
  "sources": [
    {"volume": "vol_XXX", "text": "...", "score": 0.95},
    ...
  ]
}
```

---

## Engineering Review Report

> **리뷰 일자:** 2026-03-28
> **리뷰 범위:** Phase 1 RAG PoC 계획 vs 실제 구현 코드 전체 대조
> **최종 판정:** APPROVED WITH CHANGES

---

### 1. 발견된 이슈 목록

#### High 심각도

| # | 이슈 | 위치 | 설명 | 권고 |
|---|------|------|------|------|
| H-1 | Gemini API 키 보호 미흡 | `src/config.py` | `gemini_api_key: str`로 선언. `SecretStr` 미사용. 로그/traceback에 키 노출 가능 | Phase 2에서 `SecretStr` 적용 + 로깅 필터 |
| H-2 | 엔드포인트 인증 없음 | `api/routes.py` | POST /chat가 완전 오픈. 누구나 호출 가능 → API 키 과금 위험 | Phase 2에서 API Key 또는 JWT 인증 추가 |
| H-3 | Gemini 생성 에러 미처리 | `src/chat/generator.py` | `generate_answer()`에 try-except 없음. Gemini 429/500 시 500 Internal Server Error 전파 | Phase 2에서 에러 핸들링 + 재시도 로직 추가 |

#### Medium 심각도

| # | 이슈 | 위치 | 설명 | 권고 |
|---|------|------|------|------|
| M-1 | 계획 vs 구현 - 임베딩 모델 변경 | 계획: `text-embedding-004` (768d), 구현: `gemini-embedding-001` (3072d) | 계획 문서와 실제 코드의 모델/차원 불일치. 테스트 mock도 768로 작성되어 있어 실제 차원과 불일치 | 계획 문서 업데이트 + 테스트 mock 차원 3072로 수정 |
| M-2 | 계획 vs 구현 - SDK 변경 | 계획: `google-generativeai` + `genai.embed_content()`, 구현: `google-genai` + `Client().models.embed_content()` | SDK 전면 교체로 API 인터페이스 변경. 계획의 테스트 코드와 실제 테스트 코드가 다름 | 문서 정합성 확보 (이미 구현에 맞게 동작 중이므로 문서만 업데이트) |
| M-3 | Qdrant Docker 버전 고정 안 됨 | `docker-compose.yml` | 계획: `qdrant/qdrant:v1.12.0`, 구현: `qdrant/qdrant:latest`. 빌드 재현성 위험 | 특정 버전 태그로 고정 권장 |
| M-4 | QdrantClient 매 요청 생성 | `api/routes.py` L27 | `client = get_client()` 매 /chat 호출마다 새 클라이언트 생성. 연결 풀링 없음 | 싱글톤 또는 FastAPI lifespan으로 공유 |
| M-5 | 검색 결과 빈 경우 생성 모델에 빈 컨텍스트 전달 | `api/routes.py` | `results=[]`일 때 `generate_answer()`에 빈 컨텍스트 전달. 시스템 프롬프트 규칙에 의존하여 환각 억제 | 검색 결과 0건 시 LLM 호출 없이 즉시 "찾지 못했습니다" 반환 고려 |
| M-6 | 핵심 용어 7개 vs 계획 20개 | `src/chat/prompt.py` | 계획에서 "핵심 용어 20개 고정"을 명시했으나 실제 구현은 7개 | 나머지 13개 용어 추가 또는 계획 문서 수정 |

#### Low 심각도

| # | 이슈 | 위치 | 설명 | 권고 |
|---|------|------|------|------|
| L-1 | pyproject.toml에 pythonpath 미설정 | `pyproject.toml` | `pythonpath = ["."]`이 pytest 설정에만 있고, 일반 실행 시 `scripts/ingest.py`에서 `sys.path.insert` 필요 | Phase 2에서 패키지 구조 정리 |
| L-2 | evaluate.py 결과 자동 검증 없음 | `scripts/evaluate.py` | 결과를 JSON 파일로 저장만 하고 자동 pass/fail 판정 없음 | 기대 답변 대비 유사도 메트릭 추가 |
| L-3 | 타입 힌트 불완전 | `api/routes.py` | `chat()` 함수 반환 타입 미명시 (FastAPI가 response_model로 추론) | 명시적 반환 타입 추가 |
| L-4 | 로깅 대신 print 사용 | `src/pipeline/ingestor.py` | `print()` 문으로 진행 상황 출력 | Python logging 모듈 사용 |
| L-5 | .gitignore에 .env 포함 여부 미확인 | 프로젝트 루트 | `.env` 파일이 git에 커밋될 위험 | `.gitignore`에 `.env` 확인 필요 |

---

### 2. 테스트 커버리지 분석

**총 테스트: 24개 (8개 파일)**

| 테스트 파일 | 테스트 수 | 커버 모듈 | 평가 |
|------------|----------|----------|------|
| `test_chunker.py` | 6 | `pipeline/chunker.py` | 우수 - 엣지 케이스 충분 (빈 텍스트, 공백 문단, 단일 문단) |
| `test_embedder.py` | 4 | `pipeline/embedder.py` | 양호 - dense/sparse 분리 테스트, task_type 검증 |
| `test_ingestor.py` | 3 | `pipeline/ingestor.py` | 양호 - upsert 호출, payload 검증, 빈 청크 처리 |
| `test_qdrant_setup.py` | 1 | `qdrant_client.py` | 최소 - 컬렉션 생성만 테스트 |
| `test_search.py` | 2 | `search/hybrid.py` | 양호 - 반환값 구조, RRF 호출 검증 |
| `test_generator.py` | 4 | `chat/prompt.py`, `chat/generator.py` | 양호 - 프롬프트 조립, 생성 호출, 컨텍스트 포함 검증 |
| `test_api.py` | 4 | `api/routes.py`, `main.py` | 양호 - 200 응답, 응답 구조, 422 유효성, 빈 결과 |

**커버되지 않은 영역:**

| 미커버 영역 | 심각도 | 비고 |
|------------|--------|------|
| `config.py` 환경변수 로딩 실패 | Medium | GEMINI_API_KEY 누락 시 동작 |
| `ingestor.py` rate limit 재시도 로직 | Medium | `_embed_with_retry()` 429 재시도 경로 미테스트 |
| `ingestor.py` 배치 중간 저장 | Low | `_BATCH_SIZE=10` 배치 분할 동작 미검증 |
| `routes.py` Gemini 에러 전파 | Medium | 생성 모델 예외 시 API 응답 |
| `qdrant_client.py` get_client() 연결 실패 | Low | Qdrant 다운 시 동작 |
| `evaluate.py` E2E 테스트 | Low | 스크립트이므로 별도 테스트 불필요하나, CI에 포함 고려 |
| `hybrid.py` 검색 결과 0건 | Low | Qdrant 빈 응답 시 동작 (현재 mock에서 간접 테스트) |

**커버리지 판정:** 핵심 경로(happy path) 충분히 커버. 에러 경로 및 rate limit 재시도 테스트 부족.

---

### 3. 실패 모드 목록

| # | 실패 모드 | 현재 대응 | 사용자 영향 | 개선 방향 |
|---|----------|----------|-----------|----------|
| F-1 | Gemini API 429 (rate limit) - 검색 시 | 대응 없음 | 500 에러 반환 | embed 함수에 retry 래퍼 적용 (ingestor에만 있음) |
| F-2 | Gemini API 429 (rate limit) - 생성 시 | 대응 없음 | 500 에러 반환 | generate_answer에 retry 로직 추가 |
| F-3 | Gemini API 다운 (5xx) | 대응 없음 | 500 에러 반환 | Circuit breaker + fallback 메시지 |
| F-4 | Qdrant Docker 미실행 | 대응 없음 | 연결 에러 → 500 | health 엔드포인트에 Qdrant 상태 확인 추가 |
| F-5 | 빈 검색 결과 | 시스템 프롬프트 규칙에 의존 | LLM이 "찾지 못했습니다" 응답 (불확실) | 코드 레벨에서 즉시 반환 |
| F-6 | 매우 긴 질문 입력 | 제한 없음 | 토큰 초과 가능 | 입력 길이 제한 (max 500자) |
| F-7 | 악의적 프롬프트 인젝션 | 시스템 프롬프트 규칙만 | 방어 불확실 | 입력 필터링 + 별도 방어 레이어 |
| F-8 | Gemini API 키 만료/무효 | 대응 없음 | 모든 요청 실패 | 시작 시 키 검증 + 에러 메시지 |

---

### 4. 계획 vs 실제 구현 차이

| 항목 | 계획 | 실제 구현 | 평가 |
|------|------|----------|------|
| 임베딩 모델 | `text-embedding-004` (768d) | `gemini-embedding-001` (3072d) | 개선 - 더 높은 임베딩 품질 |
| Python SDK | `google-generativeai` | `google-genai` (신규 SDK) | 개선 - 최신 API, 더 나은 타입 지원 |
| 임베딩 차원 | 768 | 3072 | 개선 - Qdrant, 테스트 코드에 반영됨 |
| 생성 모델 | `gemini-2.5-flash` | `gemini-2.5-flash` | 일치 |
| Docker 이미지 | `qdrant/qdrant:v1.12.0` | `qdrant/qdrant:latest` | 후퇴 - 재현성 약화 |
| 핵심 용어 수 | 20개 | 7개 | 축소 - 충분성 검토 필요 |
| Rate limit 대응 | 미계획 | 구현 (0.2초 딜레이, 429 재시도) | 추가 구현 - 실제 필요에 의해 추가 |
| 배치 적재 | 미계획 (전체 한 번에 upsert) | 10개 단위 배치 upsert | 추가 구현 - 대량 적재 안정성 향상 |
| evaluate.py | 미계획 | 구현 (5개 질문 E2E 평가) | 추가 구현 - 품질 검증 수단 |
| 테스트 mock 차원 | 768 | 768 (구현은 3072이나 테스트는 768 유지) | 불일치 - 동작에 영향 없으나 정합성 문제 |
| Ingestor 구조 | 단순 upsert | retry + batch + delay | 대폭 개선 |

---

### 5. 개선 권고사항

#### Phase 2에서 해결 (우선순위 높음)

1. **H-1:** `gemini_api_key`를 `SecretStr`로 변경
2. **H-2:** API 인증 미들웨어 추가 (최소 API Key 인증)
3. **H-3:** `generate_answer()`에 try-except + 재시도 로직
4. **M-4:** QdrantClient 싱글톤화 (FastAPI lifespan)
5. **M-5:** 검색 결과 0건 시 LLM 호출 스킵
6. SSE 스트리밍 응답 도입

#### Phase 3에서 해결

7. **M-1, M-2:** 계획 문서를 실제 구현에 맞게 업데이트
8. **M-6:** 핵심 용어 확장 (7 → 20개)
9. 대규모 평가 세트 + 자동 메트릭 (faithfulness, relevancy)
10. Re-ranker 도입
11. 계층적 청킹

#### Phase 4에서 해결

12. **M-3:** Docker 이미지 버전 고정
13. **L-4:** Python logging 모듈 전환
14. CI/CD 파이프라인 + 테스트 자동화
15. 모니터링 + 알림

---

### 6. 최종 판정

**APPROVED WITH CHANGES**

Phase 1 RAG PoC는 목표를 달성했다. 핵심 파이프라인(적재 → 검색 → 생성)이 정상 동작하며, 24개 테스트가 전부 통과하고, 환각 억제 동작이 확인되었다.

**긍정적 평가:**
- 모듈 분리가 깔끔함 (config / pipeline / search / chat / api)
- TDD 접근법 적용 (테스트 먼저 작성)
- 계획 대비 실제 구현이 더 나은 부분이 많음 (임베딩 모델 업그레이드, rate limit 대응, 배치 처리)
- 하이브리드 검색(RRF) 구현이 Qdrant 네이티브 API를 잘 활용

**Phase 2 진입 전 필수 조치:**
- H-1 ~ H-3 이슈 해결 (보안 + 에러 핸들링)
- M-4 (QdrantClient 싱글톤) 적용
- 테스트 mock 차원 수 정합성 확보 (768 → 3072)
