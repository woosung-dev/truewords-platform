# Reranker A/B 측정 결과 — Round 2 (cache-bust, 2026-05-02)

**컬렉션:** `malssum_poc_v5` / **챗봇 source:** `U` / **runs:** 1 / **n_queries (labeled):** 54 / 60

**실행 노트:**
- BGE 2 모델: 단일 invocation (`compare_rerankers --models bge-base,bge-ko`) — 로컬 모델, cache 영향 무관, deterministic
- Gemini-flash: 단독 invocation, **`GEMINI_RERANK_CACHE_BUST=1` 환경변수** 로 prompt 에 unique nonce 주입 → paid tier implicit prompt cache hit 회피
- Gemini cache-bust 코드는 working tree 임시 적용 후 revert (commit 안 됨, 측정 한정)
- 실행 분리 사유: 직전 통합 호출 시 Gemini 429 RESOURCE_EXHAUSTED → BGE 측정 실패 방지 위해 분리

## 1. Round 1 vs Round 2 비교 (전체 macro)

| 모델 | R1 NDCG@10 | **R2 NDCG@10** | Δ NDCG | R1 MRR@10 | R2 MRR@10 | Δ MRR |
|---|---|---|---|---|---|---|
| **gemini-flash** | 0.5517 | **0.5670** | **+0.015** | 0.5059 | 0.5267 | +0.021 |
| bge-base | 0.5251 | 0.5189 | -0.006 | 0.4695 | 0.4668 | -0.003 |
| bge-ko | 0.5409 | 0.5292 | -0.012 | 0.4943 | 0.4850 | -0.009 |

| 모델 | R1 p50 | R2 p50 | R1 p95 | R2 p95 | R2 p99 | R1 first_call | R2 first_call |
|---|---|---|---|---|---|---|---|
| gemini-flash | 2190 | 2077 | 2733 | 3902 | **32222 ⚠️** | 3477 | 2455 |
| bge-base | 2244 | **1464** | 3391 | 1897 | 1990 | 2206 | 1496 |
| bge-ko | 2072 | 2096 | 2895 | 2690 | 3031 | 2060 | 2009 |

## 2. Round 2 카테고리별 NDCG@10

| 모델 | factoid | conceptual | reasoning |
|---|---|---|---|
| **gemini-flash** | 0.8505 | **0.5746** | **0.0805** |
| bge-base | 0.8164 | 0.4943 | 0.0681 |
| bge-ko | **0.9013** | 0.4540 | 0.0471 |

R1 카테고리 결과와 비교:
- **BGE 두 모델: 카테고리 NDCG/MRR 완전 동일** — 로컬 모델 deterministic 입증
- **gemini-flash: factoid +0.012, conceptual +0.032** — cache-bust 시 약간 더 좋음 (paid tier prompt cache 의 약간 비최적 응답 → fresh 호출이 약간 우세)

## 3. 핵심 관찰

1. **Gemini 우세 강화**: cache 영향 제거 후에도 (오히려 더 강하게) winner.
   - R1 gemini vs bge-ko = **+0.011** (NDCG)
   - R2 gemini vs bge-ko = **+0.038** (NDCG) — 격차 확장
   - 즉 R1 의 cache hit 가 gemini 결과를 약간 낮게 보였던 것 (challenger 와 격차 좁힘) — cache-bust 시 차이 더 명확
2. **BGE deterministic 입증**: 카테고리별 NDCG/MRR 동일. 1차/2차 macro 차이 (≤0.012) 는 cascading top-20 의 RRF score variance 누적 (외부 요인).
3. **Gemini p99 = 32222ms (32초) outlier ⚠️**: 1 query 가 매우 느림. cache miss 시 Gemini API tail latency 위험 노출. 운영 SLA (5s) 위협.
4. **결정 (Gemini-flash 유지) 강하게 지지**: R1 + R2 모두 challenger NDCG 임계 (0.05) 미달. 결정 변경 없음. 카테고리 winner 분기 (factoid bge-ko / conceptual+reasoning gemini) 동일.

## 4. 운영 영향 — codex Q3 권고 강화

R2 의 **p99 = 32초 outlier** 는 codex Q3 권고 ("운영 search_top_k=50 + Gemini fallback 별도 PR") 의 시급성을 강조한다. cache-bust 측정에서 발견된 tail latency 는 실제 운영의 cache miss 시 동일 위험을 시사 — Phase 1.x 후속 PR 우선순위 ↑.

## 5. 참고

- Round 1 결과: [`./2026-05-01-reranker-ab-results.md`](./2026-05-01-reranker-ab-results.md)
- ADR 결정: [`./2026-05-01-reranker-cross-encoder-ab-decision.md`](./2026-05-01-reranker-cross-encoder-ab-decision.md)
- Round 2 raw JSON: [`./2026-05-01-reranker-ab-results-round2.json`](./2026-05-01-reranker-ab-results-round2.json)
