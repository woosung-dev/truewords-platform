# Query Rewriting + 0건 Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자 쿼리를 종교 용어로 재작성하여 검색 recall을 개선하고, 검색 결과 0건 시 두 단계 fallback UX를 제공한다.

**Architecture:** `search/query_rewriter.py`와 `search/fallback.py`를 독립 모듈로 생성하여 chat/service.py의 파이프라인 앞/뒤에 삽입한다. chatbot_config의 search_tiers JSONB에 `query_rewrite_enabled` 토글을 추가하여 챗봇별 ON/OFF 제어한다.

**Tech Stack:** FastAPI, Gemini 3.1 Pro Lite (google-genai), Qdrant, SQLModel/Alembic, Pydantic V2, Next.js (Admin UI)

**Design Spec:** `~/.gstack/projects/woosung-dev-truewords-platform/woosung-main-design-20260411-094500.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `backend/src/search/query_rewriter.py` | 사용자 쿼리 → 종교 용어 재작성 (Gemini 호출) |
| Create | `backend/src/search/fallback.py` | 검색 0건 시 두 단계 fallback (relaxed search → 질문 제안) |
| Create | `backend/tests/test_query_rewriter.py` | query_rewriter 단위 테스트 |
| Create | `backend/tests/test_fallback.py` | fallback 단위 테스트 |
| Modify | `backend/src/common/gemini.py:12` | MODEL_PRO_LITE 상수 추가 |
| Modify | `backend/src/chatbot/schemas.py:23-28` | SearchTiersConfig에 query_rewrite_enabled 필드 추가 |
| Modify | `backend/src/chatbot/service.py:60-72` | get_search_config 반환값에 query_rewrite_enabled 추가 |
| Modify | `backend/src/chat/service.py:90-127,230-265` | process_chat/process_chat_stream에 rewrite + fallback 삽입 |
| Modify | `backend/src/chat/models.py:51-62` | SearchEvent에 rewritten_query 컬럼 추가 |
| Modify | `admin/src/features/chatbot/types.ts:7-11` | SearchTiersConfig에 query_rewrite_enabled 추가 |
| Modify | `admin/src/features/chatbot/components/search-tier-editor.tsx` | Query Rewriting 토글 UI 추가 |
| Create | `backend/alembic/versions/xxxx_add_rewritten_query.py` | SearchEvent 마이그레이션 |
| Modify | `backend/tests/test_chatbot_config.py` | 스키마 테스트 업데이트 |
| Modify | `docs/TODO.md` | 완료 항목 반영 |

---

### Task 1: Query Rewriter 모듈

**Files:**
- Create: `backend/src/search/query_rewriter.py`
- Modify: `backend/src/common/gemini.py:12`
- Test: `backend/tests/test_query_rewriter.py`

- [ ] **Step 1: gemini.py에 MODEL_PRO_LITE 상수 추가**

```python
# backend/src/common/gemini.py 라인 12 뒤에 추가
MODEL_PRO_LITE = "gemini-3.1-pro-lite"
```

- [ ] **Step 2: 실패 테스트 작성 — rewrite_query 기본 동작**

```python
# backend/tests/test_query_rewriter.py
"""Query Rewriter 단위 테스트."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from src.search.query_rewriter import rewrite_query


@pytest.mark.asyncio
async def test_rewrite_query_returns_rewritten_text():
    """LLM이 재작성된 쿼리를 반환하면 그 결과를 사용한다."""
    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "참부모님이 말씀하신 축복의 의미와 정의"
        result = await rewrite_query("축복이 뭐야?")
        assert result == "참부모님이 말씀하신 축복의 의미와 정의"
        mock_gen.assert_called_once()


@pytest.mark.asyncio
async def test_rewrite_query_graceful_degradation_on_exception():
    """LLM 호출 실패 시 원본 쿼리를 그대로 반환한다."""
    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.side_effect = Exception("API error")
        result = await rewrite_query("축복이 뭐야?")
        assert result == "축복이 뭐야?"


@pytest.mark.asyncio
async def test_rewrite_query_returns_original_on_empty_response():
    """LLM이 빈 응답을 반환하면 원본 쿼리를 사용한다."""
    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = ""
        result = await rewrite_query("축복이 뭐야?")
        assert result == "축복이 뭐야?"


@pytest.mark.asyncio
async def test_rewrite_query_timeout_returns_original():
    """LLM 호출이 타임아웃되면 원본 쿼리를 반환한다."""
    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.side_effect = asyncio.TimeoutError()
        result = await rewrite_query("축복이 뭐야?")
        assert result == "축복이 뭐야?"


@pytest.mark.asyncio
async def test_rewrite_query_strips_whitespace():
    """LLM 응답의 앞뒤 공백을 제거한다."""
    with patch("src.search.query_rewriter.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_gen.return_value = "  참부모님의 축복 의미  \n"
        result = await rewrite_query("축복이 뭐야?")
        assert result == "참부모님의 축복 의미"
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_query_rewriter.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.search.query_rewriter'`

- [ ] **Step 4: query_rewriter.py 구현**

```python
# backend/src/search/query_rewriter.py
"""Query Rewriter — 사용자 쿼리를 종교 용어로 재작성.

구어체 질문을 가정연합 말씀 검색에 최적화된 표현으로 변환한다.
Gemini 3.1 Pro Lite를 사용하며, 실패 시 원본 쿼리를 그대로 반환한다.
"""

import asyncio
import logging

from src.common.gemini import generate_text, MODEL_PRO_LITE

logger = logging.getLogger(__name__)

REWRITE_TIMEOUT_SECONDS = 0.8

REWRITE_SYSTEM_PROMPT = """당신은 검색 쿼리 최적화 전문가입니다.
사용자의 질문을 가정연합 말씀 데이터베이스 검색에 최적화된 쿼리로 재작성하세요.

[핵심 용어 변환 가이드]
- 하나님/하느님 → 하늘 부모님
- 문선명/문총재 → 참부모님, 문선명 총재
- 한학자/한총재 → 참부모님, 한학자 총재
- 축복/결혼 → 축복, 축복식, 축복 결혼
- 교리/가르침 → 원리강론, 말씀
- 이상세계/천국 → 천일국
- 사랑 → 참사랑
- 예배/아침 → 훈독회

[규칙]
1. 구어체를 종교 용어가 포함된 검색용 문장으로 변환하세요.
2. 원본 질문의 의도를 유지하세요.
3. 이미 종교 용어가 포함된 구체적인 질문이면 그대로 반환하세요.
4. 재작성된 쿼리만 반환하세요. 설명이나 부가 텍스트는 포함하지 마세요.
5. 한국어로 답변하세요."""


async def rewrite_query(query: str) -> str:
    """사용자 쿼리를 검색에 최적화된 종교 용어로 재작성.

    Args:
        query: 원본 사용자 질의.

    Returns:
        재작성된 쿼리 문자열. 실패/타임아웃 시 원본 쿼리 반환 (graceful degradation).
    """
    try:
        rewritten = await asyncio.wait_for(
            generate_text(
                prompt=f"다음 질문을 검색용 쿼리로 재작성하세요:\n\n{query}",
                system_instruction=REWRITE_SYSTEM_PROMPT,
                model=MODEL_PRO_LITE,
            ),
            timeout=REWRITE_TIMEOUT_SECONDS,
        )
        rewritten = rewritten.strip()
        if not rewritten:
            logger.warning("Query rewrite returned empty response, using original query")
            return query
        logger.info("Query rewritten: '%s' → '%s'", query, rewritten)
        return rewritten
    except asyncio.TimeoutError:
        logger.warning("Query rewrite timed out (%.1fs), using original query", REWRITE_TIMEOUT_SECONDS)
        return query
    except Exception as e:
        logger.warning("Query rewrite failed (%s: %s), using original query", type(e).__name__, e)
        return query
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_query_rewriter.py -v`
Expected: 5 passed

- [ ] **Step 6: 커밋**

```bash
git add backend/src/common/gemini.py backend/src/search/query_rewriter.py backend/tests/test_query_rewriter.py
git commit -m "feat: add query rewriter module with graceful degradation"
```

---

### Task 2: Fallback Search 모듈

**Files:**
- Create: `backend/src/search/fallback.py`
- Test: `backend/tests/test_fallback.py`

- [ ] **Step 1: 실패 테스트 작성 — fallback 동작**

```python
# backend/tests/test_fallback.py
"""Fallback Search 단위 테스트."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from src.search.fallback import fallback_search
from src.search.hybrid import SearchResult


def _make_result(text: str = "test", score: float = 0.3) -> SearchResult:
    return SearchResult(text=text, volume="001", chunk_index=0, score=score, source="L")


@pytest.mark.asyncio
async def test_fallback_returns_none_when_results_exist():
    """원본 결과가 있으면 fallback을 실행하지 않는다."""
    client = AsyncMock()
    results = [_make_result()]
    out, ftype = await fallback_search(
        client=client,
        query="test",
        original_results=results,
        dense_embedding=[0.1] * 10,
    )
    assert out == results
    assert ftype == "none"
    client.query_points.assert_not_called()


@pytest.mark.asyncio
async def test_fallback_relaxed_search_removes_source_filter():
    """원본 결과 0건이면 source 필터 없이 전체 재검색한다."""
    client = AsyncMock()
    mock_point = MagicMock()
    mock_point.payload = {"text": "relaxed result", "volume": "002", "chunk_index": 1, "source": "M"}
    mock_point.score = 0.2
    client.query_points.return_value = MagicMock(points=[mock_point])

    with patch("src.search.fallback.embed_sparse_async", new_callable=AsyncMock) as mock_sparse:
        mock_sparse.return_value = ([1, 2], [0.5, 0.5])
        out, ftype = await fallback_search(
            client=client,
            query="test",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )
    assert ftype == "relaxed"
    assert len(out) == 1
    assert out[0].text == "relaxed result"


@pytest.mark.asyncio
async def test_fallback_suggestions_when_relaxed_also_empty():
    """relaxed 검색도 0건이면 LLM 질문 제안을 반환한다."""
    client = AsyncMock()
    client.query_points.return_value = MagicMock(points=[])

    with patch("src.search.fallback.embed_sparse_async", new_callable=AsyncMock) as mock_sparse, \
         patch("src.search.fallback.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_sparse.return_value = ([1], [0.5])
        mock_gen.return_value = '["축복식의 의미는?", "참부모님의 축복 말씀은?", "축복 결혼이란?"]'
        out, ftype = await fallback_search(
            client=client,
            query="축복이 뭐야?",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )
    assert ftype == "suggestions"
    assert out == []


@pytest.mark.asyncio
async def test_fallback_suggestions_returns_parsed_list():
    """LLM 질문 제안을 파싱하여 suggestions 필드로 반환한다."""
    client = AsyncMock()
    client.query_points.return_value = MagicMock(points=[])

    with patch("src.search.fallback.embed_sparse_async", new_callable=AsyncMock) as mock_sparse, \
         patch("src.search.fallback.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_sparse.return_value = ([1], [0.5])
        mock_gen.return_value = '["질문1", "질문2", "질문3"]'
        out, ftype = await fallback_search(
            client=client,
            query="test",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )
    assert ftype == "suggestions"


@pytest.mark.asyncio
async def test_fallback_suggestions_graceful_on_llm_failure():
    """LLM 실패 시에도 suggestions 타입으로 빈 결과를 반환한다."""
    client = AsyncMock()
    client.query_points.return_value = MagicMock(points=[])

    with patch("src.search.fallback.embed_sparse_async", new_callable=AsyncMock) as mock_sparse, \
         patch("src.search.fallback.generate_text", new_callable=AsyncMock) as mock_gen:
        mock_sparse.return_value = ([1], [0.5])
        mock_gen.side_effect = Exception("API error")
        out, ftype = await fallback_search(
            client=client,
            query="test",
            original_results=[],
            dense_embedding=[0.1] * 10,
        )
    assert ftype == "suggestions"
    assert out == []
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_fallback.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.search.fallback'`

- [ ] **Step 3: fallback.py 구현**

```python
# backend/src/search/fallback.py
"""Fallback Search — 검색 결과 0건 시 두 단계 fallback.

1단계(relaxed): source 필터 제거 후 전체 컬렉션 재검색.
2단계(suggestions): LLM에 관련 질문 3개 제안 요청.
"""

import json
import logging
from typing import Literal

from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
)

from src.common.gemini import generate_text, MODEL_PRO_LITE
from src.config import settings
from src.pipeline.embedder import embed_sparse_async
from src.search.hybrid import SearchResult

logger = logging.getLogger(__name__)

FallbackType = Literal["none", "relaxed", "suggestions"]

SUGGEST_SYSTEM_PROMPT = """당신은 가정연합 말씀 검색 도우미입니다.
사용자가 검색했지만 결과를 찾지 못했습니다.
사용자의 원래 질문을 참고하여, 말씀 데이터베이스에서 찾을 수 있을 만한 관련 질문 3개를 제안하세요.

[규칙]
1. 가정연합 말씀 범위 내의 질문만 제안하세요.
2. 원본 질문과 관련된 다른 관점의 질문을 제안하세요.
3. JSON 배열만 반환하세요: ["질문1", "질문2", "질문3"]"""


async def fallback_search(
    client: AsyncQdrantClient,
    query: str,
    original_results: list[SearchResult],
    dense_embedding: list[float],
    sparse_embedding: tuple[list[int], list[float]] | None = None,
    top_k: int = 10,
    score_threshold: float = 0.05,
) -> tuple[list[SearchResult], FallbackType]:
    """검색 결과 0건 시 두 단계 fallback.

    Args:
        client: Qdrant 비동기 클라이언트.
        query: 사용자 질의 텍스트.
        original_results: 원본 cascading_search 결과.
        dense_embedding: 사전 계산된 dense 벡터.
        sparse_embedding: 사전 계산된 (indices, values) 튜플 (None이면 내부 계산).
        top_k: 반환할 최대 결과 수.
        score_threshold: fallback 재검색에도 적용할 RRF 점수 하한선.

    Returns:
        (결과 리스트, fallback_type)
    """
    # 원본 결과가 있으면 fallback 불필요
    if original_results:
        return original_results, "none"

    # --- 1단계: source 필터 제거 후 전체 재검색 ---
    logger.info("Fallback Step 1: relaxed search (no source filter) for query: '%s'", query)

    if sparse_embedding is not None:
        sparse_indices, sparse_values = sparse_embedding
    else:
        sparse_indices, sparse_values = await embed_sparse_async(query)

    response = await client.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=dense_embedding, using="dense", limit=50),
            Prefetch(
                query=SparseVector(indices=sparse_indices, values=sparse_values),
                using="sparse",
                limit=50,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=None,  # source 필터 제거
        limit=top_k,
    )

    relaxed_results = [
        SearchResult(
            text=point.payload["text"],
            volume=point.payload["volume"],
            chunk_index=point.payload.get("chunk_index", 0),
            score=point.score,
            source=_extract_source(point.payload),
        )
        for point in response.points
        if point.score >= score_threshold
    ]

    if relaxed_results:
        logger.info("Fallback Step 1 found %d results", len(relaxed_results))
        return relaxed_results, "relaxed"

    # --- 2단계: LLM 질문 제안 ---
    logger.info("Fallback Step 2: generating question suggestions for query: '%s'", query)
    await _generate_suggestions(query)
    return [], "suggestions"


async def _generate_suggestions(query: str) -> list[str]:
    """LLM에 관련 질문 3개를 제안받는다. 실패 시 빈 리스트."""
    try:
        response = await generate_text(
            prompt=f"사용자 질문: {query}",
            system_instruction=SUGGEST_SYSTEM_PROMPT,
            model=MODEL_PRO_LITE,
        )
        suggestions = json.loads(response.strip())
        if isinstance(suggestions, list):
            return [s for s in suggestions[:3] if isinstance(s, str)]
    except Exception as e:
        logger.warning("Failed to generate suggestions (%s: %s)", type(e).__name__, e)
    return []


def _extract_source(payload: dict) -> str:
    """Qdrant payload의 source 필드를 단일 문자열로 정규화."""
    raw = payload.get("source")
    if isinstance(raw, list):
        return raw[0] if raw else ""
    return raw or ""
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_fallback.py -v`
Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add backend/src/search/fallback.py backend/tests/test_fallback.py
git commit -m "feat: add fallback search module with relaxed search and question suggestions"
```

---

### Task 3: 스키마 확장 (Backend + Admin)

**Files:**
- Modify: `backend/src/chatbot/schemas.py:23-28`
- Modify: `backend/src/chat/models.py:51-62`
- Modify: `backend/tests/test_chatbot_config.py`
- Modify: `admin/src/features/chatbot/types.ts:7-11`

- [ ] **Step 1: SearchTiersConfig에 query_rewrite_enabled 추가**

`backend/src/chatbot/schemas.py` 라인 28 뒤에 추가:

```python
class SearchTiersConfig(BaseModel):
    """search_tiers JSONB 구조."""

    tiers: list[SearchTierSchema] = Field(default_factory=list)
    rerank_enabled: bool = False
    dictionary_enabled: bool = False
    query_rewrite_enabled: bool = False  # NEW
```

- [ ] **Step 2: SearchEvent 모델에 rewritten_query 컬럼 추가**

`backend/src/chat/models.py` SearchEvent 클래스에 필드 추가:

```python
class SearchEvent(SQLModel, table=True):
    __tablename__ = "search_events"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(foreign_key="session_messages.id", index=True)
    query_text: str = Field(sa_column=Column(Text))
    rewritten_query: str | None = Field(default=None, sa_column=Column(Text))  # NEW
    applied_filters: dict = Field(default_factory=dict, sa_column=Column(JSON))
    search_tier: int = 0
    total_results: int = 0
    latency_ms: int = 0
    qdrant_request_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
```

- [ ] **Step 3: Admin 타입에 query_rewrite_enabled 추가**

`admin/src/features/chatbot/types.ts`:

```typescript
export interface SearchTiersConfig {
  tiers: SearchTier[];
  rerank_enabled?: boolean;
  dictionary_enabled?: boolean;
  query_rewrite_enabled?: boolean; // NEW
}
```

- [ ] **Step 4: 스키마 기본값 테스트 추가**

`backend/tests/test_chatbot_config.py`에 추가:

```python
def test_search_tiers_config_query_rewrite_default():
    config = SearchTiersConfig(tiers=[])
    assert config.query_rewrite_enabled is False


def test_search_tiers_config_query_rewrite_enabled():
    config = SearchTiersConfig(tiers=[], query_rewrite_enabled=True)
    assert config.query_rewrite_enabled is True
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_chatbot_config.py -v`
Expected: All passed (기존 + 새 2개)

- [ ] **Step 6: Alembic 마이그레이션 생성**

Run: `source backend/.venv/bin/activate && cd backend && alembic revision --autogenerate -m "add rewritten_query to search_events"`

생성된 마이그레이션 파일 확인 후 `upgrade()`에 다음이 포함되어야 함:

```python
op.add_column('search_events', sa.Column('rewritten_query', sa.Text(), nullable=True))
```

- [ ] **Step 7: 커밋**

```bash
git add backend/src/chatbot/schemas.py backend/src/chat/models.py admin/src/features/chatbot/types.ts backend/tests/test_chatbot_config.py backend/alembic/versions/
git commit -m "feat: add query_rewrite_enabled schema and rewritten_query column"
```

---

### Task 4: ChatbotService 설정 조회 확장

**Files:**
- Modify: `backend/src/chatbot/service.py:12-16,60-72`

- [ ] **Step 1: DEFAULT 상수에 query_rewrite_enabled 추가**

`backend/src/chatbot/service.py` 라인 16 뒤에 추가:

```python
DEFAULT_RERANK_ENABLED = False
DEFAULT_QUERY_REWRITE_ENABLED = False  # NEW
```

- [ ] **Step 2: get_search_config 반환값에 query_rewrite_enabled 추가**

`backend/src/chatbot/service.py`의 `get_search_config` 메서드를 수정:

```python
async def get_search_config(
    self, chatbot_id: str | None
) -> tuple[CascadingConfig, bool, bool]:
    """chatbot_id로 CascadingConfig + rerank_enabled + query_rewrite_enabled를 조회."""
    if chatbot_id is None:
        return DEFAULT_CASCADING_CONFIG, DEFAULT_RERANK_ENABLED, DEFAULT_QUERY_REWRITE_ENABLED
    config = await self.repo.get_by_chatbot_id(chatbot_id)
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
        )
    cascading = self._parse_search_tiers(config.search_tiers)
    rerank_enabled = config.search_tiers.get("rerank_enabled", DEFAULT_RERANK_ENABLED)
    query_rewrite_enabled = config.search_tiers.get(
        "query_rewrite_enabled", DEFAULT_QUERY_REWRITE_ENABLED
    )
    return cascading, rerank_enabled, query_rewrite_enabled
```

- [ ] **Step 3: 기존 테스트 통과 확인**

Run: `source backend/.venv/bin/activate && python -m pytest tests/test_chatbot_config.py tests/test_chat_service.py -v`
Expected: get_search_config 호출부에서 unpacking 에러 발생 가능 → Task 5에서 수정

- [ ] **Step 4: 커밋**

```bash
git add backend/src/chatbot/service.py
git commit -m "feat: extend get_search_config to return query_rewrite_enabled"
```

---

### Task 5: chat/service.py 파이프라인 통합

**Files:**
- Modify: `backend/src/chat/service.py:1-10,90-180,230-320,388-410`

- [ ] **Step 1: import 추가**

`backend/src/chat/service.py` 상단 import에 추가:

```python
from src.search.query_rewriter import rewrite_query
from src.search.fallback import fallback_search
```

- [ ] **Step 2: process_chat() 수정 — Query Rewrite 삽입**

`process_chat()` 메서드의 캐시 체크 이후, 검색 실행 전 구간 (라인 115~127)을 수정:

```python
        # 3. 검색 실행 (넓은 후보 풀)
        qdrant = get_async_client()
        cascading_config, rerank_enabled, query_rewrite_enabled = (
            await self.chatbot_service.get_search_config(request.chatbot_id)
        )

        # [Query Rewrite] 쿼리 재작성 (활성화된 경우)
        search_query = request.query
        rewritten_query = None
        if query_rewrite_enabled:
            search_query = await rewrite_query(request.query)
            if search_query != request.query:
                rewritten_query = search_query
                # 재작성된 쿼리로 임베딩 재계산
                query_embedding = await embed_dense_query(search_query)

        start_time = time.monotonic()
        results = await cascading_search(
            qdrant, search_query, cascading_config, top_k=50,
            dense_embedding=query_embedding,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        # [Fallback] 검색 결과 0건 시 fallback
        fallback_type = "none"
        if not results:
            results, fallback_type = await fallback_search(
                client=qdrant,
                query=search_query,
                original_results=results,
                dense_embedding=query_embedding,
            )
```

- [ ] **Step 3: process_chat() 수정 — SearchEvent에 rewritten_query 기록**

`_record_search_event` 호출부를 수정하여 rewritten_query를 전달:

```python
        await self._record_search_event(
            assistant_msg.id, request, results, total_latency_ms,
            reranked=reranked, rerank_latency_ms=rerank_latency_ms,
            rewritten_query=rewritten_query, fallback_type=fallback_type,
        )
```

- [ ] **Step 4: process_chat_stream() 동일 수정**

`process_chat_stream()` 메서드에도 동일한 Query Rewrite + Fallback 로직 삽입. 검색 구간 (라인 254~265):

```python
        # 2. 검색 + Re-ranking (스트림 시작 전 블로킹)
        qdrant = get_async_client()
        cascading_config, rerank_enabled, query_rewrite_enabled = (
            await self.chatbot_service.get_search_config(request.chatbot_id)
        )

        # [Query Rewrite] 쿼리 재작성 (활성화된 경우)
        search_query = request.query
        rewritten_query = None
        if query_rewrite_enabled:
            search_query = await rewrite_query(request.query)
            if search_query != request.query:
                rewritten_query = search_query
                query_embedding = await embed_dense_query(search_query)

        start_time = time.monotonic()
        results = await cascading_search(
            qdrant, search_query, cascading_config, top_k=50,
            dense_embedding=query_embedding,
        )
        search_latency_ms = int((time.monotonic() - start_time) * 1000)

        # [Fallback] 검색 결과 0건 시 fallback
        fallback_type = "none"
        if not results:
            results, fallback_type = await fallback_search(
                client=qdrant,
                query=search_query,
                original_results=results,
                dense_embedding=query_embedding,
            )
```

- [ ] **Step 5: _record_search_event에 rewritten_query, fallback_type 추가**

```python
    async def _record_search_event(
        self,
        message_id: uuid.UUID,
        request: ChatRequest,
        results: list,
        latency_ms: int,
        reranked: bool = False,
        rerank_latency_ms: int = 0,
        rewritten_query: str | None = None,
        fallback_type: str = "none",
    ) -> None:
        """검색 이벤트(쿼리, 필터, 레이턴시 등)를 DB에 기록."""
        event = SearchEvent(
            message_id=message_id,
            query_text=request.query,
            rewritten_query=rewritten_query,
            applied_filters={
                "chatbot_id": request.chatbot_id,
                "reranked": reranked,
                "rerank_latency_ms": rerank_latency_ms,
                "fallback_type": fallback_type,
            },
            total_results=len(results),
            latency_ms=latency_ms,
        )
        await self.chat_repo.create_search_event(event)
```

- [ ] **Step 6: 전체 테스트 실행**

Run: `source backend/.venv/bin/activate && python -m pytest tests/ -x -q`
Expected: All passed (기존 mock이 get_search_config의 반환값 2개→3개 변경에 맞춰 업데이트 필요할 수 있음 → 실패 시 mock 수정)

- [ ] **Step 7: 커밋**

```bash
git add backend/src/chat/service.py
git commit -m "feat: integrate query rewriting and fallback into chat pipeline"
```

---

### Task 6: Admin UI 토글

**Files:**
- Modify: `admin/src/features/chatbot/components/search-tier-editor.tsx`
- Modify: `admin/src/test/search-tier-editor.test.tsx`

- [ ] **Step 1: SearchTierEditor에 props 확장**

SearchTierEditor는 tiers만 관리하므로, query_rewrite_enabled 토글은 상위 컴포넌트(챗봇 설정 폼)에서 관리하는 것이 적절하다. SearchTierEditor 파일의 하단 "티어 추가" 버튼 아래에 토글을 추가하되, props로 제어한다.

실제 구현은 챗봇 설정 폼 컴포넌트를 확인하여 `search_tiers.query_rewrite_enabled` 토글을 추가한다. SearchTierEditor의 상위 컴포넌트에서 이미 `search_tiers` 전체 객체를 관리하므로, 해당 폼에 Switch 컴포넌트를 추가:

```tsx
{/* Query Rewriting 토글 — 챗봇 설정 폼에 추가 */}
<div className="flex items-center justify-between rounded-lg border p-3">
  <div>
    <Label className="text-sm font-medium">Query Rewriting</Label>
    <p className="text-xs text-muted-foreground">
      사용자 질문을 종교 용어로 자동 재작성하여 검색 정확도 향상
    </p>
  </div>
  <Switch
    checked={searchTiers.query_rewrite_enabled ?? false}
    onCheckedChange={(checked) =>
      setSearchTiers({ ...searchTiers, query_rewrite_enabled: checked })
    }
  />
</div>
```

- [ ] **Step 2: 테스트 실행**

Run: `cd admin && npx vitest run --reporter=verbose`
Expected: 25 passed (기존 테스트 영향 없음, 토글은 상위 컴포넌트에 추가)

- [ ] **Step 3: 커밋**

```bash
git add admin/src/
git commit -m "feat: add query rewriting toggle to admin chatbot settings"
```

---

### Task 7: 기존 테스트 호환성 수정

**Files:**
- Modify: `backend/tests/test_chat_service.py`
- Modify: `backend/tests/test_chat_stream_service.py`

- [ ] **Step 1: get_search_config mock 업데이트**

기존 테스트에서 `get_search_config`가 `(CascadingConfig, bool)`을 반환하던 mock을 `(CascadingConfig, bool, bool)`로 수정. Grep으로 모든 해당 mock을 찾아 수정:

Run: `grep -n "get_search_config" backend/tests/test_chat_service.py backend/tests/test_chat_stream_service.py`

반환값에 3번째 `False` (query_rewrite_enabled 기본값) 추가:

```python
# 기존:
mock_chatbot_service.get_search_config.return_value = (cascading_config, False)
# 변경:
mock_chatbot_service.get_search_config.return_value = (cascading_config, False, False)
```

- [ ] **Step 2: 전체 테스트 실행**

Run: `source backend/.venv/bin/activate && python -m pytest tests/ -x -q`
Expected: All passed

- [ ] **Step 3: 커밋**

```bash
git add backend/tests/
git commit -m "test: update mocks for get_search_config 3-tuple return"
```

---

### Task 8: TODO.md 업데이트 + 최종 검증

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: TODO.md에 완료 항목 반영**

Next Actions 섹션의 3번 항목을 체크:

```markdown
### 3. 검색 파이프라인 고도화 (고우선순위)
- [x] Query Expansion/Rewriting 구현
- [x] 검색 결과 0건 시 사용자 친화적 fallback 메시지
```

Completed 섹션에 추가:

```markdown
### Backend — 검색 파이프라인 고도화 (2026-04-11)
- [x] Query Rewriting — 구어체→종교 용어 재작성, Gemini 3.1 Pro Lite, 800ms timeout, graceful degradation
- [x] 0건 Fallback — source 필터 제거 재검색 → LLM 질문 제안 두 단계
- [x] chatbot_config query_rewrite_enabled 토글 (챗봇별 ON/OFF)
- [x] SearchEvent rewritten_query 컬럼 추가
```

- [ ] **Step 2: Backend + Admin 전체 테스트**

Run: `source backend/.venv/bin/activate && python -m pytest tests/ -q`
Run: `cd admin && npx vitest run`
Expected: All passed

- [ ] **Step 3: 커밋**

```bash
git add docs/TODO.md
git commit -m "docs: update TODO.md with query rewriting and fallback completion"
```
