# Semantic Cache 전략

## 개념

일반 캐시는 **똑같은 질문**만 히트. Semantic Cache는 **의미적으로 비슷한 질문**도 히트로 처리.

```
일반 캐시:
  "축복의 의미가 뭐예요?" → 캐시 히트 ✅
  "축복이 무슨 뜻인가요?" → 캐시 미스 ❌ (문자열이 다름)

Semantic Cache:
  "축복의 의미가 뭐예요?" → 캐시 히트 ✅
  "축복이 무슨 뜻인가요?" → 캐시 히트 ✅ (유사도 0.95)
  "축복식 절차가 어떻게 되나요?" → 캐시 미스 ❌ (유사도 0.62)
```

## 작동 구조

```
사용자 질문
    ↓
질문 임베딩 생성
    ↓
Qdrant semantic_cache_collection에서 유사 질문 검색
    ↓
유사도 ≥ 임계값?
    ├── YES → 캐시된 답변 즉시 반환 (~50ms, 비용 $0)
    └── NO  → 정상 RAG 파이프라인 실행 (2~5초, ~$0.01-0.05)
              → 답변 생성 후 cache_collection에 저장
```

> 현재 운영 기본값은 `backend/src/config.py`의 `CACHE_THRESHOLD=0.88`이다.
> 초기 설계 문서의 0.93은 보수적 권장값이며, 실제 운영에서는 반복 질문 재사용률을 높이기 위해 0.88로 조정했다.

## 구현 코드

```python
# 캐시 검색
cache_hit = qdrant.search(
    collection="semantic_cache",
    query_vector=question_embedding,
    score_threshold=0.88,
    limit=1
)

if cache_hit:
    return cache_hit[0].payload["answer"]  # 즉시 반환
else:
    answer = run_rag_pipeline(question)     # 정상 파이프라인
    # 캐시에 저장
    qdrant.upsert(
        collection="semantic_cache",
        points=[{
            "vector": question_embedding,
            "payload": {
                "question": question,
                "answer": answer,
                "chatbot_id": "bot_A",
                "created_at": timestamp,
                "hit_count": 0
            }
        }]
    )
```

### 챗봇별 + TTL 적용

```python
cache_hit = qdrant.search(
    collection="semantic_cache",
    query_vector=question_embedding,
    query_filter={
        "must": [
            {"key": "chatbot_id", "match": {"value": "bot_A"}},
            {"key": "created_at", "range": {"gte": seven_days_ago}}
        ]
    },
    score_threshold=0.88,
    limit=1
)
```

## 이 프로젝트에 적합한 이유

### 1. 질문 패턴이 수렴한다

종교 텍스트 챗봇은 질문이 특정 주제에 집중됨:
- "축복의 의미" 계열 → 수십 가지 변형으로 반복
- "참부모님이 누구인가" 계열
- "창조원리 설명해줘" 계열
- "탕감복귀란?" 계열

예상 캐시 히트율: **30~50%** (일반 챗봇보다 훨씬 높음)

### 2. 비용 절감

```
월 10,000건 질문 기준:

캐시 없이:     10,000 x $0.03 = $300/월
히트율 40%:    6,000 x $0.03  = $180/월 → 월 $120 절감
히트율 50%:    5,000 x $0.03  = $150/월 → 월 $150 절감
```

### 3. 응답 속도 개선

| 경로 | 응답 시간 |
|------|----------|
| 정상 RAG | 2~5초 |
| 캐시 히트 | **50~100ms** (40~100배 빠름) |

## 주의사항 및 해결책

| 우려 | 해결책 |
|------|--------|
| 오래된 답변 반환 | TTL 설정 (예: 7일), 데이터 업데이트 시 캐시 무효화 |
| 챗봇별 답변 섞임 | `chatbot_id` 필터로 챗봇별 캐시 분리 |
| 임계값 낮으면 오답 | 운영 기본값 0.88. 답변 오답률/캐시 히트율을 함께 보며 0.88~0.93 범위에서 튜닝 |
| 캐시 크기 증가 | Qdrant 별도 컬렉션, 말씀 60만 대비 캐시는 수만 건 |

## 파이프라인에서의 위치

```
사용자 질문
    ↓
[Semantic Cache 체크]  ← 가장 앞단
    ├── HIT → 즉시 반환
    └── MISS ↓
[Query Rewriting + 용어 감지]
    ↓
[하이브리드 검색 (BM25 + 벡터)]
    ↓
[Re-ranking]
    ↓
[LLM 답변 생성]
    ↓
[캐시 저장]  ← 가장 뒷단
    ↓
답변 반환
```

파이프라인 **가장 앞에서 체크, 가장 뒤에서 저장** — 기존 구조 건드리지 않고 앞뒤로 붙이는 형태.

## 평가

| 항목 | 평가 |
|------|------|
| 추천도 | ★★★★☆ |
| 구현 난이도 | **낮음** (Qdrant 컬렉션 1개 추가) |
| 비용 절감 | 30~50% (LLM 호출 비용) |
| 속도 개선 | 캐시 히트 시 40~100배 |
| 적용 시점 | Phase 1 후반 ~ Phase 2 초반 |

> Phase 1 핵심(하이브리드 검색, 계층적 청킹, Re-ranking)이 먼저이고, Semantic Cache는 서비스 오픈 후 실제 질문 패턴이 쌓이면 효과 극대화. 다만 구현 비용이 낮아 Phase 1에 포함해도 무방.
