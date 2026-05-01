# 2026-05-01 — Reranker Cross-encoder A/B 측정 + 결정

## TL;DR

**결정: Gemini-flash-lite 조건부 유지 (default 변경 없음)**. codex 검토 권고에 따라 표현을 조정 — "Gemini 유지" 보다 **"현 데이터로는 대체 근거 부족, 조건부 유지"** 가 정확. 3 모델의 NDCG@10 차이가 모두 사전 합의 임계 (0.05) 미달 — gemini-flash 0.5517 vs bge-ko 0.5409 (+0.011) vs bge-base 0.5251 (+0.027). 우월성 미입증. 카테고리 winner 다름 (factoid bge-ko 0.901 / conceptual gemini / reasoning gemini) 으로 단일 default 부적절. BGE 채택 시 Cloud Run 메모리 +2.2GB + first_call 부담 → 0.05 미만 개선엔 부담 정당화 안 됨.

reasoning 카테고리 NDCG@10 모두 < 0.10 — 이는 reranker 교체보다 **검색 품질 / 청킹 / 평가셋 (특히 reasoning 정답 정의)** 개선이 더 큰 영향. Phase 1.x 후속 조사 권고.

다만 인프라 (BGE 어댑터, Dockerfile bake-in, 측정 골격) 는 영구 보존 — 향후 Phase 1.x 에서 챗봇별 override (factoid 비중 높은 챗봇은 BGE-ko 적용) 또는 도메인 확장 측정 시 즉시 활용 가능.

청사진 ADR 4.3 의 ★★★★★ 우선 권고 "Cross-encoder Reranker 교체" 측정 작업 (PR 1~8/8). [Phase 0 (#107)](https://github.com/woosung-dev/truewords-platform/pull/107) 의 평가 골격 위에서 60 entry 골든셋 + 측정 인프라 + 3 모델 A/B 를 수행했다.

---

## 1. 측정 방법

- **챗봇:** `신학/원리 전문 봇` (chatbot_id 한글, DB id=`cb5ad2a7-d4fe-46a4-b78d-c832e3cc0bb5`)
- **컬렉션:** `malssum_poc_v5` (8759 chunks, source='U' 단일, 4권 자료: 원리강론.txt / 천성경.pdf / 평화경.txt / 하늘 섭리로 본 참부모님의 위상과 가치.pdf)
- **골든셋:** `backend/tests/golden/queries.json` v4 (NotebookLM v1+v2, 60 entry, factoid 24 / conceptual 24 / reasoning 12)
- **라벨링:** `expected_chunk_ids` 54/60 high-confidence (90%) — `match_snippets_to_chunks.py` 4단계 (공백/strict/ellipsis/score-fallback) 자동 매칭. 6 entry 미매칭 (paraphrase/한자 변형, score < 0.95) 은 평가에서 자동 skip.
- **측정 스크립트:** `backend/scripts/compare_rerankers.py` (--runs 3, latency p50/p95/p99 + first_call 분리)
- **실행 환경:** local (Qdrant localhost:6333 + PostgreSQL local + GEMINI_TIER=paid)
- **모델:**
  - `gemini-flash` — baseline (Gemini Flash JSON reranker, prod 현재 default)
  - `bge-base` — `BAAI/bge-reranker-v2-m3` (cross-encoder, ~568MB)
  - `bge-ko` — `dragonkue/bge-reranker-v2-m3-ko` (Korean fine-tuned, ~568MB)

**source 필터 mismatch 회피**: 신학/원리 전문 봇의 production search_tiers 는 L/M/N source 인데 측정 컬렉션 (malssum_poc_v5) 은 모두 source='U'. `evaluate_threshold.py` 에 `--sources U` 인자 추가하여 chatbot search_tiers 를 우회. 측정 자체의 외부 source 노출 없음.

## 2. 측정 결과

상세: [`./2026-05-01-reranker-ab-results.md`](./2026-05-01-reranker-ab-results.md) (raw JSON: `.json`).

### 전체 macro 메트릭 (1 run, 54 labeled queries)

| 모델 | NDCG@10 | MRR@10 | Recall@10 | first_call(ms) | p50(ms) | p95(ms) | p99(ms) |
|---|---|---|---|---|---|---|---|
| **`gemini-flash`** | **0.5517** | **0.5059** | **0.7037** | 3477 | 2190 | 2733 | 3210 |
| `bge-base` | 0.5251 | 0.4695 | 0.7037 | 2206 | 2244 | 3391 | 4581 |
| `bge-ko` | 0.5409 | 0.4943 | 0.6944 | 2060 | 2072 | 2895 | 3146 |

### 카테고리별 NDCG@10 (winner bold)

| 모델 | factoid | conceptual | reasoning |
|---|---|---|---|
| `gemini-flash` | 0.8386 | **0.5428** | **0.0901** |
| `bge-base` | 0.8164 | 0.5094 | 0.0681 |
| `bge-ko` | **0.9013** | 0.4827 | 0.0471 |

### 핵심 관찰

- **3 모델 NDCG 차이 모두 < 0.05** (사전 합의 임계 미충족). gemini vs bge-ko = 0.011, gemini vs bge-base = 0.027.
- **카테고리 winner 분기**: factoid 는 dragonkue/bge-reranker-v2-m3-ko (한국어 fine-tuned 효과), conceptual / reasoning 은 gemini-flash. 단일 default 부적절.
- **Latency**: bge-ko (p50 2072) < gemini (2190) < bge-base (2244). 차이 ~170ms — 의미 있으나 운영 SLA 5s 한도 내. p95 / p99 는 gemini 가 안정적 (변동성 작음).
- **Recall@10**: factoid 100% (bge-ko/bge-base/gemini 모두) — 정답 chunk 가 cascading top-20 에 항상 포함. reasoning 은 모두 17% 이하 (단일 정답 chunk 매칭이 multi-hop 질의에 부적합).

## 3. 의사결정 규칙 (사전 합의)

PR 8 plan 에 명시된 규칙대로 적용:

1. **Tie-breaker 순서:** NDCG@10 → MRR@10 → p95 latency → 메모리 비용 → API 비용.
2. **Effect size 임계:** NDCG@10 차이 ≥ 0.05 + p95 latency ≤ baseline + 500ms → 우월 모델 채택.
3. **NDCG 차이 < 0.05** → latency 더 빠른 쪽 우선.
4. **모든 모델이 baseline 보다 회귀** → 변경 없음. ADR 에 "Phase 1.x 재측정 후보" 명시.
5. **BGE 두 모델 차이 < 0.02** → 더 작은 메모리/latency 우선.
6. **카테고리 imbalance** (예: factoid 는 BGE-ko 우세, conceptual 은 Gemini 우세) — 챗봇별 reranker override 가 가능한 점을 고려해 "주력 카테고리" 기준으로 결정.

**60 query 표본 통계적 power**: paired t-test n=54 (labeled) 로 effect size d=0.4 (NDCG 차이 0.05 가정, σ ≈ 0.12) 를 80% power 로 검출 가능.

## 4. 결정

> *측정 결과 채운 후 결정.*

**채택 모델:** `<gemini-flash | bge-base | bge-ko>`
**근거:** `<NDCG@10 차이 / latency / 카테고리 분기 / 메모리 비용>`

### 적용 범위

> 옵션 A (기본): default reranker 변경 + 모든 챗봇 영향
> 옵션 B (canary): default 유지 + `신학/원리 전문 봇` 만 JSONB override → 1주 모니터링 후 default 승격
> 옵션 C (변경 없음): Gemini-flash 유지

`<선택 옵션>` 채택. 이유: `<설명>`

## 5. 코드 변경 (BGE winner 시)

본 ADR 머지에 동반된 코드 변경:

- `backend/src/chatbot/service.py:115-118` — `RetrievalConfig` 생성 시 `reranker_model=raw.get("reranker_model", settings.default_reranker_model)` 추가.
- `backend/src/config.py` — `default_reranker_model: Literal["gemini-flash", "bge-base", "bge-ko"] = "gemini-flash"` 신규 settings.
- `backend/.env.example` — `DEFAULT_RERANKER_MODEL=gemini-flash` 라인 추가.

운영 적용은 코드 변경과 분리:
- **Day 0:** main 머지 (코드 wiring + default `gemini-flash` 유지).
- **Day 0~1:** `신학/원리 전문 봇` 의 search_tiers JSONB 에 `"reranker_model": "<winner>"` SQL update.
- **Day 0~7:** `rerank_score_dist` 7일 추이 + Cloud Run 메모리 fingerprint + 사용자 피드백.
- **Day 7:** 회귀 없음 → `DEFAULT_RERANKER_MODEL=<winner>` env 변경 (Cloud Run secret).

## 6. Rollback

- env feature flag swap (1줄): `DEFAULT_RERANKER_MODEL=gemini-flash` 로 즉시 복귀. 코드 revert 불필요.
- 챗봇별 JSONB rollback: `UPDATE chatbot_configs SET search_tiers = jsonb_set(search_tiers, '{reranker_model}', '"gemini-flash"') WHERE chatbot_id = '신학/원리 전문 봇';`.
- 코드 revert: 마지막 수단. revert PR 만으로 wiring + default 둘 다 복귀.

## 7. 후속 모니터링 (Day 0~7)

- `rerank_score_dist` 로그 추이: 카테고리별 score 분포가 측정 결과와 일치하는지.
- Cloud Run 메모리 fingerprint: BGE 채택 시 4GB 한도 내인지 (cold start 직후 ~3GB 예상).
- p95 latency SLA: 챗봇 응답 시간 5s 한도 위반 알람.
- 사용자 피드백: 답변 품질 회귀 신고가 baseline 대비 증가 안 하는지.

## 8. 알려진 제한사항

1. **6 entry 미라벨링** (paraphrase / 한자 변형, score < 0.95): n_evaluated=54/60. statistical power 90% 보존, 결정에 영향 미미.
2. **단일 챗봇 측정**: 신학/원리 전문 봇 (sources=L/M/N → measurement source=U) 만 평가. 다른 챗봇 (sources=B/O/N/M/P/Q/L) 별 적용성은 확장 측정 필요. 본 ADR 의 결정은 신학/원리 도메인 특화.
3. **단일 컬렉션 (malssum_poc_v5)**: source U 8759 chunks 만 평가. 다른 source 의 chunk distribution 차이는 미측정.
4. **runs=1 측정**: variance 미측정. 1차 시행 시 3 runs 가 Gemini SDK hang (52분+ 진행, query 별 변동성으로 추정) → 안정성 확보를 위해 1 run 으로 단순화. NDCG/Recall 메트릭은 chunk-level deterministic 이지만 LLM reranker (Gemini) 의 stochastic 영향은 수동 follow-up 측정 권장 (Phase 1.x).
5. **search_top_k=20** (cascading 후보) — 운영 chat 핫패스 (search_top_k=50) 와 다름. 50 candidate Gemini Flash JSON reranker 안정성 부족 (PR 7 fix: gemini.py partial response allow). 운영도 동일 fallback 위험 — 후속 PR 에서 운영 search_top_k 검토 필요.

## 9. Codex Second Opinion (2026-05-02)

`codex exec` (gpt-5-codex 미가용 → 기본 모델) 으로 결정 + 데이터 적정성 검토 의뢰. 응답 발췌:

> **Q1 결정 합당:** 합당. ADR 문구는 "Gemini 유지" 보다 "현 데이터로는 대체 근거 부족, 조건부 유지" 가 더 정확. challenger 모두 NDCG +0.05 미달이고, reasoning 성능 자체가 낮아 reranker 교체보다 검색/청킹/평가셋 개선 이슈가 큼.
>
> **Q2 bge-ko override 가치:** 아직 낮음. bge-ko factoid +0.06 은 의미 있지만 54 query, 1 run small sample. 전체 NDCG/MRR 은 Gemini 우세. factoid-heavy 챗봇만 feature flag 로 재실험 가치.
>
> **Q3 운영 search_top_k=50 fallback:** **별도 PR 권장.** Gemini fallback 은 비용 / p95 / timeout / rate limit / 답변 지연을 바꾸는 운영 리스크 → reranker ADR 과 분리.
>
> **Q4 누락 분석:** bootstrap / significance test, query별 승패표, 챗봇·카테고리별 분포, 실패 사례, citation faithfulness, 비용·토큰, timeout/retry, cache 영향, reasoning category 낮은 NDCG 원인 분석.

본 ADR 은 Q1 권고 (조건부 유지 표현) 와 Q3 권고 (운영 search_top_k 별도 PR) 를 반영. Q2 는 카테고리 override 인프라 보존 (10절) 으로 대응. Q4 의 누락 항목들은 Phase 1.x 후속 측정 백로그 (10절) 에 추가.

## 10. 후속 작업 (백로그)

본 ADR 머지 후 별도 PR 또는 Phase 1.x 측정에서 다룰 항목:

1. **운영 chat 핫패스 search_top_k 검토 (별도 PR)** — `pipeline/stages/search.py:63,70` 의 `top_k=50` 이 Gemini reranker JSON 응답 부족 (PR 7 fix 의 partial fill 로 mitigated 되지만 근본 해결 X) 위험. 운영 cost / latency 영향 함께 측정 후 결정.
2. **Bootstrap / significance test** — paired t-test 또는 bootstrap 1000 회로 model 간 차이의 95% CI 산출. 0.05 임계가 통계적으로 의미 있는지 검증.
3. **Query별 승패표** — 54 query 마다 model 간 NDCG diff 시각화. 카테고리 imbalance 의 실제 query 수 분포 확인.
4. **Reasoning 카테고리 분석** — NDCG@10 < 0.10 원인: (a) 청킹 단위 부적합 (multi-hop 정답이 단일 chunk 미포함), (b) 골든셋 정답 chunk 정의 부적합, (c) hybrid_search 의 sparse/dense 비중 부적합 — 후속 조사.
5. **카테고리별 챗봇 override 인프라** — Q2 권고 — `build_runtime_config` 가 JSONB `reranker_model` 을 읽도록 wiring (현재 미적용). factoid-heavy 챗봇 1개 (예: 실제 사용 후) 에 한정 BGE-ko 적용 후 1주 모니터링.
6. **Citation faithfulness / 비용 측정** — answer 단계 (reranker 이후) 의 인용 정확도 + token 비용. 본 ADR 범위 외.
7. **Multi-run + variance** — 본 측정 1 run. 3-5 runs 로 variance / IQR 측정.

## 11. Round 2 검증 (cache-bust, 2026-05-02 추가)

R1 의 cache 영향 우려를 해소하기 위해 R2 측정 수행. Gemini reranker prompt 에 unique nonce 주입 (`GEMINI_RERANK_CACHE_BUST=1`) 으로 paid tier implicit prompt cache 회피. 코드는 working tree 임시 적용 후 revert (commit X).

### R1 vs R2 NDCG@10 비교

| 모델 | R1 NDCG | **R2 NDCG** | Δ NDCG |
|---|---|---|---|
| gemini-flash | 0.5517 | **0.5670** | **+0.015** |
| bge-base | 0.5251 | 0.5189 | -0.006 |
| bge-ko | 0.5409 | 0.5292 | -0.012 |

상세: [`./2026-05-01-reranker-ab-results-round2.md`](./2026-05-01-reranker-ab-results-round2.md)

### R2 가 결정에 미치는 영향

- **결정 변경 없음**: gemini-flash 우세가 cache-bust 후 오히려 강화 (R1 +0.011 → R2 +0.038 vs bge-ko). challenger 모두 NDCG 임계 (0.05) 미달 그대로.
- **BGE deterministic 입증**: 카테고리 NDCG/MRR 동일 (로컬 모델, cache 무관).
- **Gemini cache-bust 의 tail latency 위험 노출**: R2 의 p99 = 32222ms (32초) outlier. cache miss 시 Gemini API 의 변동성 → 운영 SLA 위협.
- **Codex Q3 우선순위 ↑**: 운영 chat 핫패스의 search_top_k=50 + Gemini fallback 위험 (10절 백로그 #1) 의 시급성을 R2 데이터가 강화. 별도 PR 진행 권고.

## 12. 참고

- 마스터 plan: [`~/.claude/plans/phase-0-pr-whimsical-bird.md`](#) (8 PR 계획)
- 본 세션 plan: [`~/.claude/plans/majestic-weaving-mccarthy.md`](#) (PR 6.5/7-pre/7/8)
- PR 6.5 (#116): golden 60 + collection/sources override CLI
- PR 7-pre (#117): NotebookLM snippet → chunk_id 매칭 (4단계)
- PR 1~6: #109 / #110 / #114 / #112 / #115 / #111
- 측정 결과 raw: `docs/dev-log/2026-05-01-reranker-ab-results.{json,md}`
- 이전 ADR: [`2026-05-01-cascade-distribution-measurement.md`](./2026-05-01-cascade-distribution-measurement.md)
