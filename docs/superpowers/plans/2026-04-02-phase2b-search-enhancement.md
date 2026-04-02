# Phase 2B: 검색 고도화 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A/B/C 데이터 소스 필터링 + Cascading Search + Confidence Fallback + Re-ranking을 구현하여, 레드팀이 다양한 챗봇 조합으로 검색 품질을 테스트할 수 있게 한다.

**Architecture:** 기존 `hybrid_search`에 payload 필터 파라미터 추가 → `cascading_search`가 티어별로 필터된 검색을 순차 호출 → 결과 병합 → Re-ranker로 정밀 재순위 → `/chat` API에서 `chatbot_id`별 설정 적용.

**Tech Stack:** FastAPI 0.115, Qdrant 1.12 (payload filter + index), google-genai 1.68.0, fastembed (BM25), sentence-transformers (cross-encoder)

---

## 사전 요건

- Phase 1 RAG PoC 완료 (현재 상태)
- Docker Desktop 실행 중 (Qdrant)
- `backend/.env`에 `GEMINI_API_KEY` 설정됨

---

## 파일 구조 맵

```
backend/
├── src/
│   ├── config.py                    # [수정] cascading 기본값 추가
│   ├── qdrant_client.py             # [수정] payload index 생성 함수 추가
│   ├── pipeline/
│   │   ├── chunker.py               # [수정] Chunk에 source 필드 추가
│   │   └── ingestor.py              # [수정] payload에 source 추가
│   ├── search/
│   │   ├── hybrid.py                # [수정] source_filter 파라미터 추가
│   │   ├── cascading.py             # [신규] Cascading Search + Confidence Fallback
│   │   └── reranker.py              # [신규] Cross-encoder Re-ranking
│   └── chatbot/
│       ├── __init__.py              # [신규]
│       └── configs.py               # [신규] 챗봇별 검색 설정 레지스트리
├── api/
│   └── routes.py                    # [수정] chatbot_id 지원 + cascading + reranker 통합
└── tests/
    ├── test_chunker.py              # [수정] source 필드 테스트 추가
    ├── test_ingestor.py             # [수정] source payload 테스트 추가
    ├── test_search.py               # [수정] 필터 테스트 추가
    ├── test_cascading.py            # [신규] Cascading Search 테스트
    ├── test_reranker.py             # [신규] Re-ranking 테스트
    ├── test_chatbot_config.py       # [신규] 챗봇 설정 테스트
    └── test_api.py                  # [수정] chatbot_id 테스트 추가
```

---

## Task 1: Chunk source 필드 + Config 확장

**Files:** `src/pipeline/chunker.py`, `src/config.py`, `tests/test_chunker.py`

- [ ] **1.1** `tests/test_chunker.py`에 source 필드 테스트 추가 (RED)

```python
# tests/test_chunker.py 하단에 추가

def test_chunk_has_source_field_default_empty():
    chunks = chunk_text("짧은 텍스트", volume="vol_001")
    assert chunks[0].source == ""


def test_chunk_has_source_field_set():
    chunks = chunk_text("짧은 텍스트", volume="vol_001", source="A")
    assert chunks[0].source == "A"
```

- [ ] **1.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_chunker.py::test_chunk_has_source_field_default_empty -v`
Expected: FAIL — `chunk_text() got an unexpected keyword argument 'source'`

- [ ] **1.3** `Chunk` dataclass에 `source` 필드 추가 + `chunk_text`에 `source` 파라미터 추가

```python
# src/pipeline/chunker.py

from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int
    source: str = ""


def chunk_text(
    text: str,
    volume: str,
    max_chars: int = 500,
    overlap: int = 50,
    source: str = "",
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
            chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index, source=source))
            chunk_index += 1
            tail = buffer[-overlap:] if overlap > 0 and len(buffer) > overlap else ""
            buffer = (tail + "\n\n" + para).strip() if tail else para
        else:
            buffer = candidate

    if buffer.strip():
        chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index, source=source))

    return chunks
```

- [ ] **1.4** 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_chunker.py -v`
Expected: 기존 테스트 + 신규 2개 전부 PASS

- [ ] **1.5** Config에 cascading 기본값 추가

```python
# src/config.py

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "malssum_poc"

    # Cascading search 기본값
    cascade_score_threshold: float = 0.75
    cascade_fallback_threshold: float = 0.60
    cascade_min_results: int = 3

    model_config = {"env_file": ".env"}


settings = Settings()
```

- [ ] **1.6** 커밋

```bash
cd backend && git add src/pipeline/chunker.py src/config.py tests/test_chunker.py
git commit -m "feat: Chunk에 source 필드 추가, Config에 cascading 설정 추가"
```

---

## Task 2: Ingestor source payload 추가

**Files:** `src/pipeline/ingestor.py`, `tests/test_ingestor.py`

- [ ] **2.1** `tests/test_ingestor.py`에 source payload 테스트 추가 (RED)

```python
# tests/test_ingestor.py 하단에 추가

def test_ingest_payload_includes_source():
    mock_client = MagicMock()
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0, source="A")]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 3072),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    upsert_call = mock_client.upsert.call_args
    points = upsert_call.kwargs["points"]
    assert points[0].payload["source"] == "A"


def test_ingest_payload_source_default_empty():
    mock_client = MagicMock()
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0)]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 3072),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    upsert_call = mock_client.upsert.call_args
    points = upsert_call.kwargs["points"]
    assert points[0].payload["source"] == ""
```

- [ ] **2.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_ingestor.py::test_ingest_payload_includes_source -v`
Expected: FAIL — payload에 `source` 키가 없음

- [ ] **2.3** `ingestor.py`에 source payload 추가

```python
# src/pipeline/ingestor.py — payload 딕셔너리 부분만 수정
# ingest_chunks 함수 내 PointStruct 생성 부분:

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
                    "source": chunk.source,
                },
            )
        )
```

- [ ] **2.4** 전체 ingestor 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_ingestor.py -v`
Expected: 기존 테스트 + 신규 2개 전부 PASS

- [ ] **2.5** 커밋

```bash
cd backend && git add src/pipeline/ingestor.py tests/test_ingestor.py
git commit -m "feat: ingestor payload에 source 필드 추가"
```

---

## Task 3: Qdrant payload index + hybrid_search 필터 지원

**Files:** `src/qdrant_client.py`, `src/search/hybrid.py`, `tests/test_search.py`

- [ ] **3.1** `tests/test_search.py`에 필터 테스트 추가 (RED)

```python
# tests/test_search.py 하단에 추가

def test_hybrid_search_with_source_filter():
    mock_client = MagicMock()
    mock_response = MagicMock()
    mock_response.points = [
        _make_mock_point("A 말씀", "vol_001", 0.90),
    ]
    mock_client.query_points.return_value = mock_response

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.1] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        results = hybrid_search(mock_client, "질문", top_k=10, source_filter=["A"])

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs["query_filter"] is not None


def test_hybrid_search_without_filter_passes_none():
    mock_client = MagicMock()
    mock_client.query_points.return_value = MagicMock(points=[])

    with (
        patch("src.search.hybrid.embed_dense_query", return_value=[0.0] * 768),
        patch("src.search.hybrid.embed_sparse", return_value=([0], [1.0])),
    ):
        hybrid_search(mock_client, "질문", top_k=5)

    call_kwargs = mock_client.query_points.call_args.kwargs
    assert call_kwargs.get("query_filter") is None
```

- [ ] **3.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_search.py::test_hybrid_search_with_source_filter -v`
Expected: FAIL — `hybrid_search() got an unexpected keyword argument 'source_filter'`

- [ ] **3.3** `hybrid_search`에 `source_filter` 파라미터 추가

```python
# src/search/hybrid.py

from dataclasses import dataclass
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
    Filter,
    FieldCondition,
    MatchAny,
)
from src.pipeline.embedder import embed_dense_query, embed_sparse
from src.config import settings


@dataclass
class SearchResult:
    text: str
    volume: str
    chunk_index: int
    score: float
    source: str = ""


def hybrid_search(
    client: QdrantClient,
    query: str,
    top_k: int = 10,
    source_filter: list[str] | None = None,
) -> list[SearchResult]:
    dense = embed_dense_query(query)
    sparse_indices, sparse_values = embed_sparse(query)

    query_filter = None
    if source_filter:
        query_filter = Filter(
            must=[FieldCondition(key="source", match=MatchAny(any=source_filter))]
        )

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
        query_filter=query_filter,
        limit=top_k,
    )

    return [
        SearchResult(
            text=point.payload["text"],
            volume=point.payload["volume"],
            chunk_index=point.payload.get("chunk_index", 0),
            score=point.score,
            source=point.payload.get("source", ""),
        )
        for point in response.points
    ]
```

- [ ] **3.4** 전체 search 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_search.py -v`
Expected: 기존 2개 + 신규 2개 = 4개 PASS

- [ ] **3.5** `qdrant_client.py`에 payload index 생성 함수 추가

```python
# src/qdrant_client.py 하단에 추가

from qdrant_client.models import PayloadSchemaType


def create_payload_indexes(client: QdrantClient, collection_name: str) -> None:
    """검색 필터링 성능을 위한 payload index 생성."""
    client.create_payload_index(
        collection_name=collection_name,
        field_name="source",
        field_schema=PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=collection_name,
        field_name="volume",
        field_schema=PayloadSchemaType.KEYWORD,
    )
```

- [ ] **3.6** 커밋

```bash
cd backend && git add src/search/hybrid.py src/qdrant_client.py tests/test_search.py
git commit -m "feat: hybrid_search에 source 필터 지원 추가, payload index 생성 함수"
```

---

## Task 4: Cascading Search 구현

**Files:** `src/search/cascading.py`, `tests/test_cascading.py`

- [ ] **4.1** `tests/test_cascading.py` 생성 (RED)

```python
# tests/test_cascading.py

from unittest.mock import MagicMock, patch
from src.search.cascading import (
    cascading_search,
    SearchTier,
    CascadingConfig,
)
from src.search.hybrid import SearchResult


def _make_results(source: str, scores: list[float]) -> list[SearchResult]:
    return [
        SearchResult(
            text=f"{source} 말씀 {i}",
            volume=f"vol_{source}_{i}",
            chunk_index=i,
            score=s,
            source=source,
        )
        for i, s in enumerate(scores)
    ]


def test_cascading_returns_first_tier_when_sufficient():
    """1차 검색에서 충분한 결과가 나오면 2차 검색 안 함."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.7),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.5),
    ])

    a_results = _make_results("A", [0.95, 0.85, 0.80])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    # hybrid_search가 1번만 호출됨 (A 티어만)
    assert mock_search.call_count == 1
    assert len(results) >= 2
    assert all(r.source == "A" for r in results)


def test_cascading_falls_back_to_next_tier():
    """1차 검색 결과 부족하면 2차 티어로 폴백."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
        SearchTier(sources=["B"], min_results=2, score_threshold=0.60),
    ])

    a_results = _make_results("A", [0.80])  # 1개뿐 (min_results=3 미달)
    b_results = _make_results("B", [0.70, 0.65, 0.62])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.side_effect = [a_results, b_results]
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert mock_search.call_count == 2
    sources = {r.source for r in results}
    assert "A" in sources
    assert "B" in sources


def test_cascading_filters_by_score_threshold():
    """score_threshold 미만 결과는 제외."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=2, score_threshold=0.80),
    ])

    a_results = _make_results("A", [0.95, 0.85, 0.60, 0.50])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert all(r.score >= 0.80 for r in results)
    assert len(results) == 2  # 0.95, 0.85만 통과


def test_cascading_returns_empty_when_all_tiers_empty():
    """모든 티어에서 결과 없으면 빈 리스트 반환."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.80),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.60),
    ])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = []
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    assert results == []


def test_cascading_respects_top_k():
    """top_k 제한을 준수."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=1, score_threshold=0.50),
    ])

    a_results = _make_results("A", [0.95, 0.90, 0.85, 0.80, 0.75])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.return_value = a_results
        results = cascading_search(MagicMock(), "질문", config, top_k=3)

    assert len(results) == 3


def test_cascading_sorts_by_score_descending():
    """병합된 결과는 score 내림차순 정렬."""
    config = CascadingConfig(tiers=[
        SearchTier(sources=["A"], min_results=3, score_threshold=0.60),
        SearchTier(sources=["B"], min_results=1, score_threshold=0.50),
    ])

    a_results = _make_results("A", [0.70])
    b_results = _make_results("B", [0.90, 0.60])

    with patch("src.search.cascading.hybrid_search") as mock_search:
        mock_search.side_effect = [a_results, b_results]
        results = cascading_search(MagicMock(), "질문", config, top_k=10)

    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)
```

- [ ] **4.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_cascading.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.search.cascading'`

- [ ] **4.3** `src/search/cascading.py` 구현

```python
# src/search/cascading.py

from dataclasses import dataclass, field
from qdrant_client import QdrantClient
from src.search.hybrid import hybrid_search, SearchResult


@dataclass
class SearchTier:
    """검색 우선순위 계층 설정."""
    sources: list[str]
    min_results: int = 3
    score_threshold: float = 0.75


@dataclass
class CascadingConfig:
    """Cascading Search 설정. tiers는 우선순위 순서."""
    tiers: list[SearchTier] = field(default_factory=list)


def cascading_search(
    client: QdrantClient,
    query: str,
    config: CascadingConfig,
    top_k: int = 10,
) -> list[SearchResult]:
    """티어별 순차 검색. 충분한 결과가 모이면 중단."""
    all_results: list[SearchResult] = []

    for tier in config.tiers:
        results = hybrid_search(
            client,
            query,
            top_k=top_k,
            source_filter=tier.sources,
        )

        # score 임계값 이상만 채택
        qualified = [r for r in results if r.score >= tier.score_threshold]
        all_results.extend(qualified)

        # 충분한 결과가 모이면 다음 티어 검색 생략
        if len(all_results) >= tier.min_results:
            break

    # score 내림차순 정렬 후 top_k 반환
    all_results.sort(key=lambda r: r.score, reverse=True)
    return all_results[:top_k]
```

- [ ] **4.4** 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_cascading.py -v`
Expected: 6개 전부 PASS

- [ ] **4.5** 커밋

```bash
cd backend && git add src/search/cascading.py tests/test_cascading.py
git commit -m "feat: Cascading Search 구현 (티어별 순차 검색 + score 임계값)"
```

---

## Task 5: 챗봇 설정 모듈

**Files:** `src/chatbot/__init__.py`, `src/chatbot/configs.py`, `tests/test_chatbot_config.py`

- [ ] **5.1** `tests/test_chatbot_config.py` 생성 (RED)

```python
# tests/test_chatbot_config.py

from src.chatbot.configs import get_chatbot_config, list_chatbot_ids, DEFAULT_CONFIG
from src.search.cascading import CascadingConfig, SearchTier


def test_get_default_config():
    config = get_chatbot_config(None)
    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) >= 1


def test_get_known_chatbot_config():
    config = get_chatbot_config("malssum_priority")
    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) >= 2
    # 첫 번째 티어는 A 소스
    assert "A" in config.tiers[0].sources


def test_get_unknown_chatbot_returns_default():
    config = get_chatbot_config("nonexistent_bot")
    assert config == DEFAULT_CONFIG


def test_list_chatbot_ids_returns_list():
    ids = list_chatbot_ids()
    assert isinstance(ids, list)
    assert "malssum_priority" in ids
    assert "all" in ids


def test_all_config_searches_all_sources():
    config = get_chatbot_config("all")
    all_sources = []
    for tier in config.tiers:
        all_sources.extend(tier.sources)
    assert "A" in all_sources
    assert "B" in all_sources
    assert "C" in all_sources
```

- [ ] **5.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_chatbot_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.chatbot'`

- [ ] **5.3** `src/chatbot/__init__.py` 생성

```python
# src/chatbot/__init__.py
```

- [ ] **5.4** `src/chatbot/configs.py` 구현

```python
# src/chatbot/configs.py

from src.search.cascading import CascadingConfig, SearchTier

# 기본 설정: 전체 소스에서 검색
DEFAULT_CONFIG = CascadingConfig(
    tiers=[
        SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60),
    ]
)

# 챗봇별 검색 설정 레지스트리
# [참고] Phase 3에서 관리자 페이지를 통해 DB 기반으로 전환 예정
# 현재는 코드 레벨 설정으로 레드팀 테스트 지원
_CHATBOT_REGISTRY: dict[str, CascadingConfig] = {
    "malssum_priority": CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
            SearchTier(sources=["B"], min_results=2, score_threshold=0.65),
            SearchTier(sources=["C"], min_results=1, score_threshold=0.60),
        ]
    ),
    "all": CascadingConfig(
        tiers=[
            SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60),
        ]
    ),
    "source_a_only": CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=1, score_threshold=0.50),
        ]
    ),
    "source_b_only": CascadingConfig(
        tiers=[
            SearchTier(sources=["B"], min_results=1, score_threshold=0.50),
        ]
    ),
}


def get_chatbot_config(chatbot_id: str | None) -> CascadingConfig:
    """챗봇 ID로 검색 설정 조회. 없으면 기본 설정 반환."""
    if chatbot_id is None:
        return DEFAULT_CONFIG
    return _CHATBOT_REGISTRY.get(chatbot_id, DEFAULT_CONFIG)


def list_chatbot_ids() -> list[str]:
    """등록된 챗봇 ID 목록 반환."""
    return list(_CHATBOT_REGISTRY.keys())
```

- [ ] **5.5** 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_chatbot_config.py -v`
Expected: 5개 전부 PASS

- [ ] **5.6** 커밋

```bash
cd backend && git add src/chatbot/ tests/test_chatbot_config.py
git commit -m "feat: 챗봇별 검색 설정 레지스트리 구현 (malssum_priority, all, source_a/b_only)"
```

---

## Task 6: /chat endpoint 업데이트

**Files:** `api/routes.py`, `tests/test_api.py`

- [ ] **6.1** `tests/test_api.py`에 chatbot_id 테스트 추가 (RED)

```python
# tests/test_api.py 하단에 추가

def test_chat_endpoint_accepts_chatbot_id():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="답변입니다."),
    ):
        response = client.post("/chat", json={"query": "질문", "chatbot_id": "malssum_priority"})

    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "답변입니다."


def test_chat_endpoint_without_chatbot_id_uses_default():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="기본 답변."),
    ):
        response = client.post("/chat", json={"query": "질문"})

    assert response.status_code == 200


def test_chat_endpoint_returns_empty_answer_when_no_results():
    with (
        patch("api.routes.cascading_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "찾을수없는질문"})

    assert response.status_code == 200
    assert "찾지 못했습니다" in response.json()["answer"]


def test_chatbot_list_endpoint():
    response = client.get("/chatbots")
    assert response.status_code == 200
    data = response.json()
    assert "chatbot_ids" in data
    assert "malssum_priority" in data["chatbot_ids"]
```

- [ ] **6.2** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_api.py::test_chat_endpoint_accepts_chatbot_id -v`
Expected: FAIL — `cascading_search` import 없음

- [ ] **6.3** `api/routes.py` 전체 수정

```python
# api/routes.py

from fastapi import APIRouter
from pydantic import BaseModel
from src.search.cascading import cascading_search
from src.chat.generator import generate_answer
from src.chatbot.configs import get_chatbot_config, list_chatbot_ids
from src.qdrant_client import get_client

router = APIRouter()


class ChatRequest(BaseModel):
    query: str
    chatbot_id: str | None = None


class Source(BaseModel):
    volume: str
    text: str
    score: float
    source: str = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    client = get_client()
    config = get_chatbot_config(request.chatbot_id)
    results = cascading_search(client, request.query, config, top_k=10)
    answer = generate_answer(request.query, results)
    return ChatResponse(
        answer=answer,
        sources=[
            Source(volume=r.volume, text=r.text, score=r.score, source=r.source)
            for r in results[:3]
        ],
    )


@router.get("/chatbots")
def get_chatbots():
    return {"chatbot_ids": list_chatbot_ids()}
```

- [ ] **6.4** 기존 test_api.py 수정 — mock 대상을 `cascading_search`로 변경

기존 테스트에서 `patch("api.routes.hybrid_search", ...)` → `patch("api.routes.cascading_search", ...)`로 변경:

```python
# tests/test_api.py — 기존 테스트의 patch 대상 변경

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from main import app

client = TestClient(app)


def _mock_search_results():
    from src.search.hybrid import SearchResult
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95, source="A"),
    ]


def test_chat_endpoint_returns_200():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란 무엇인가?"})

    assert response.status_code == 200


def test_chat_endpoint_response_has_answer_and_sources():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
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


def test_chat_endpoint_empty_results_handled():
    with (
        patch("api.routes.cascading_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "존재하지않는질문"})

    assert response.status_code == 200
    assert "answer" in response.json()


def test_chat_endpoint_accepts_chatbot_id():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="답변입니다."),
    ):
        response = client.post("/chat", json={"query": "질문", "chatbot_id": "malssum_priority"})

    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "답변입니다."


def test_chat_endpoint_without_chatbot_id_uses_default():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="기본 답변."),
    ):
        response = client.post("/chat", json={"query": "질문"})

    assert response.status_code == 200


def test_chat_endpoint_returns_empty_answer_when_no_results():
    with (
        patch("api.routes.cascading_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "찾을수없는질문"})

    assert response.status_code == 200
    assert "찾지 못했습니다" in response.json()["answer"]


def test_chatbot_list_endpoint():
    response = client.get("/chatbots")
    assert response.status_code == 200
    data = response.json()
    assert "chatbot_ids" in data
    assert "malssum_priority" in data["chatbot_ids"]
```

- [ ] **6.5** 전체 API 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_api.py -v`
Expected: 8개 전부 PASS

- [ ] **6.6** 커밋

```bash
cd backend && git add api/routes.py tests/test_api.py
git commit -m "feat: /chat endpoint에 chatbot_id 지원 추가, /chatbots 목록 endpoint 추가"
```

---

## Task 7: Re-ranking 모듈 구현 (선택)

> **참고:** Re-ranking은 `sentence-transformers` 의존성을 추가합니다 (~2GB, torch 포함).
> 레드팀 테스트에서 검색 품질이 부족할 경우 적용을 권장합니다.
> 당장 불필요하면 이 Task를 건너뛰어도 Task 1~6만으로 Cascading Search가 완전히 동작합니다.

**Files:** `src/search/reranker.py`, `tests/test_reranker.py`, `api/routes.py`

- [ ] **7.1** 의존성 추가

```bash
cd backend && uv add sentence-transformers
```

Expected: `pyproject.toml`에 `sentence-transformers` 추가됨

- [ ] **7.2** `tests/test_reranker.py` 생성 (RED)

```python
# tests/test_reranker.py

from unittest.mock import patch, MagicMock
from src.search.reranker import rerank
from src.search.hybrid import SearchResult


def _make_results() -> list[SearchResult]:
    return [
        SearchResult(text="관련성 낮은 문장", volume="vol_001", chunk_index=0, score=0.95, source="A"),
        SearchResult(text="축복의 참된 의미는 참부모님으로부터", volume="vol_002", chunk_index=1, score=0.70, source="A"),
        SearchResult(text="완전히 무관한 내용", volume="vol_003", chunk_index=2, score=0.85, source="B"),
    ]


def test_rerank_returns_reordered_results():
    results = _make_results()
    # cross-encoder 점수: [0.1, 0.9, 0.2] → vol_002가 1위로 올라와야 함
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.1, 0.9, 0.2]

    with patch("src.search.reranker._get_model", return_value=mock_model):
        reranked = rerank("축복의 의미는?", results)

    assert reranked[0].volume == "vol_002"
    assert reranked[0].score == 0.9


def test_rerank_respects_top_k():
    results = _make_results()
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.1, 0.9, 0.5]

    with patch("src.search.reranker._get_model", return_value=mock_model):
        reranked = rerank("질문", results, top_k=2)

    assert len(reranked) == 2


def test_rerank_empty_input():
    with patch("src.search.reranker._get_model"):
        reranked = rerank("질문", [])

    assert reranked == []


def test_rerank_single_result():
    results = [SearchResult(text="유일한 결과", volume="vol_001", chunk_index=0, score=0.80, source="A")]
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.95]

    with patch("src.search.reranker._get_model", return_value=mock_model):
        reranked = rerank("질문", results)

    assert len(reranked) == 1
    assert reranked[0].score == 0.95
```

- [ ] **7.3** 테스트 실패 확인

Run: `cd backend && uv run pytest tests/test_reranker.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.search.reranker'`

- [ ] **7.4** `src/search/reranker.py` 구현

```python
# src/search/reranker.py

from sentence_transformers import CrossEncoder
from src.search.hybrid import SearchResult

_model: CrossEncoder | None = None

# 한국어 지원 + 경량 모델
_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"


def _get_model() -> CrossEncoder:
    global _model
    if _model is None:
        _model = CrossEncoder(_MODEL_NAME)
    return _model


def rerank(
    query: str,
    results: list[SearchResult],
    top_k: int = 10,
) -> list[SearchResult]:
    """Cross-encoder로 검색 결과를 정밀 재순위 매김."""
    if not results:
        return []

    model = _get_model()
    pairs = [(query, r.text) for r in results]
    scores = model.predict(pairs)

    ranked = sorted(
        zip(results, scores),
        key=lambda x: float(x[1]),
        reverse=True,
    )

    return [
        SearchResult(
            text=r.text,
            volume=r.volume,
            chunk_index=r.chunk_index,
            score=float(s),
            source=r.source,
        )
        for r, s in ranked[:top_k]
    ]
```

- [ ] **7.5** 테스트 통과 확인

Run: `cd backend && uv run pytest tests/test_reranker.py -v`
Expected: 4개 전부 PASS

- [ ] **7.6** `api/routes.py`에 reranker 통합 (선택적 적용)

```python
# api/routes.py — chat 함수 내 reranker 추가
# cascading_search 결과를 rerank에 통과시킴

from src.search.reranker import rerank

@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    client = get_client()
    config = get_chatbot_config(request.chatbot_id)
    results = cascading_search(client, request.query, config, top_k=50)
    results = rerank(request.query, results, top_k=10)
    answer = generate_answer(request.query, results)
    return ChatResponse(
        answer=answer,
        sources=[
            Source(volume=r.volume, text=r.text, score=r.score, source=r.source)
            for r in results[:3]
        ],
    )
```

- [ ] **7.7** 기존 API 테스트에 reranker mock 추가

모든 기존 `test_api.py` 테스트에 `patch("api.routes.rerank", side_effect=lambda q, r, **kw: r)` 추가하여 reranker를 pass-through로 처리:

```python
# tests/test_api.py — 모든 테스트에 rerank mock 추가
# 예시: test_chat_endpoint_returns_200

def test_chat_endpoint_returns_200():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.rerank", side_effect=lambda q, r, **kw: r),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란 무엇인가?"})

    assert response.status_code == 200

# 나머지 모든 chat 테스트에도 동일하게 rerank mock 추가
```

- [ ] **7.8** 전체 테스트 통과 확인

Run: `cd backend && uv run pytest tests/ -v`
Expected: 전부 PASS

- [ ] **7.9** 커밋

```bash
cd backend && git add src/search/reranker.py tests/test_reranker.py api/routes.py tests/test_api.py pyproject.toml uv.lock
git commit -m "feat: Cross-encoder Re-ranking 모듈 추가 (ms-marco-MiniLM-L-6-v2)"
```

---

## Task 8: 전체 통합 테스트

- [ ] **8.1** 전체 테스트 실행

Run: `cd backend && uv run pytest -v`

Expected 테스트 수:
- `test_chunker.py`: 기존 + 2 (source)
- `test_ingestor.py`: 기존 + 2 (source payload)
- `test_search.py`: 기존 2 + 2 (필터) = 4
- `test_cascading.py`: 6 (신규)
- `test_chatbot_config.py`: 5 (신규)
- `test_reranker.py`: 4 (신규, Task 7 진행 시)
- `test_api.py`: 기존 4 → 8 (chatbot_id + chatbots endpoint)
- 기타 기존 테스트: 유지

Expected: 전부 PASS

- [ ] **8.2** 수동 통합 테스트 (Docker Qdrant 필요)

```bash
# Qdrant 실행 확인
docker compose up -d

# 서버 시작
cd backend && uv run uvicorn main:app --reload

# 전체 검색 (chatbot_id 없음)
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "참부모님의 축복 의미는?"}'

# A 우선 Cascading 검색
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "참부모님의 축복 의미는?", "chatbot_id": "malssum_priority"}'

# 챗봇 목록 조회
curl http://localhost:8000/chatbots

# A 소스만 검색
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "참사랑이란?", "chatbot_id": "source_a_only"}'
```

Expected:
- `malssum_priority`: A 소스 우선 결과 반환
- `source_a_only`: A 소스만 포함된 결과 반환
- `/chatbots`: `["malssum_priority", "all", "source_a_only", "source_b_only"]`

- [ ] **8.3** 최종 커밋 (필요 시)

```bash
git add -A && git commit -m "test: 전체 통합 테스트 확인"
```

---

## 태스크 요약

| Task | 설명 | 신규 테스트 수 | 필수 여부 |
|------|------|--------------|----------|
| T1 | Chunk source + Config 확장 | 2 | ✅ 필수 |
| T2 | Ingestor source payload | 2 | ✅ 필수 |
| T3 | hybrid_search 필터 + payload index | 2 | ✅ 필수 |
| T4 | Cascading Search | 6 | ✅ 필수 |
| T5 | 챗봇 설정 모듈 | 5 | ✅ 필수 |
| T6 | /chat endpoint 업데이트 | 4 | ✅ 필수 |
| T7 | Re-ranking (선택) | 4 | ⭐ 선택 |
| T8 | 전체 통합 테스트 | 0 | ✅ 필수 |
| **합계** | | **21~25** | |

**필수 Task (T1~T6, T8)** 완료 시: Cascading Search + chatbot_id 기반 다중 챗봇 검색 동작
**선택 Task (T7)** 추가 시: Cross-encoder Re-ranking으로 검색 정밀도 향상

---

## Self-Review Checklist

- [x] 설계 문서 커버: `07-multi-chatbot-version.md` (Cascading, payload 설계) → Task 3, 4
- [x] 설계 문서 커버: `11-data-routing-strategies.md` (Cascading, Metadata Pre-Filtering, Confidence Fallback) → Task 3, 4
- [x] 설계 문서 커버: `05-rag-pipeline.md` (Re-ranking) → Task 7
- [x] placeholder/TODO 없음 — 모든 코드 구체적
- [x] 타입 일관성: `SearchResult.source` 필드가 hybrid.py, cascading.py, routes.py에서 동일
- [x] `CascadingConfig`, `SearchTier` 이름이 모든 Task에서 일관
- [x] 기존 API 스키마 하위 호환: `chatbot_id`는 Optional, 없으면 기본 검색
- [x] 기존 테스트 mock 대상 `hybrid_search` → `cascading_search`로 변경 포함 (Task 6.4)
- [x] Chunk dataclass 필드 순서: `source: str = ""` 기본값 있으므로 뒤에 위치 (Python dataclass 규칙 준수)
