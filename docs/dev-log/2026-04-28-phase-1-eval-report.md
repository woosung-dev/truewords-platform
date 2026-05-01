# Phase 2 옵션 D — NotebookLM 200건 평가 보고서

> **세션**: 2026-04-28 10:01~10:44 KST
> **브랜치**: `feat/phase-2-contextual-retrieval-and-source-ablation` (HEAD `7515f51`)
> **베이스**: `c2bb05b` (PR #68 — IntentClassifierStage + RAGAS 도입)
> **환경**: `INTENT_CLASSIFIER_FORCE_OFF` 미설정 (액션 1+2+3 ON 그대로 측정), `chatbot_id=all`
> **plan**: `/Users/woosung/.claude/plans/downloads-truewords-phase-2-handoff-md-refactored-hickey.md`

---

## 0. 한 줄 결론

L1 유지 (0.850 → 0.850) + **L5 여전히 5% (회복 실패)** + 천일국·참부모 일부 카테고리 소폭 후퇴 → 인계서 §4-D **분기 #2 "옵션 B + G 병행" 권고**.

---

## 1. 산출물 (`~/Downloads/`)

### 측정 결과 (액션 1+2+3 ON, 4월 28일)
- `notebooklm_post_phase1_20260428_1001_light100.xlsx` (266K, 100건 / 실패 0 / 21.1분)
- `notebooklm_post_phase1_20260428_1001_cheonilguk50.xlsx` (149K, 50건 / 실패 0 / 11.0분)
- `notebooklm_post_phase1_20260428_1001_chambumo50.xlsx` (140K, 50건 / 실패 0 / 10.8분)

### 좌우 머지 비교 (베이스라인 vs 액션 1+2+3)
- `notebooklm_post_phase1_20260428_1001_compare_light100.xlsx`
- `notebooklm_post_phase1_20260428_1001_compare_cheonilguk50.xlsx`
- `notebooklm_post_phase1_20260428_1001_compare_chambumo50.xlsx`

### 카테고리 분석 (신규 스크립트 `analyze_notebooklm_categories.py`)
- `notebooklm_post_phase1_20260428_1001_category_analysis_light100.xlsx`
- `notebooklm_post_phase1_20260428_1001_category_analysis_cheonilguk50.xlsx`
- `notebooklm_post_phase1_20260428_1001_category_analysis_chambumo50.xlsx`

### 베이스라인 (4월 27일 측정, 4가지 코드 튜닝 직후)
- `notebooklm_qa_전체검색봇_평가_튜닝후_20260427_1649.xlsx` (Light + 통일원리 100건)
- `천일국섭리_튜닝후.xlsx` (50건)
- `참부모섭리_튜닝후.xlsx` (50건)

---

## 2. 카테고리 hit율 표

휴리스틱 정의: `참고 키워드`(쉼표 분리) 토큰의 절반 이상이 `참고1+참고2+참고3` 텍스트에 포함되면 hit. `backend/scripts/analyze_notebooklm_categories.py`.

### Light + 통일원리 100건 (Level별)

| Level | n | baseline | treatment | delta |
|---|---:|---:|---:|---:|
| L1 단순 사실 조회 | 20 | 0.850 | 0.850 | +0.000 |
| L2 출처 인용 | 20 | 0.850 | 0.850 | +0.000 |
| L3 주제 요약 | 20 | 0.600 | 0.550 | −0.050 |
| L4 개념 연결 | 20 | 0.450 | 0.450 | +0.000 |
| L5 교리 추론 | 20 | **0.050** | **0.050** | **+0.000** |

**회귀 7건 / 개선 6건 (순 −1).**

### 천일국 50건

| Level | n | baseline | treatment | delta |
|---|---:|---:|---:|---:|
| 긍정적 | 10 | 0.300 | 0.300 | +0.000 |
| 부정적 | 20 | 0.200 | **0.100** | **−0.100** |
| 평균적 | 20 | 0.450 | 0.450 | +0.000 |

**회귀 2건 / 개선 0건 (순 −2).**

### 참부모 50건

| Level | n | baseline | treatment | delta |
|---|---:|---:|---:|---:|
| 간단 | 20 | 0.400 | 0.350 | −0.050 |
| 보통 | 20 | 0.350 | 0.300 | −0.050 |
| 상세 | 10 | 0.300 | 0.300 | +0.000 |

**회귀 5건 / 개선 3건 (순 −2).**

### 총괄

- **L1 (단순 사실 조회) 유지**: 0.850 → 0.850 ✓ — 인계서 §5 "L1 유지" 충족, 롤백 사유 아님.
- **L5 (교리 추론) 회복 실패**: 0.050 → 0.050 — 인계서 §5 "목표 12%+"에 한참 미달, 변화도 0.
- **소폭 카테고리 회귀 5건**: L3 주제 요약 −0.050 / 천일국 부정적 −0.100 / 참부모 간단·보통 각 −0.050.
- **총 200건**: 회귀 14 / 개선 9 (순 −5건). 통계적으로는 노이즈 수준이나, 평균이 향상되지 않은 것은 분명.

---

## 3. 회귀·개선 사례 표본 (각 상위 5건)

### 회귀 (베이스 hit, 액션 1+2+3 miss) — Light+통일원리 7건 중 5건

세부 행은 `~/Downloads/notebooklm_post_phase1_20260428_1001_category_analysis_light100.xlsx` 시트 "회귀" 참조. 패턴 요약:
- 인텐트 분류기가 의도를 잘못 잡아 예전엔 매칭됐던 출처를 놓침 (특히 L3·L4 추론형)
- 일부는 답변 길이는 늘었으나 핵심 키워드(권명/날짜)가 누락되며 휴리스틱 hit 실패

### 개선 (베이스 miss, 액션 1+2+3 hit) — 6건

- 새 시스템 프롬프트(액션 2)의 답변 형식 강제로 답변에 출처 권명이 명시되며 hit
- 단순 사실 조회(L1)에서 일부 boost (이미 0.85에 도달해 표 평균은 변하지 않음)

상세는 분석 xlsx의 "회귀"·"개선" 시트에서 사용자가 직접 검토 가능.

---

## 4. 분기 권고 (인계서 §4-D)

| 분기 | 트리거 | 본 측정 결과 |
|---|---|---|
| #1 B 단독 | L5 회복 + L1 유지 | ❌ L5 회복 실패 |
| **#2 B + G 병행** | **L5 여전히 낮음** | ✅ **여기 해당** |
| #3 액션 1+2 롤백 검토 | L1마저 후퇴 | ❌ L1 유지됨 |

### 권고 근거
1. **L5 (교리 추론) 5%**는 RAG 자체의 retrieval 품질 한계를 시사 — 프롬프트(액션 2)/IntentClassifier(액션 1) 같은 prompt-layer 개선으로는 해결 어려움 → 옵션 **B Anthropic Contextual Retrieval** (top-20 retrieval failure −67% Anthropic 검증치)이 본질적 해법.
2. **천일국 부정적 −0.100, 참부모 간단·보통 −0.050**처럼 봇/카테고리별로 회귀가 분산 → 어느 source가 약점인지 모르는 상태에서 B 단독 진입은 잘못된 prefix 우선순위 위험. 옵션 **G Source-weight ablation**이 0.5~1일 작업으로 약점 source를 식별 → B의 contextual prefix를 약점 source에 집중 적용 가능.
3. B(5~7일) + G(0.5~1일) 병행은 G가 B의 의사결정 입력이 되므로 직렬 의존이 아닌 병행 가능 (인계서 §4-G "B와 병행 가능").

### 인계서 §0 표상 후속 작업
- 🥈 B Anthropic Contextual Retrieval — 615권 재인덱싱 (5~7일)
- 🥈 G Source-weight ablation — per-source 메트릭 분해 (0.5~1일, B와 병행)

옵션 F PoC, H Citation eval은 본 분기에서는 후순위 (인계서 §0 🥉).

---

## 5. 부수적 발견 (별도 처리 필요)

### main HEAD 자체의 회귀 — 5 tests failed
PR #68 (`c2bb05b`) 머지 후, 옵션 D와 무관한 영역에서 5건 failure가 main에 잠복:
- `tests/chat/test_stream_abort.py::TestStreamAbortIntegration::test_stream_abort_force_transitions_to_STREAM_ABORTED`
- `tests/test_chat_service.py::test_process_chat_without_rerank`
- `tests/test_chat_service.py::test_process_chat_with_rerank`
- `tests/test_chat_service.py::test_process_chat_records_rerank_in_search_event`
- `tests/test_chat_service.py::test_process_chat_empty_results`

본 plan은 `backend/scripts/*` + `backend/tests/scripts/*` 만 변경했으므로 영향 0 — main에 사전 존재한 회귀 (IntentClassifierStage 도입 시 기존 mock 시그니처 변경분이 chat_service 테스트와 어긋난 것으로 추정). **별도 PR로 fix 필요** — 후속 plan에 포함 예정.

### 휴리스틱 한계
`참고 키워드` 컬럼 토큰 매칭은 단순 substring이라:
- 답변에 의미상으로 정답이 있어도 키워드가 paraphrase되면 miss
- 답변 길이가 길수록 hit 가능성 증가 (false positive 가능)
RAGAS faithfulness/context_recall (옵션 H 신규 메트릭과 합쳐) 후속 평가에서 보완 예정.

---

## 6. 다음 단계

1. 본 보고서 사용자 승인 + 분기 결정 (예상: **B + G 병행**)
2. 후속 plan 작성: `superpowers:writing-plans` → `docs/superpowers/plans/2026-04-28-option-b-and-g.md`
3. 별도 plan: main HEAD 5 tests fix (B + G와 병렬 가능)
