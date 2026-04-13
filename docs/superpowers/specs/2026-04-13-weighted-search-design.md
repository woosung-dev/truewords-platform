# Weighted Search 설계 스펙

> 생성일: 2026-04-13
> 상태: APPROVED
> 브랜치: feat/weighted-search (예정)

## 요약

챗봇별 검색 전략에 **Weighted(비중 검색)** 모드를 추가한다.
기존 Cascading(순차 폴백)과 공존하며, Admin UI에서 챗봇별로 선택 가능.

---

## 1. 데이터 모델

### JSONB 구조 (ChatbotConfig.search_tiers)

```json
{
  "search_mode": "weighted",
  "tiers": [
    {"sources": ["A", "B"], "min_results": 3, "score_threshold": 0.1}
  ],
  "weighted_sources": [
    {"source": "A", "weight": 5, "score_threshold": 0.1},
    {"source": "B", "weight": 3, "score_threshold": 0.1},
    {"source": "C", "weight": 2, "score_threshold": 0.08}
  ],
  "rerank_enabled": true,
  "query_rewrite_enabled": true
}
```

**설계 결정:**
- `search_mode`: `"cascading"` (기본값) 또는 `"weighted"`
- `tiers`와 `weighted_sources` 양쪽 다 보존 — 모드 전환해도 상대편 설정 유지
- `weight`는 정수 비율 (5:3:2), 퍼센트 변환은 프론트에서 표시만
- `rerank_enabled`, `query_rewrite_enabled`는 모드 무관하게 동작
- 기존 JSONB에 `search_mode` 없으면 `"cascading"` 기본값 → 하위 호환
- Alembic 마이그레이션 불필요 (JSONB)

### Backend Pydantic 스키마

```python
# backend/src/chatbot/schemas.py

class WeightedSourceSchema(BaseModel):
    source: str
    weight: float = Field(ge=0.1, le=100, default=1)
    score_threshold: float = Field(ge=0.0, le=1.0, default=0.1)

class SearchTiersConfig(BaseModel):
    search_mode: Literal["cascading", "weighted"] = "cascading"
    tiers: list[SearchTierSchema] = Field(default_factory=list)
    weighted_sources: list[WeightedSourceSchema] = Field(default_factory=list)
    rerank_enabled: bool = False
    dictionary_enabled: bool = False
    query_rewrite_enabled: bool = False
```

### Frontend TypeScript 타입

```typescript
// admin/src/features/chatbot/types.ts

interface WeightedSource {
  source: string;
  weight: number;
  score_threshold: number;
}

interface SearchTiersConfig {
  search_mode?: "cascading" | "weighted";
  tiers: SearchTier[];
  weighted_sources?: WeightedSource[];
  rerank_enabled?: boolean;
  dictionary_enabled?: boolean;
  query_rewrite_enabled?: boolean;
}
```

---

## 2. 검색 엔진

### weighted_search() 알고리즘

**파일:** `backend/src/search/weighted.py` (신규)

```
weighted_search(client, query, config, top_k=50, dense_embedding)
    │
    ├── 1. 임베딩 1회 계산 (없으면)
    │   dense = dense_embedding or embed_dense_query(query)
    │   sparse = embed_sparse_async(query)
    │
    ├── 2. weight_map 생성
    │   total = sum(ws.weight for ws in config.sources)
    │   weight_map = {ws.source: ws.weight / total}
    │   예: {A:5, B:3, C:2} → {A:0.5, B:0.3, C:0.2}
    │
    ├── 3. asyncio.gather — 소스별 병렬 검색
    │   각각 hybrid_search(source_filter=[ws.source])
    │   개별 실패: log + 빈 리스트 (격리)
    │
    ├── 4. 소스별 raw score_threshold 필터링 (weight 곱셈 전)
    │
    ├── 5. 전체 병합 + 가중 정렬
    │   sort(key=lambda r: r.score * weight_map[r.source], reverse=True)
    │   SearchResult.score는 raw 유지 — 정렬 key만 가중
    │
    └── 6. return all_results[:top_k] (빈 리스트 가능 → fallback이 처리)
```

### 데이터 구조

```python
@dataclass
class WeightedSource:
    source: str
    weight: float       # 비율 숫자 (5, 3, 2 등)
    score_threshold: float = 0.1

@dataclass
class WeightedConfig:
    sources: list[WeightedSource]
```

### 설계 결정

- **Score 가중치 방식**: `result.score * weight` 곱셈으로 자연스러운 비중 반영
- **Raw score 필터링**: weight 곱셈 전에 raw RRF score로 score_threshold 필터 → 품질 보장
- **Raw score 보존**: SearchResult.score는 raw RRF score 유지, weight는 정렬에만 사용
- **0건 처리**: 빈 리스트 반환 → 기존 fallback_search가 처리 (relaxed → LLM 제안)
- **소스 실패 격리**: 개별 소스 Qdrant 에러 시 log + skip, 나머지 소스 결과 반환

### 파이프라인 위치

```
사용자 질의
    ├── [Query Rewrite] (모드 무관)
    ├── [Embed] dense + sparse
    ├── [Search] ← 여기서 분기
    │   ├── cascading → cascading_search()
    │   └── weighted  → weighted_search()
    ├── [Fallback] 0건 → relaxed → LLM 제안
    ├── [Rerank] (모드 무관)
    └── [Generate] → [Safety] → 응답
```

---

## 3. 서비스 레이어 변경

### chatbot/service.py

- `_parse_search_tiers()` → `_parse_search_config()` 리네이밍
- `search_mode`에 따라 `CascadingConfig | WeightedConfig` 반환
- `get_cascading_config()` 제거 (중복, `get_search_config()`로 통일)
- 잘못된 mode 값 → cascading fallback

```python
SearchConfig = CascadingConfig | WeightedConfig

@staticmethod
def _parse_search_config(tiers_data: dict) -> SearchConfig:
    mode = tiers_data.get("search_mode", "cascading")
    if mode == "weighted":
        return WeightedConfig(sources=[
            WeightedSource(source=ws["source"], weight=ws.get("weight", 1),
                          score_threshold=ws.get("score_threshold", 0.1))
            for ws in tiers_data.get("weighted_sources", [])
        ])
    return CascadingConfig(tiers=[...])
```

### chat/service.py

```python
async def _execute_search(self, qdrant, query, config, top_k, dense_embedding):
    if isinstance(config, WeightedConfig):
        return await weighted_search(qdrant, query, config, top_k, dense_embedding)
    return await cascading_search(qdrant, query, config, top_k, dense_embedding)
```

`process_chat()` + `process_chat_stream()` 양쪽의 `cascading_search()` 호출을 `_execute_search()`로 교체.

---

## 4. Admin UI

### SearchModeSelector 컴포넌트

**파일:** `admin/src/features/chatbot/components/search-mode-selector.tsx` (신규)

라디오 2개:
- "순차 검색 (Cascading)" — 우선순위 순서로 검색, 결과 충분하면 중단
- "비중 검색 (Weighted)" — 모든 소스를 동시에 검색, 비중에 따라 혼합

모드 선택에 따라 아래 에디터 조건부 렌더링.

### WeightedSourceEditor 컴포넌트

**파일:** `admin/src/features/chatbot/components/weighted-source-editor.tsx` (신규)

각 소스 행:
- 카테고리 이름 표시
- 비중 숫자 입력 (0.1~100, 기본 1)
- 점수 임계값 입력 (0.0~1.0, 기본 0.1)
- 자동 비율 표시 (weight / 합계 × 100)
- 삭제 버튼 (최소 1개 유지)

하단:
- 합계 + 퍼센트 총합 표시
- "소스 추가" 버튼 (`useSearchableCategories()` 훅 재사용, 이미 추가된 소스 비활성화)

### 생성/편집 페이지 통합

검색 설정 섹션:
```
[Query Rewriting 토글]
[용어 사전 토글]
[SearchModeSelector]
├── cascading → SearchTierEditor (기존)
└── weighted  → WeightedSourceEditor (신규)
```

`searchMode`, `weightedSources` state 추가.
모드 전환 시 양쪽 설정 독립 보존 (JSONB에 tiers + weighted_sources 모두 저장).

---

## 5. 테스트 계획

### Backend 단위 테스트 (12케이스)

```
weighted_search():
  - 3소스 기본 검색 (5:3:2 비율 → score*weight 정렬 검증)
  - raw score_threshold 필터링 (weight 곱셈 전)
  - 개별 소스 실패 격리 (나머지 정상 반환)
  - 모든 소스 0건 → 빈 리스트
  - weight 합계 != 정수 (정상 동작 검증)
  - 소스 1개 (weight=1.0)
  - 빈 config → 빈 결과

_parse_search_config():
  - mode="weighted" → WeightedConfig
  - mode 미지정 → CascadingConfig
  - mode="invalid" → CascadingConfig fallback

_execute_search():
  - WeightedConfig 디스패치
  - CascadingConfig 회귀
```

### E2E 검증

- Weighted 모드 챗봇 생성 → 채팅 → 결과 소스 비율 확인
- Cascading 모드 회귀 (기존 동작 동일)
- 모드 전환 후 저장 → 재로드 → 설정 유지

---

## 6. 핵심 파일 목록

| 파일 | 변경 | 재사용 |
|------|------|--------|
| `backend/src/chatbot/schemas.py` | 수정 | — |
| `backend/src/search/weighted.py` | **신규** | `hybrid_search`, `SearchResult`, `embed_*` |
| `backend/src/chatbot/service.py` | 수정 | — |
| `backend/src/chat/service.py` | 수정 | — |
| `backend/tests/test_weighted_search.py` | **신규** | — |
| `admin/src/features/chatbot/types.ts` | 수정 | — |
| `admin/src/features/chatbot/components/weighted-source-editor.tsx` | **신규** | `useSearchableCategories` |
| `admin/src/features/chatbot/components/search-mode-selector.tsx` | **신규** | — |
| `admin/src/app/(dashboard)/chatbots/[id]/edit/page.tsx` | 수정 | — |
| `admin/src/app/(dashboard)/chatbots/new/page.tsx` | 수정 | — |

---

## 7. Failure Modes

| 실패 시나리오 | 테스트 | 에러 핸들링 | 사용자 경험 |
|-------------|--------|-----------|-----------|
| 개별 소스 Qdrant 에러 | 계획됨 | log + skip | 나머지 소스 결과 표시 |
| 모든 소스 0건 | 계획됨 | 빈 리스트 → fallback | "관련 질문 제안" UX |
| weight 합계 비정상 | 계획됨 | 비율 계산 정상 동작 | 경고 표시, 차단 안 함 |
| invalid search_mode | 계획됨 | cascading fallback | 기존 동작 |

---

## 8. Scope 외 (향후)

- Ensemble Retrieval (같은 소스에 다중 검색 방법) — 별도 기능
- 시간 기반 가중치 (recency_weight) — Phase 2 이후
- Weighted + Cascading 혼합 모드 — 현재는 택 1
- asyncio.Semaphore 동시성 제한 — 소스 10개 이상 시 필요, 현재 3~4개
