# Weighted Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 챗봇별로 Cascading(순차) 또는 Weighted(비중) 검색 모드를 선택할 수 있도록 한다.

**Architecture:** 기존 `cascading_search()`와 동일한 인터페이스의 `weighted_search()`를 신규 생성. `chat/service.py`에서 `isinstance` 기반 디스패치로 분기. JSONB 확장으로 Alembic 마이그레이션 불필요.

**Tech Stack:** FastAPI, Pydantic V2, asyncio, Qdrant, Next.js 16, React Query, TypeScript, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-04-13-weighted-search-design.md`

---

## File Structure

### Backend (생성/수정)

| 파일 | 역할 |
|------|------|
| `backend/src/search/weighted.py` | **신규** — WeightedConfig, WeightedSource, weighted_search() |
| `backend/src/chatbot/schemas.py` | 수정 — WeightedSourceSchema, search_mode 추가 |
| `backend/src/chatbot/service.py` | 수정 — _parse_search_config() 분기, get_cascading_config() 제거 |
| `backend/src/chat/service.py` | 수정 — _execute_search() 디스패치 |
| `backend/tests/test_weighted_search.py` | **신규** — weighted search 단위 테스트 |

### Frontend (생성/수정)

| 파일 | 역할 |
|------|------|
| `admin/src/features/chatbot/types.ts` | 수정 — WeightedSource, search_mode 타입 |
| `admin/src/features/chatbot/components/search-mode-selector.tsx` | **신규** — 라디오 모드 선택 |
| `admin/src/features/chatbot/components/weighted-source-editor.tsx` | **신규** — 비중 소스 편집기 |
| `admin/src/app/(dashboard)/chatbots/[id]/edit/page.tsx` | 수정 — 모드 선택 + 조건부 에디터 |
| `admin/src/app/(dashboard)/chatbots/new/page.tsx` | 수정 — 동일 변경 |

---

## Task 1: Backend 스키마 확장

**Files:**
- Modify: `backend/src/chatbot/schemas.py`

- [ ] **Step 1: schemas.py에 WeightedSourceSchema + search_mode 추가**

```python
# backend/src/chatbot/schemas.py 상단 import에 Literal 추가
import uuid
from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


# --- search_tiers 타입 검증 ---


class SearchTierSchema(BaseModel):
    """개별 검색 티어 설정."""

    sources: list[str] = Field(min_length=1)
    min_results: int = Field(ge=1, le=20, default=3)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.1)


class WeightedSourceSchema(BaseModel):
    """Weighted 검색 소스별 비중 설정."""

    source: str
    weight: float = Field(ge=0.1, le=100, default=1)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.1)


class SearchTiersConfig(BaseModel):
    """search_tiers JSONB 구조."""

    search_mode: Literal["cascading", "weighted"] = "cascading"
    tiers: list[SearchTierSchema] = Field(default_factory=list)
    weighted_sources: list[WeightedSourceSchema] = Field(default_factory=list)
    rerank_enabled: bool = False
    dictionary_enabled: bool = False
    query_rewrite_enabled: bool = False
```

- [ ] **Step 2: 서버 시작 확인**

Run: `cd backend && uv run python -c "from src.chatbot.schemas import SearchTiersConfig, WeightedSourceSchema; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/src/chatbot/schemas.py
git commit -m "feat: add WeightedSourceSchema and search_mode to SearchTiersConfig"
```

---

## Task 2: Weighted Search 엔진 — 테스트 작성

**Files:**
- Create: `backend/tests/test_weighted_search.py`

- [ ] **Step 1: 테스트 파일 생성**

```python
"""Weighted Search 단위 테스트."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from src.search.hybrid import SearchResult


def _make_result(text: str, score: float, source: str) -> SearchResult:
    return SearchResult(
        text=text, volume="vol", chunk_index=0, score=score, source=source,
    )


class TestWeightedSearch:
    """weighted_search() 단위 테스트."""

    @pytest.fixture
    def mock_client(self):
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_basic_3_sources(self, mock_client):
        """3소스 기본 검색 — score * weight 정렬 검증."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=5, score_threshold=0.0),
            WeightedSource(source="B", weight=3, score_threshold=0.0),
            WeightedSource(source="C", weight=2, score_threshold=0.0),
        ])

        a_results = [_make_result("a1", 0.3, "A"), _make_result("a2", 0.2, "A")]
        b_results = [_make_result("b1", 0.35, "B")]
        c_results = [_make_result("c1", 0.4, "C")]

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.side_effect = [a_results, b_results, c_results]
            results = await weighted_search(mock_client, "test", config, top_k=10)

        # A(0.3*0.5=0.15) > B(0.35*0.3=0.105) > A(0.2*0.5=0.1) > C(0.4*0.2=0.08)
        assert len(results) == 4
        assert results[0].source == "A"
        assert results[0].score == 0.3  # raw score 유지
        assert results[1].source == "B"

    @pytest.mark.asyncio
    async def test_score_threshold_filters_before_weight(self, mock_client):
        """raw score_threshold 필터링 — weight 곱셈 전."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=5, score_threshold=0.15),
        ])

        a_results = [
            _make_result("a1", 0.3, "A"),
            _make_result("a2", 0.1, "A"),  # 0.1 < 0.15 → 필터됨
        ]

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.return_value = a_results
            results = await weighted_search(mock_client, "test", config, top_k=10)

        assert len(results) == 1
        assert results[0].score == 0.3

    @pytest.mark.asyncio
    async def test_source_failure_isolation(self, mock_client):
        """개별 소스 실패 격리 — 나머지 정상 반환."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=5, score_threshold=0.0),
            WeightedSource(source="B", weight=3, score_threshold=0.0),
        ])

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.side_effect = [
                Exception("Qdrant down"),
                [_make_result("b1", 0.3, "B")],
            ]
            results = await weighted_search(mock_client, "test", config, top_k=10)

        assert len(results) == 1
        assert results[0].source == "B"

    @pytest.mark.asyncio
    async def test_all_sources_zero_results(self, mock_client):
        """모든 소스 0건 → 빈 리스트 반환."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=5, score_threshold=0.0),
        ])

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.return_value = []
            results = await weighted_search(mock_client, "test", config, top_k=10)

        assert results == []

    @pytest.mark.asyncio
    async def test_single_source(self, mock_client):
        """소스 1개 — weight는 100%."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=1, score_threshold=0.0),
        ])

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.return_value = [_make_result("a1", 0.5, "A")]
            results = await weighted_search(mock_client, "test", config, top_k=10)

        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_empty_config(self, mock_client):
        """빈 config → 빈 결과."""
        from src.search.weighted import WeightedConfig, weighted_search

        config = WeightedConfig(sources=[])

        with patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            results = await weighted_search(mock_client, "test", config, top_k=10)

        assert results == []

    @pytest.mark.asyncio
    async def test_non_integer_weights(self, mock_client):
        """비정수 weight — 비율 계산 정상."""
        from src.search.weighted import WeightedConfig, WeightedSource, weighted_search

        config = WeightedConfig(sources=[
            WeightedSource(source="A", weight=0.7, score_threshold=0.0),
            WeightedSource(source="B", weight=0.3, score_threshold=0.0),
        ])

        with patch("src.search.weighted.hybrid_search") as mock_hs, \
             patch("src.search.weighted.embed_dense_query", new_callable=AsyncMock, return_value=[0.1]*1536), \
             patch("src.search.weighted.embed_sparse_async", new_callable=AsyncMock, return_value=([1],[0.5])):
            mock_hs.side_effect = [
                [_make_result("a1", 0.3, "A")],
                [_make_result("b1", 0.3, "B")],
            ]
            results = await weighted_search(mock_client, "test", config, top_k=10)

        # 동일 score 0.3일 때 A(0.7) > B(0.3)
        assert results[0].source == "A"
        assert results[1].source == "B"
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && uv run python -m pytest tests/test_weighted_search.py -v --no-header 2>&1 | head -20`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.search.weighted'`

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_weighted_search.py
git commit -m "test: add weighted search unit tests (RED)"
```

---

## Task 3: Weighted Search 엔진 — 구현

**Files:**
- Create: `backend/src/search/weighted.py`

- [ ] **Step 1: weighted.py 생성**

```python
"""Weighted Search — 소스별 비중 기반 병렬 검색.

모든 소스를 asyncio.gather로 병렬 검색한 뒤,
소스별 weight 비율에 따라 score를 가중하여 상위 결과를 반환한다.
"""

import asyncio
import logging
from dataclasses import dataclass

from qdrant_client import AsyncQdrantClient

from src.common.gemini import embed_dense_query
from src.pipeline.embedder import embed_sparse_async
from src.search.hybrid import SearchResult, hybrid_search

logger = logging.getLogger(__name__)


@dataclass
class WeightedSource:
    """Weighted 검색 소스 설정.

    Attributes:
        source: 데이터 소스 식별자 (예: ``"A"``).
        weight: 비중 비율 숫자 (예: 5, 3, 2). 합계에서 비율 자동 계산.
        score_threshold: RRF fusion 점수 하한 (raw score 기준).
    """

    source: str
    weight: float = 1.0
    score_threshold: float = 0.1


@dataclass
class WeightedConfig:
    """Weighted Search 전체 설정.

    Attributes:
        sources: 비중이 설정된 소스 리스트.
    """

    sources: list[WeightedSource]


async def weighted_search(
    client: AsyncQdrantClient,
    query: str,
    config: WeightedConfig,
    top_k: int = 10,
    dense_embedding: list[float] | None = None,
) -> list[SearchResult]:
    """소스별 비중 기반 병렬 검색 — 임베딩 1회, 결과 가중 정렬.

    각 소스를 asyncio.gather로 병렬 검색한 뒤, raw score로 threshold 필터링 후
    score * weight 비율로 정렬하여 상위 top_k개를 반환한다.
    개별 소스 실패는 격리 처리 (log + skip).

    Args:
        client: Qdrant 비동기 클라이언트.
        query: 사용자 질의 텍스트.
        config: 소스별 비중 설정.
        top_k: 최종 반환할 최대 결과 수.
        dense_embedding: 사전 계산된 dense 벡터 (None이면 내부 계산).

    Returns:
        가중 정렬된 SearchResult 리스트 (최대 top_k건). 0건이면 빈 리스트.
    """
    if not config.sources:
        return []

    # 임베딩 1회 계산
    dense = dense_embedding if dense_embedding is not None else await embed_dense_query(query)
    sparse = await embed_sparse_async(query)

    # weight_map: {source: normalized_weight}
    total_weight = sum(ws.weight for ws in config.sources)
    if total_weight <= 0:
        return []
    weight_map = {ws.source: ws.weight / total_weight for ws in config.sources}
    threshold_map = {ws.source: ws.score_threshold for ws in config.sources}

    # 소스별 병렬 검색
    async def _search_source(ws: WeightedSource) -> list[SearchResult]:
        try:
            return await hybrid_search(
                client,
                query,
                top_k=top_k,
                source_filter=[ws.source],
                dense_embedding=dense,
                sparse_embedding=sparse,
            )
        except Exception as e:
            logger.warning(
                "Weighted search source '%s' failed (%s: %s). Skipping.",
                ws.source, type(e).__name__, e,
            )
            return []

    per_source_results = await asyncio.gather(
        *[_search_source(ws) for ws in config.sources]
    )

    # 소스별 raw score_threshold 필터링 + 전체 병합
    all_results: list[SearchResult] = []
    for ws, results in zip(config.sources, per_source_results):
        threshold = threshold_map[ws.source]
        qualified = [r for r in results if r.score >= threshold]
        all_results.extend(qualified)

    # 가중 정렬 (SearchResult.score는 raw 유지, 정렬 key만 가중)
    all_results.sort(
        key=lambda r: r.score * weight_map.get(r.source, 0),
        reverse=True,
    )
    return all_results[:top_k]
```

- [ ] **Step 2: 테스트 실행 — 통과 확인**

Run: `cd backend && uv run python -m pytest tests/test_weighted_search.py -v --no-header`
Expected: 7 passed

- [ ] **Step 3: Commit**

```bash
git add backend/src/search/weighted.py
git commit -m "feat: implement weighted_search with score weighting algorithm"
```

---

## Task 4: Chatbot Service 라우팅

**Files:**
- Modify: `backend/src/chatbot/service.py`
- Create: `backend/tests/test_chatbot_weighted_config.py`

- [ ] **Step 1: 테스트 작성**

```python
"""ChatbotService weighted config 파싱 테스트."""

import pytest

from src.chatbot.service import ChatbotService
from src.search.cascading import CascadingConfig
from src.search.weighted import WeightedConfig


class TestParseSearchConfig:

    def test_weighted_mode(self):
        """search_mode=weighted → WeightedConfig."""
        data = {
            "search_mode": "weighted",
            "weighted_sources": [
                {"source": "A", "weight": 5, "score_threshold": 0.1},
                {"source": "B", "weight": 3, "score_threshold": 0.08},
            ],
        }
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, WeightedConfig)
        assert len(config.sources) == 2
        assert config.sources[0].source == "A"
        assert config.sources[0].weight == 5

    def test_cascading_mode_default(self):
        """search_mode 미지정 → CascadingConfig."""
        data = {
            "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
        }
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, CascadingConfig)
        assert len(config.tiers) == 1

    def test_invalid_mode_fallback(self):
        """잘못된 mode → CascadingConfig fallback."""
        data = {"search_mode": "invalid_mode", "tiers": []}
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, CascadingConfig)
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd backend && uv run python -m pytest tests/test_chatbot_weighted_config.py -v --no-header 2>&1 | head -15`
Expected: FAIL — `AttributeError: type object 'ChatbotService' has no attribute '_parse_search_config'`

- [ ] **Step 3: chatbot/service.py 수정**

`backend/src/chatbot/service.py`를 다음과 같이 수정:

```python
"""챗봇 설정 Service."""

import uuid

from fastapi import HTTPException, status

from src.chatbot.models import ChatbotConfig
from src.chatbot.repository import ChatbotRepository
from src.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate, SearchTiersConfig
from src.search.cascading import CascadingConfig, SearchTier
from src.search.weighted import WeightedConfig, WeightedSource

# 타입 유니온
SearchConfig = CascadingConfig | WeightedConfig

DEFAULT_CASCADING_CONFIG = CascadingConfig(
    tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.1)]
)
DEFAULT_RERANK_ENABLED = False
DEFAULT_QUERY_REWRITE_ENABLED = False


class ChatbotService:
    def __init__(self, repo: ChatbotRepository) -> None:
        self.repo = repo

    async def list_active(self) -> list[ChatbotConfig]:
        return await self.repo.list_active()

    async def list_all(self) -> list[ChatbotConfig]:
        return await self.repo.list_all()

    async def list_paginated(
        self, limit: int = 20, offset: int = 0
    ) -> tuple[list[ChatbotConfig], int]:
        items = await self.repo.list_paginated(limit=limit, offset=offset)
        total = await self.repo.count_all()
        return items, total

    async def get_by_id(self, config_id: uuid.UUID) -> ChatbotConfig:
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        return config

    async def get_search_config(
        self, chatbot_id: str | None
    ) -> tuple[SearchConfig, bool, bool]:
        """chatbot_id로 SearchConfig + rerank_enabled + query_rewrite_enabled를 조회."""
        if chatbot_id is None:
            return DEFAULT_CASCADING_CONFIG, DEFAULT_RERANK_ENABLED, DEFAULT_QUERY_REWRITE_ENABLED
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )
        search_config = self._parse_search_config(config.search_tiers)
        rerank_enabled = config.search_tiers.get("rerank_enabled", DEFAULT_RERANK_ENABLED)
        query_rewrite_enabled = config.search_tiers.get(
            "query_rewrite_enabled", DEFAULT_QUERY_REWRITE_ENABLED
        )
        return search_config, rerank_enabled, query_rewrite_enabled

    async def get_config_id(self, chatbot_id: str | None) -> uuid.UUID | None:
        if chatbot_id is None:
            return None
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        return config.id if config else None

    async def create(self, data: ChatbotConfigCreate) -> ChatbotConfig:
        existing = await self.repo.get_by_chatbot_id(data.chatbot_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"chatbot_id '{data.chatbot_id}' 이미 존재합니다",
            )
        dump = data.model_dump()
        dump["search_tiers"] = dump["search_tiers"] if isinstance(dump["search_tiers"], dict) else data.search_tiers.model_dump()
        config = ChatbotConfig(**dump)
        saved = await self.repo.create(config)
        await self.repo.commit()
        return saved

    async def update(
        self, config_id: uuid.UUID, data: ChatbotConfigUpdate
    ) -> ChatbotConfig:
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        updates = data.model_dump(exclude_unset=True)
        if "search_tiers" in updates and updates["search_tiers"] is not None:
            st = updates["search_tiers"]
            if not isinstance(st, dict):
                updates["search_tiers"] = data.search_tiers.model_dump()
        updated = await self.repo.update(config, updates)
        await self.repo.commit()
        return updated

    @staticmethod
    def _parse_search_config(tiers_data: dict) -> SearchConfig:
        """JSONB search_tiers → CascadingConfig 또는 WeightedConfig 변환."""
        mode = tiers_data.get("search_mode", "cascading")
        if mode == "weighted":
            ws_list = tiers_data.get("weighted_sources", [])
            return WeightedConfig(
                sources=[
                    WeightedSource(
                        source=ws["source"],
                        weight=ws.get("weight", 1),
                        score_threshold=ws.get("score_threshold", 0.1),
                    )
                    for ws in ws_list
                ]
            )
        # cascading (기본값 + 잘못된 mode 포함)
        tiers_list = tiers_data.get("tiers", [])
        return CascadingConfig(
            tiers=[
                SearchTier(
                    sources=t["sources"],
                    min_results=t.get("min_results", 3),
                    score_threshold=t.get("score_threshold", 0.1),
                )
                for t in tiers_list
            ]
        )
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd backend && uv run python -m pytest tests/test_chatbot_weighted_config.py tests/test_weighted_search.py -v --no-header`
Expected: 10 passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/chatbot/service.py backend/tests/test_chatbot_weighted_config.py
git commit -m "feat: route search config to CascadingConfig or WeightedConfig"
```

---

## Task 5: Chat Service 디스패치

**Files:**
- Modify: `backend/src/chat/service.py`

- [ ] **Step 1: import 추가 + _execute_search 헬퍼 추가**

`backend/src/chat/service.py` 상단에 import 추가:

```python
from src.search.weighted import WeightedConfig, weighted_search
```

`ChatService` 클래스 내부에 헬퍼 메서드 추가:

```python
    @staticmethod
    async def _execute_search(qdrant, query, config, top_k, dense_embedding):
        """검색 모드에 따라 cascading 또는 weighted 검색 디스패치."""
        if isinstance(config, WeightedConfig):
            return await weighted_search(
                qdrant, query, config, top_k=top_k, dense_embedding=dense_embedding,
            )
        return await cascading_search(
            qdrant, query, config, top_k=top_k, dense_embedding=dense_embedding,
        )
```

- [ ] **Step 2: process_chat()에서 cascading_search → _execute_search 교체**

`process_chat()` 내에서 변수명 `cascading_config` → `search_config`로 변경하고, 호출 교체:

```python
        # 기존:
        # cascading_config, rerank_enabled, query_rewrite_enabled = (
        #     await self.chatbot_service.get_search_config(request.chatbot_id)
        # )
        # results = await cascading_search(
        #     qdrant, search_query, cascading_config, top_k=50,
        #     dense_embedding=query_embedding,
        # )

        # 변경:
        search_config, rerank_enabled, query_rewrite_enabled = (
            await self.chatbot_service.get_search_config(request.chatbot_id)
        )
        # ... (query rewrite 부분 기존 동일) ...
        results = await self._execute_search(
            qdrant, search_query, search_config, top_k=50,
            dense_embedding=query_embedding,
        )
```

- [ ] **Step 3: process_chat_stream()에서 동일하게 교체**

`process_chat_stream()` 내에서도 동일하게 `cascading_config` → `search_config`, `cascading_search` → `self._execute_search` 교체.

- [ ] **Step 4: 기존 테스트 회귀 확인**

Run: `cd backend && uv run python -m pytest tests/test_chat_service.py tests/test_weighted_search.py tests/test_chatbot_weighted_config.py -v --no-header 2>&1 | tail -5`
Expected: all passed

- [ ] **Step 5: Commit**

```bash
git add backend/src/chat/service.py
git commit -m "feat: dispatch search to cascading or weighted based on config type"
```

---

## Task 6: Frontend 타입 확장

**Files:**
- Modify: `admin/src/features/chatbot/types.ts`

- [ ] **Step 1: types.ts 수정**

```typescript
export interface SearchTier {
  sources: string[];
  min_results: number;
  score_threshold: number;
}

export interface WeightedSource {
  source: string;
  weight: number;
  score_threshold: number;
}

export interface SearchTiersConfig {
  search_mode?: "cascading" | "weighted";
  tiers: SearchTier[];
  weighted_sources?: WeightedSource[];
  rerank_enabled?: boolean;
  dictionary_enabled?: boolean;
  query_rewrite_enabled?: boolean;
}

export interface ChatbotConfig {
  id: string;
  chatbot_id: string;
  display_name: string;
  description: string;
  system_prompt: string;
  persona_name: string;
  search_tiers: SearchTiersConfig;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd admin && npx tsc --noEmit 2>&1 | grep -i "types.ts" | head -5`
Expected: no errors related to types.ts

- [ ] **Step 3: Commit**

```bash
git add admin/src/features/chatbot/types.ts
git commit -m "feat: add WeightedSource and search_mode to frontend types"
```

---

## Task 7: SearchModeSelector 컴포넌트

**Files:**
- Create: `admin/src/features/chatbot/components/search-mode-selector.tsx`

- [ ] **Step 1: 컴포넌트 생성**

```tsx
"use client";

interface SearchModeSelectorProps {
  mode: "cascading" | "weighted";
  onChange: (mode: "cascading" | "weighted") => void;
}

export default function SearchModeSelector({
  mode,
  onChange,
}: SearchModeSelectorProps) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-foreground mb-2">
        검색 전략
      </legend>
      <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="radio"
          name="search_mode"
          value="cascading"
          checked={mode === "cascading"}
          onChange={() => onChange("cascading")}
          className="mt-0.5 accent-primary"
        />
        <div>
          <div className="text-sm font-medium">순차 검색 (Cascading)</div>
          <div className="text-xs text-muted-foreground">
            우선순위 순서로 검색하고, 결과가 충분하면 다음 단계를 건너뜁니다
          </div>
        </div>
      </label>
      <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/30 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
        <input
          type="radio"
          name="search_mode"
          value="weighted"
          checked={mode === "weighted"}
          onChange={() => onChange("weighted")}
          className="mt-0.5 accent-primary"
        />
        <div>
          <div className="text-sm font-medium">비중 검색 (Weighted)</div>
          <div className="text-xs text-muted-foreground">
            모든 소스를 동시에 검색하고, 비중에 따라 결과를 혼합합니다
          </div>
        </div>
      </label>
    </fieldset>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/features/chatbot/components/search-mode-selector.tsx
git commit -m "feat: add SearchModeSelector radio component"
```

---

## Task 8: WeightedSourceEditor 컴포넌트

**Files:**
- Create: `admin/src/features/chatbot/components/weighted-source-editor.tsx`

- [ ] **Step 1: 컴포넌트 생성**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import type { WeightedSource } from "@/features/chatbot/types";
import { useSearchableCategories } from "@/features/data-source/hooks";

interface WeightedSourceEditorProps {
  sources: WeightedSource[];
  onChange: (sources: WeightedSource[]) => void;
}

export default function WeightedSourceEditor({
  sources,
  onChange,
}: WeightedSourceEditorProps) {
  const { data: categories = [] } = useSearchableCategories();

  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);

  function addSource() {
    const usedSources = new Set(sources.map((s) => s.source));
    const available = categories.find((c) => !usedSources.has(c.key));
    if (!available) return;
    onChange([
      ...sources,
      { source: available.key, weight: 1, score_threshold: 0.1 },
    ]);
  }

  function removeSource(index: number) {
    if (sources.length <= 1) return;
    onChange(sources.filter((_, i) => i !== index));
  }

  function updateSource(index: number, updates: Partial<WeightedSource>) {
    onChange(
      sources.map((s, i) => (i === index ? { ...s, ...updates } : s))
    );
  }

  const usedSources = new Set(sources.map((s) => s.source));
  const hasAvailable = categories.some((c) => !usedSources.has(c.key));

  return (
    <div className="space-y-3">
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          소스를 추가하세요
        </p>
      ) : (
        <>
          {/* 헤더 */}
          <div className="grid grid-cols-[1fr_80px_100px_40px_60px] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>소스</span>
            <span>비중</span>
            <span>점수 임계값</span>
            <span></span>
            <span className="text-right">비율</span>
          </div>

          {/* 소스 행 */}
          {sources.map((s, i) => {
            const pct = totalWeight > 0 ? ((s.weight / totalWeight) * 100).toFixed(1) : "0.0";
            const catName = categories.find((c) => c.key === s.source)?.name ?? s.source;
            return (
              <div
                key={s.source}
                className="grid grid-cols-[1fr_80px_100px_40px_60px] gap-2 items-center"
              >
                {/* 소스 선택 */}
                <select
                  value={s.source}
                  onChange={(e) => updateSource(i, { source: e.target.value })}
                  className="text-sm border rounded-md px-2 py-1.5 bg-background"
                >
                  <option value={s.source}>{catName} ({s.source})</option>
                  {categories
                    .filter((c) => !usedSources.has(c.key) || c.key === s.source)
                    .map((c) => (
                      c.key !== s.source && (
                        <option key={c.key} value={c.key}>
                          {c.name} ({c.key})
                        </option>
                      )
                    ))}
                </select>

                {/* 비중 */}
                <Input
                  type="number"
                  min={0.1}
                  max={100}
                  step={1}
                  value={s.weight}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val >= 0.1) updateSource(i, { weight: val });
                  }}
                  className="h-8 text-sm text-center"
                />

                {/* 점수 임계값 */}
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={s.score_threshold}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      updateSource(i, {
                        score_threshold: Math.round(Math.max(0, Math.min(1, val)) * 100) / 100,
                      });
                    }
                  }}
                  className="h-8 text-sm text-center"
                />

                {/* 삭제 */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSource(i)}
                  disabled={sources.length <= 1}
                  className="h-8 w-8 p-0"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>

                {/* 비율 */}
                <span className="text-sm text-right tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </div>
            );
          })}

          {/* 합계 */}
          <div className="flex justify-between items-center pt-2 border-t text-sm">
            <span className="text-muted-foreground">
              합계: {totalWeight}
            </span>
            <span className="tabular-nums font-medium">
              {totalWeight > 0 ? "100.0%" : "0%"}
            </span>
          </div>
        </>
      )}

      {/* 소스 추가 */}
      <Button
        variant="outline"
        size="sm"
        onClick={addSource}
        disabled={!hasAvailable}
        className="w-full"
      >
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        소스 추가
      </Button>

      <p className="text-xs text-muted-foreground">
        비중은 비율로 자동 계산됩니다. 예: 5:3:2 → 50%, 30%, 20%.
        점수 임계값은 RRF fusion 기준 0.05~0.3 범위를 권장합니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/features/chatbot/components/weighted-source-editor.tsx
git commit -m "feat: add WeightedSourceEditor with ratio input UI"
```

---

## Task 9: 챗봇 편집 페이지 통합

**Files:**
- Modify: `admin/src/app/(dashboard)/chatbots/[id]/edit/page.tsx`

- [ ] **Step 1: import 추가**

파일 상단에 추가:

```typescript
import SearchModeSelector from "@/features/chatbot/components/search-mode-selector";
import WeightedSourceEditor from "@/features/chatbot/components/weighted-source-editor";
import type { WeightedSource } from "@/features/chatbot/types";
```

- [ ] **Step 2: state 추가**

기존 state 선언 근처에 추가:

```typescript
const [searchMode, setSearchMode] = useState<"cascading" | "weighted">("cascading");
const [weightedSources, setWeightedSources] = useState<WeightedSource[]>([]);
```

- [ ] **Step 3: useEffect에서 초기값 로드**

기존 config 로드 useEffect 내에 추가:

```typescript
setSearchMode(config.search_tiers?.search_mode ?? "cascading");
setWeightedSources(config.search_tiers?.weighted_sources ?? []);
```

- [ ] **Step 4: mutation payload에 search_mode + weighted_sources 추가**

mutation의 `search_tiers` 객체에 추가:

```typescript
search_tiers: {
  search_mode: searchMode,
  tiers,
  weighted_sources: weightedSources,
  rerank_enabled: reranking,
  dictionary_enabled: dictionaryEnabled,
  query_rewrite_enabled: queryRewriteEnabled,
},
```

- [ ] **Step 5: 검색 설정 UI에 모드 선택 + 조건부 에디터 렌더링**

기존 `<SearchTierEditor>` 위에 `<SearchModeSelector>` 추가하고, 조건부 렌더링:

```tsx
<SearchModeSelector mode={searchMode} onChange={setSearchMode} />

<div className="mt-4">
  {searchMode === "cascading" ? (
    <SearchTierEditor tiers={tiers} onChange={setTiers} />
  ) : (
    <WeightedSourceEditor sources={weightedSources} onChange={setWeightedSources} />
  )}
</div>
```

- [ ] **Step 6: Commit**

```bash
git add admin/src/app/\(dashboard\)/chatbots/\[id\]/edit/page.tsx
git commit -m "feat: integrate search mode selector in chatbot edit page"
```

---

## Task 10: 챗봇 생성 페이지 통합

**Files:**
- Modify: `admin/src/app/(dashboard)/chatbots/new/page.tsx`

- [ ] **Step 1: edit 페이지와 동일하게 변경**

import, state, mutation payload, UI를 Task 9와 동일하게 적용.

- [ ] **Step 2: Commit**

```bash
git add admin/src/app/\(dashboard\)/chatbots/new/page.tsx
git commit -m "feat: integrate search mode selector in chatbot new page"
```

---

## Task 11: E2E 검증

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `cd backend && uv run python -m pytest tests/test_weighted_search.py tests/test_chatbot_weighted_config.py -v --no-header`
Expected: 10 passed

- [ ] **Step 2: 프론트엔드 빌드 확인**

Run: `cd admin && pnpm build 2>&1 | tail -5`
Expected: Build successful

- [ ] **Step 3: 브라우저 수동 검증**

1. Admin → 챗봇 생성 → "비중 검색" 선택 → A:5, B:3, C:2 설정 → 저장
2. 챗봇 편집 → 설정이 유지되는지 확인
3. 모드 전환 (Weighted → Cascading → Weighted) → 양쪽 설정 보존 확인
4. 채팅 테스트 → 응답 정상 확인

- [ ] **Step 4: 최종 커밋 + 푸쉬**

```bash
git push origin main
```
