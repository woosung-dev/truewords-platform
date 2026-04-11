---
paths: ["backend/src/search/**/*", "backend/src/pipeline/**/*", "backend/src/cache/**/*"]
---

# RAG 파이프라인 코딩 규칙

---

## 1. 파이프라인 실행 순서

모든 사용자 질문은 아래 순서를 **반드시** 따른다. 단계를 건너뛰지 않는다.

```
사용자 질문
    ↓
[1] Semantic Cache 검색 (유사도 ≥ 0.93 → 즉시 반환)
    ↓ MISS
[2] Query Rewriting (LLM 기반 질문 확장/재작성)
    ↓
[3] 용어 감지 (질문 내 종교 고유 용어 식별)
    ↓
[4] 하이브리드 검색 (3컬렉션 병렬: malssum + dictionary + wonri)
    ↓
[5] RRF 병합 (Reciprocal Rank Fusion)
    ↓
[6] Re-ranking (Cross-encoder로 Top-50 → Top-10)
    ↓
[7] 생성 (시스템 프롬프트 + 용어 정의 + Top-10 + 사용자 질문 → Gemini)
    ↓
[8] Safety Layer (워터마킹, 민감 인명 필터, 답변 범위 검증)
    ↓
[9] Cache 저장 (질문+답변을 semantic_cache 컬렉션에 저장, TTL 7일)
    ↓
응답 반환
```

---

## 2. 3컬렉션 검색 패턴

각 컬렉션은 역할이 명확히 분리된다. **절대 혼합하지 않는다.**

| 컬렉션 | 데이터 | 검색 방식 | 용도 |
|--------|--------|----------|------|
| `malssum_collection` | 말씀 본문 청크 | sparse + dense (하이브리드) | 메인 검색 |
| `dictionary_collection` | 종교 용어 사전 | dense only | 용어 감지 시 동적 주입 |
| `wonri_collection` | 원리강론 청크 | sparse + dense (하이브리드) | 교리 질문 시 참조 |

### 검색 흐름

```python
# 1. 모든 질문 → malssum 검색 (필수)
malssum_results = await hybrid_search(malssum_collection, query, filter)

# 2. 용어 감지 시 → dictionary 검색 (조건부)
if detected_terms:
    term_results = await dense_search(dictionary_collection, detected_terms)

# 3. 교리 관련 질문 → wonri 검색 (조건부)
if is_doctrine_question:
    wonri_results = await hybrid_search(wonri_collection, query)

# 4. 결과 병합 → RRF
merged = rrf_fusion(malssum_results, wonri_results)
```

---

## 3. Cascading Search 패턴

특정 데이터 소스를 우선 검색하고, 결과 부족 시 폴백한다. (doc 07)

```python
async def cascading_search(
    query_vector: list[float],
    priority_sources: list[str],  # ["A", "B"]
    fallback_sources: list[str],  # ["C", "D"]
    min_score: float = 0.7,
    min_results: int = 3,
) -> list:
    # 1차: 우선순위 소스에서 검색
    results = await search_with_filter(query_vector, source_in=priority_sources)

    # 결과 충분하면 반환
    if len([r for r in results if r.score >= min_score]) >= min_results:
        return results

    # 2차: 폴백 소스에서 추가 검색
    fallback = await search_with_filter(query_vector, source_in=fallback_sources)
    return merge_and_deduplicate(results, fallback)
```

---

## 4. Semantic Cache 패턴

유사 질문 캐시로 비용과 응답 시간을 절감한다. (doc 08)

```python
CACHE_THRESHOLD = 0.93  # 유사도 임계값
CACHE_TTL_DAYS = 7

async def check_cache(question_embedding: list[float]) -> str | None:
    """캐시 히트 시 답변 반환, 미스 시 None"""
    hits = await qdrant.search(
        collection_name="semantic_cache",
        query_vector=question_embedding,
        score_threshold=CACHE_THRESHOLD,
        limit=1,
    )
    if hits:
        return hits[0].payload["answer"]
    return None

async def store_cache(question_embedding: list[float], question: str, answer: str):
    """파이프라인 완료 후 캐시에 저장"""
    await qdrant.upsert(
        collection_name="semantic_cache",
        points=[{
            "id": generate_uuid(),
            "vector": question_embedding,
            "payload": {
                "question": question,
                "answer": answer,
                "created_at": datetime.utcnow().isoformat(),
            },
        }],
    )
```

---

## 5. Re-ranking 패턴

Cross-encoder로 초기 검색 결과(Top-50)를 재정렬하여 Top-10을 선별한다. (doc 05)

```python
async def rerank(query: str, documents: list[dict], top_k: int = 10) -> list[dict]:
    """Cross-encoder 기반 Re-ranking"""
    pairs = [(query, doc["text"]) for doc in documents]
    scores = cross_encoder.predict(pairs)

    ranked = sorted(
        zip(documents, scores),
        key=lambda x: x[1],
        reverse=True,
    )
    return [doc for doc, score in ranked[:top_k]]
```

---

## 6. Query Rewriting

LLM으로 사용자 질문을 확장/재작성하여 검색 품질을 높인다. (doc 05)

```python
REWRITE_PROMPT = """
다음 질문을 검색에 적합하도록 재작성하세요.
- 종교 고유 용어가 있으면 풀어서 설명 추가
- 동의어/관련어 확장
- 원본 의미를 변경하지 않을 것

원본 질문: {question}
재작성:
"""

async def rewrite_query(question: str) -> str:
    response = await gemini_generate(REWRITE_PROMPT.format(question=question))
    return response.strip()
```

---

## 7. 금지 사항

1. **컬렉션 혼합 금지** — dictionary 데이터를 malssum_collection에 넣지 않는다
2. **Safety Layer 스킵 금지** — 어떤 경우에도 Step [8]을 건너뛰지 않는다
3. **캐시 우회 금지** — Semantic Cache 체크(Step [1])를 생략하지 않는다
4. **직접 LLM 호출 금지** — 반드시 RAG 파이프라인을 통해 생성한다 (근거 없는 답변 방지)
5. **출처 생략 금지** — 모든 답변에 참조한 말씀 출처를 포함한다
