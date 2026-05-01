# 전체 아키텍처 설계

## 인프라 구조 (3-Layer)

```
PostgreSQL (운영 DB)          Qdrant (검색 엔진)          Gemini 2.5 (생성 모델)
├── 사용자 데이터              ├── 말씀 벡터 컬렉션         ├── Flash (일반 답변)
├── 채팅 로그                  │   sparse+dense             ├── Pro (심층 분석)
├── FAQ 관리                   │   계층적 청크              └── Context Caching
└── 챗봇 설정                  │   payload 필터                 (원리강론+대사전)
                               ├── 용어사전 컬렉션
                               ├── 원리강론 컬렉션
                               └── semantic_cache 컬렉션
         │                              │                        │
         └──────────────── App Server ───┴────────────────────────┘
```

### 역할 분리 원칙
- **PostgreSQL**: 운영 데이터 (사용자, 로그, 설정) — 관계형 데이터
- **Qdrant**: 검색 전용 (벡터 검색, 하이브리드 검색) — 비정형 텍스트
- **Gemini**: 답변 생성 전용 — LLM 호출

## 데이터 규모

- 615권 x 평균 200페이지 x 페이지당 2~5청크 = **약 25만~60만 청크**
- Qdrant 단일 노드 2~4GB RAM으로 충분

## 예상 월 비용

| 구성요소 | 비용 |
|----------|------|
| PostgreSQL | ~$25/월 |
| Qdrant (셀프호스팅) | ~$30/월 |
| Gemini (생성) | ~$50-160/월 (쿼리량 따라) |
| **총합** | **~$105-215/월** |

## 전체 요청 처리 파이프라인

```
┌─────────────────────────────────────────────────────────┐
│                    사용자 인터페이스                        │
│  [챗봇 선택] [질문 입력] [최근말씀 우선 토글] [출처 보기]     │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Semantic Cache Layer                         │
│  질문 임베딩 → cache_collection 검색                       │
│  ├── HIT (운영 기본 유사도 ≥ 0.88) → 즉시 반환 (~50ms)  │
│  └── MISS → 다음 단계로                                   │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Query Processing Layer                      │
│  1. Query Rewriting (LLM으로 질문 확장/재작성)              │
│  2. 종교 용어 감지 (사전 매칭 + LLM)                       │
│  3. 챗봇 버전에 따른 필터 결정 (A|B|C|D 조합)               │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Search Layer (Qdrant)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│  │ malssum_coll │ │ dict_coll    │ │ wonri_coll   │     │
│  │ (말씀 본문)   │ │ (대사전)      │ │ (원리강론)    │     │
│  │ sparse+dense │ │ dense vector │ │ sparse+dense │     │
│  │ 계층적 청크   │ │              │ │ 계층적 청크   │     │
│  │ payload:     │ │              │ │              │     │
│  │  - book_id   │ │              │ │              │     │
│  │  - year      │ │              │ │              │     │
│  │  - chapter   │ │              │ │              │     │
│  │  - parent_id │ │              │ │              │     │
│  └──────────────┘ └──────────────┘ └──────────────┘     │
│         ↓                 ↓                ↓             │
│         └────── 결과 병합 (RRF) ────────────┘             │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Re-ranking Layer                             │
│  Gemini LLM으로 Top-50 → Top-10 정밀 선별                │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Generation Layer                             │
│  시스템 프롬프트 (핵심 용어 100~200개 포함)                  │
│  + 동적 용어 정의 (dict_coll에서)                          │
│  + Re-ranked 검색 결과 Top-10                            │
│  + 사용자 질문                                            │
│  → LLM (Gemini 2.5 Flash/Pro) → 답변 + 출처 표기         │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Safety Layer                                 │
│  - 답변 워터마킹                                          │
│  - 민감 인명/내용 필터                                     │
│  - 악의적 질문 패턴 감지                                   │
│  - 로그 기록 (PostgreSQL)                                │
└─────────────────────┬───────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│              Cache Store Layer                            │
│  답변을 semantic_cache 컬렉션에 저장 (TTL 7일)            │
└─────────────────────────────────────────────────────────┘
```

## Qdrant 컬렉션 설계

### malssum_collection (말씀 본문)

```json
{
    "vectors": {
        "dense": { "size": 1024, "distance": "Cosine" },
        "sparse": { "index": { "on_disk": false } }
    },
    "payload_schema": {
        "source": "keyword",
        "book_type": "keyword",
        "volume": "integer",
        "year": "integer",
        "chapter": "keyword",
        "parent_chunk_id": "keyword",
        "chunk_level": "keyword",
        "text": "text"
    }
}
```

### dictionary_collection (용어사전)

```json
{
    "vectors": {
        "dense": { "size": 1024, "distance": "Cosine" }
    },
    "payload_schema": {
        "term": "keyword",
        "definition": "text",
        "category": "keyword",
        "related_terms": "keyword[]"
    }
}
```

### semantic_cache_collection (시맨틱 캐시)

```json
{
    "vectors": {
        "dense": { "size": 1024, "distance": "Cosine" }
    },
    "payload_schema": {
        "question": "text",
        "answer": "text",
        "chatbot_id": "keyword",
        "sources": "keyword[]",
        "created_at": "datetime",
        "hit_count": "integer"
    }
}
```

## 다중 챗봇 버전 구현

### payload 기반 필터링

```python
chatbot_filters = {
    "말씀선집_only":       {"book_type": "malssum"},
    "어머니말씀_only":     {"book_type": "mother"},
    "말씀선집+원리강론":   {"book_type": ["malssum", "wonri"]},
    "전체":               {}
}
```

### 우선순위 기반 검색 (Cascading Search)

각 챗봇별로 검색 우선순위를 설정할 수 있음:

```json
{
    "name": "말씀봇 A",
    "search_tiers": [
        {"sources": ["A", "B"], "priority": 1, "min_results": 3, "threshold": 0.75},
        {"sources": ["C"],      "priority": 2, "min_results": 2, "threshold": 0.65},
        {"sources": ["D", "E"], "priority": 3, "min_results": 1, "threshold": 0.60}
    ]
}
```

구현 방식:

```python
# 1차: 우선순위 높은 소스에서 검색
results = qdrant.search(
    collection="malssum",
    query_vector=query_vec,
    query_filter={"must": [{"key": "source", "match": {"any": ["A", "B"]}}]},
    limit=10,
    score_threshold=0.75
)

# 결과 부족 시 2차: 다음 우선순위 소스에서 추가 검색
if len(results) < 3 or results[0].score < 0.75:
    fallback = qdrant.search(
        collection="malssum",
        query_vector=query_vec,
        query_filter={"must": [{"key": "source", "match": {"value": "C"}}]},
        limit=10
    )
    results = merge_and_rerank(results, fallback)
```

## Phase 로드맵

### Phase 1 (초기 출시)
- 하이브리드 검색 (BM25 + 벡터)
- 계층적 청킹
- Re-ranking 파이프라인
- 다중 챗봇 버전 (payload 필터)
- 우선순위 검색 (Cascading Search)
- 시스템 프롬프트 방어선
- 인증 기반 접근 제어

### Phase 2 (고도화)
- Query Expansion/Rewriting
- Semantic Cache
- Context Caching (Gemini)
- 단계적 공개 (Staged Rollout)

### Phase 3 (장기)
- Agentic RAG (다단계 검색-추론-검증)
- 한국어 BM25 품질 부족 시 ES+nori 추가 검토
- Knowledge Graph (용어 관계 표현)
