# Reranker A/B 측정 결과 — 2026-05-01T23:40:48

- **컬렉션:** `malssum_poc_v5`
- **챗봇:** `None`
- **sources:** `['U']`
- **runs:** 1, **n_queries (labeled):** 54 / 60
- **모델:** gemini-flash, bge-base, bge-ko

## 전체 macro 메트릭 (median over runs)

| 모델 | NDCG@10 | MRR@10 | Recall@10 | first_call(ms) | p50(ms) | p95(ms) | p99(ms) |
|---|---|---|---|---|---|---|---|
| `gemini-flash` | **0.5517** | **0.5059** | **0.7037** | 3477 | 2190 | 2733 | 3210 |
| `bge-base` | 0.5251 | 0.4695 | 0.7037 | 2206 | 2244 | 3391 | 4581 |
| `bge-ko` | 0.5409 | 0.4943 | 0.6944 | 2060 | 2072 | 2895 | 3146 |

## 카테고리별 NDCG@10 / MRR@10 / Recall@10

### factoid

| 모델 | NDCG@10 | MRR@10 | Recall@10 |
|---|---|---|---|
| `gemini-flash` | 0.8386 | 0.7850 | 1.0000 |
| `bge-base` | 0.8164 | 0.7558 | 1.0000 |
| `bge-ko` | 0.9013 | 0.8696 | 1.0000 |

### conceptual

| 모델 | NDCG@10 | MRR@10 | Recall@10 |
|---|---|---|---|
| `gemini-flash` | 0.5428 | 0.4826 | 0.7273 |
| `bge-base` | 0.5094 | 0.4391 | 0.7273 |
| `bge-ko` | 0.4827 | 0.4062 | 0.7273 |

### reasoning

| 모델 | NDCG@10 | MRR@10 | Recall@10 |
|---|---|---|---|
| `gemini-flash` | 0.0901 | 0.0833 | 0.1667 |
| `bge-base` | 0.0681 | 0.0480 | 0.1667 |
| `bge-ko` | 0.0471 | 0.0301 | 0.1250 |

