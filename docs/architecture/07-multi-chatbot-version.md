# 다중 챗봇 버전 및 우선순위 검색

## 요구사항

- A, B, C, D 각각의 데이터셋 기반 챗봇
- A|B, C|D 등 조합 챗봇도 가능해야 함
- 특정 소스 우선 검색 후, 없으면 다른 소스에서 검색 (Cascading)

## Qdrant 메타데이터 기반 구현

### payload 설계

```json
{
    "text": "말씀 본문...",
    "source": "A",
    "book_type": "malssum",
    "volume": 45,
    "year": 1990,
    "chapter": "제3장",
    "parent_chunk_id": "chunk_parent_001"
}
```

### 챗봇별 필터

```python
chatbot_filters = {
    "말씀선집_only":       {"book_type": "malssum"},
    "어머니말씀_only":     {"book_type": "mother"},
    "말씀선집+원리강론":   {"book_type": ["malssum", "wonri"]},
    "전체":               {}  # 필터 없음
}

results = qdrant.search(
    collection="malssum_collection",
    query=query_vector,
    query_filter=chatbot_filters[selected_version],
    limit=50
)
```

## 우선순위 검색 (Cascading Search)

### 방식 1: 순차 검색 — 추천

A, B에서 먼저 찾고, 없으면 C에서 찾는 구조:

```
사용자 질문: "축복의 의미는?"
    ↓
[1차 검색] filter: {source: ["A", "B"]}  →  결과 Top-10
    ↓
결과가 충분한가? (score ≥ 임계값, 예: 0.75)
    ├── YES → 그대로 LLM에 전달
    └── NO  → [2차 검색] filter: {source: ["C"]}
                  ↓
              1차 + 2차 결과 병합 → LLM에 전달
```

```python
# 1차: A, B에서 우선 검색
results = qdrant.search(
    collection="malssum",
    query_vector=query_vec,
    query_filter={"must": [{"key": "source", "match": {"any": ["A", "B"]}}]},
    limit=10,
    score_threshold=0.75
)

# 결과가 부족하면 2차: C에서 추가 검색
if len(results) < 3 or results[0].score < 0.75:
    fallback = qdrant.search(
        collection="malssum",
        query_vector=query_vec,
        query_filter={"must": [{"key": "source", "match": {"value": "C"}}]},
        limit=10
    )
    results = merge_and_rerank(results, fallback)
```

| 항목 | 평가 |
|------|------|
| 우선순위 명확성 | ★★★★★ |
| 응답 속도 | ★★★★☆ (최악 시 검색 2회) |
| 구현 난이도 | 중 |

### 방식 2: 단일 검색 + 가중치 부스팅

```python
results = qdrant.search(
    collection="malssum",
    query_vector=query_vec,
    query_filter={"must": [{"key": "source", "match": {"any": ["A", "B", "C"]}}]},
    limit=20
)

# 우선순위 소스 부스팅
BOOST = {"A": 1.3, "B": 1.3, "C": 1.0}
for r in results:
    r.score *= BOOST[r.payload["source"]]

results.sort(key=lambda r: r.score, reverse=True)
top_10 = results[:10]
```

| 항목 | 평가 |
|------|------|
| 우선순위 명확성 | ★★★☆☆ |
| 응답 속도 | ★★★★★ (검색 1회) |
| 구현 난이도 | 낮음 |

### 비교

| 항목 | 순차 검색 | 가중치 부스팅 |
|------|:--------:|:-----------:|
| 우선순위 명확성 | ★★★★★ | ★★★☆☆ |
| 응답 속도 | ★★★★☆ | ★★★★★ |
| C 결과 노출 제어 | 정확함 | 부스트 값 튜닝 필요 |

**추천: 순차 검색 (방식 1)** — "먼저 찾고 없으면" 요구사항에 정확히 부합

## 관리자 설정 구조

관리자 페이지에서 각 챗봇별 검색 우선순위를 설정 가능:

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

이를 통해 UI에서 자유롭게 다양한 조합의 챗봇 생성 가능.
