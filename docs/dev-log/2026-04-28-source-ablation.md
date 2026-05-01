# Phase 2 옵션 G — Source-weight Ablation 보고서

> **세션:** 2026-04-28 11:31 KST
> **브랜치:** `feat/phase-2-contextual-retrieval-and-source-ablation`
> **plan:** `docs/superpowers/plans/2026-04-28-option-b-and-g.md` Group A
> **선행 산출물:** 옵션 D 측정본 (`docs/dev-log/2026-04-28-phase-1-eval-report.md`)

---

## 0. 한 줄 결론

**M (3대 경전) — 회귀 −0.10 (1순위 약점) / O (말씀선집 615권) — 절대 hit율 0.31 최저 (2순위) / B (어머니말씀) — 44% share + hit율 0.35 (3순위)**.
Group C contextual prefix 우선 순위는 **M → O → B**. L과 N은 prefix 후순위.

---

## 1. 측정 방식 (RAGAS Fallback)

### 시도 1 (실패): RAGAS 4메트릭 per-source 평가
- 스크립트: `backend/scripts/eval_per_source.py` (보존, 향후 RAGAS hang 해결 시 재사용 가능)
- 시드: `~/Downloads/ragas_eval_seed_50_with_source_label.json` (Task A-1 산출, gold_source 라벨링)
- 첫 시도(50건 일괄): 4번째 항목부터 90% 이상 `TimeoutError` (인계서 §7 "action1+2 timeout 49건 원인 조사" 미완 항목과 동일 RAGAS 0.4.3 + langchain-google-genai 4.2.2 조합 이슈)
- 두 번째 시도(5건 직렬 batch): 동일하게 80% timeout — 직전 sanity 5건(timeout 0)과 다른 결과로 외부 변수(API quota / 백엔드 부하) 추정
- **결정**: RAGAS 디버깅은 본 plan 범위 초과. 휴리스틱 fallback 채택.

### 시도 2 (성공): NotebookLM 200건 휴리스틱 hit율 source별 분해
- 스크립트: `backend/scripts/analyze_per_source_hit_rate.py` (신규)
- 데이터: 옵션 D 측정 결과 (200건 baseline + 200건 treatment)
- dominant source = 행의 `참고1+참고2+참고3` 셀에서 `source=X` 패턴 최빈 코드
- hit = `참고 키워드` 토큰 절반 이상이 `참고1+2+3` 텍스트에 포함 (옵션 D와 동일 휴리스틱)
- **n=200**으로 RAGAS 50건 시드보다 통계 신뢰도 높음.

---

## 2. 측정 매트릭스

### 2.1 baseline (튜닝 후, 액션 1+2+3 적용 전, n=200)

| source | name | n | share | hit_rate |
|---|---|---:|---:|---:|
| B | 어머니말씀 | 73 | 36.5% | 0.397 |
| L | 원리강론 | 36 | 18.0% | 0.472 |
| M | 3대 경전 | 49 | 24.5% | 0.531 |
| N | 자서전 | 29 | 14.5% | 0.448 |
| O | 말씀선집 615권 | 13 | 6.5% | 0.385 |

산출물: `~/Downloads/per_source_hit_rate_20260428_1131_baseline.xlsx`

### 2.2 treatment (액션 1+2+3 ON, n=200)

| source | name | n | share | hit_rate |
|---|---|---:|---:|---:|
| B | 어머니말씀 | 88 | 44.0% | 0.352 |
| L | 원리강론 | 31 | 15.5% | 0.613 |
| M | 3대 경전 | 51 | 25.5% | 0.431 |
| N | 자서전 | 16 | 8.0% | 0.562 |
| O | 말씀선집 615권 | 13 | 6.5% | 0.308 |
| Unknown | (참고 셀에 source 마커 없음) | 1 | 0.5% | 0.000 |

산출물: `~/Downloads/per_source_hit_rate_20260428_1131_treatment.xlsx`

### 2.3 delta (treatment − baseline)

| source | hit_rate baseline → treatment | delta | share baseline → treatment | share delta |
|---|---|---:|---|---:|
| B | 0.397 → 0.352 | **−0.045** | 36.5% → 44.0% | +7.5% |
| L | 0.472 → 0.613 | **+0.141** ★ | 18.0% → 15.5% | −2.5% |
| **M** | 0.531 → 0.431 | **−0.100** ✗ | 24.5% → 25.5% | +1.0% |
| **N** | 0.448 → 0.562 | **+0.114** ★ | 14.5% → 8.0% | **−6.5%** ⚠ |
| **O** | 0.385 → 0.308 | **−0.077** ✗ | 6.5% → 6.5% | +0.0% |

---

## 3. 약점 source 식별

### 우선순위 #1 — M (3대 경전): hit율 회귀가 가장 큼
- baseline 0.531 → treatment 0.431 (**−0.100**)
- share 24.5% → 25.5% (영향력 크고 안정적)
- treatment에서 L5 교리 추론 hit율 5% 정체와 관련 있을 가능성: M(천성경) 청크가 더 많이 retrieve되지만 매칭 정밀도 떨어짐
- **B 옵션 contextual prefix 적용 1순위**

### 우선순위 #2 — O (말씀선집 615권): 절대 hit율 가장 낮음
- treatment 0.308 (모든 source 중 최저)
- share 6.5% — retrieval이 O를 거의 안 가져옴
- 615권 = ~18만 청크의 대부분이 이 source일 가능성 (Group C에서 권별 청크 dump 시 확인 예정)
- **L5 교리 추론 약세의 핵심 원인 후보** — 교리 추론은 말씀선집 본문에 다수 분포할 텐데 retrieval이 6.5%만 가져옴
- **B 옵션 prefix 2순위 (단, 18만 청크 대부분이 O라 prefix 비용 대부분이 여기 집중)**

### 우선순위 #3 — B (어머니말씀): share 비대해짐 + hit율 낮음
- baseline 36.5% → treatment **44.0%** (share 증가)
- hit율 0.352 (낮음)
- **retrieval이 B를 과도하게 가져와 false positive로 hit율 끌어내림 가능성**
- **B 옵션 prefix 적용 + weight 또는 score_threshold 미세 조정 권고** (admin UI에서 운영팀 직접)

### 별도 신호 — N (자서전): share 절반 감소
- baseline 14.5% → treatment **8.0%** (−6.5%p)
- 그러나 hit율은 +0.114로 개선 (작은 n에서 nice 결과)
- **IntentClassifier(액션 1)가 N(자서전) 의도를 덜 라우팅하는 듯** → 별도 조사 권고

### 강한 source — L (원리강론): 변화 없음 또는 개선
- hit율 +0.141 (가장 큰 개선)
- prefix 후순위

---

## 4. Group B+C 입력 권고

| 작업 | 권고 |
|---|---|
| Group C Task 12 prefix 우선순위 | **M → O → B** (3대 경전 + 말씀선집 + 어머니말씀) |
| Group C Task 12 후순위 | L, N (이미 작동 중) |
| Group B/C 별도 | B의 weight/threshold 운영팀 미세 조정 권고안 (admin UI에서) |
| Group F 후속 plan | RAGAS hang 원인 별도 PR (인계서 §7 미완) |
| Group F 후속 plan | IntentClassifier가 N source 라우팅을 약화시키는지 조사 |

---

## 5. 산출물

### 데이터
- `~/Downloads/per_source_hit_rate_20260428_1131_baseline.xlsx` — n=200 baseline
- `~/Downloads/per_source_hit_rate_20260428_1131_treatment.xlsx` — n=200 treatment
- `~/Downloads/ragas_eval_seed_50_with_source_label.json` — gold_source 라벨링 시드 (Group A Task 1)

### 코드 (커밋 `1cd520f`, `2057c4b`, 본 task 추가 커밋)
- `backend/scripts/label_seed_with_source.py` — 시드 source 라벨링 (xlsx join)
- `backend/scripts/eval_per_source.py` — RAGAS per-source (보류 사용)
- `backend/scripts/analyze_per_source_hit_rate.py` — NotebookLM 휴리스틱 source 분해 (활성)
- `backend/tests/scripts/test_eval_per_source.py` — 3 PASS
- `backend/tests/scripts/test_analyze_per_source_hit_rate.py` — 4 PASS

### 문서
- 본 dev-log

---

## 6. 한계 (정직하게)

- **단일 메트릭 (hit율)** 만 사용 — RAGAS 4메트릭(faithfulness/precision/recall/relevancy)이 분해된 그림은 못 봄. RAGAS hang 해결 후 `eval_per_source.py`로 재측정 필요.
- **휴리스틱 hit 판정**의 한계는 옵션 D 보고서 §5에서 이미 명시 (paraphrase miss / 답변 길이 false positive). 그러나 baseline·treatment 모두 같은 휴리스틱이라 **delta는 신뢰 가능**.
- N share 감소 원인은 **별도 조사 필요** — 본 plan 범위 외.

---

## 7. 다음 단계

본 보고서 완료. plan Group A 종료 → Group B (옵션 B 인프라) 진입.
