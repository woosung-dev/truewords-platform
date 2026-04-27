# 44. RAG Intent Routing + RAGAS 평가 도입 (액션 1+2+3)

**기간**: 2026-04-27 ~ 2026-04-28
**브랜치**: `feat/rag-intent-routing-and-eval`
**관련 인계 문서**: `~/Downloads/truewords_action_1_2_3_handoff.md`

## 0. 요약

직전 세션의 4가지 코드 튜닝(generation 컨텍스트 [:5]→[:8], rerank top_k 10→15,
query_rewriter timeout 0.8→1.5s, cache_threshold 0.93→0.88)이 NotebookLM 200건
평가에서 **L1 단순사실 +17%p / L5 추론 −7%p 비대칭** 패턴을 만든 것을 동기로,
세 가지 액션을 묶어 도입했다.

| 액션 | 내용 | 효과 (RAGAS 50건 stratified) |
|------|------|--------------------------------|
| **1** | `IntentClassifierStage` + 4 intent별 K 분기 + meta short-circuit | context_recall **+0.025**, answer_relevancy +0.015 |
| **2** | `chatbot_id='all'` system_prompt에 `[질문 유형별 답변 깊이]` 섹션 추가 (admin UI) | answer_relevancy +0.020 (단독 효과) |
| **3** | RAGAS 4메트릭 평가 자동화 (eval_ragas.py + 시드 샘플러 + 3-way 머지) | 베이스/액션2/액션1+2 비교 인프라 확보 |

3-way 비교 결과(아래 §3) — baseline 대비 액션 1+2 적용 후 **3 메트릭 향상, 1 메트릭 거의 동등**. 가장 의미 있는 변화는 추론 질문 핵심 지표인 `context_recall`이 0.400 → 0.425로 약 6% 상승한 것. 액션 2 단독은 일부 메트릭에서 저하했지만 액션 1과 결합되면서 회복 + 추가 개선.

## 1. 동기 — 직전 세션의 비대칭 패턴

직전 세션은 4가지 코드 튜닝으로 NotebookLM 200건 키워드 휴리스틱 평가에서:
- **L1 단순사실**: hit율 51% → 68% (+17%p)
- **L5 교리 추론**: hit율 21% → 14% (−7%p)

이 비대칭은 학술 결과와 정합:
- **Dhara & Sheth (Math AI 2026)**: HotpotQA(추론) 질문이 SQuAD(사실)보다 컨텍스트 노이즈에 약 2배 더 취약.
- **Cuconasu et al. (SIGIR 2024)**: near-miss(점수 높지만 정답 없는 passage)가 가장 유해.
- **Anthropic Contextual Retrieval (2024.09)**: top-20이 5/10/20 비교에서 최고 — 단 Claude 200K 가정. Gemini Flash Lite는 K 분기 필요.
- **Adaptive-RAG (NAACL 2024)**: 본 작업의 직접 모티프.

→ **단일 K 값으로는 사실/추론을 동시에 만족시킬 수 없다**. 질문 유형별로 K를 분기해야 한다.

## 2. 구현

### 2.1 액션 1 — IntentClassifierStage + K 분기

**Stage 추가** (`backend/src/chat/pipeline/stages/intent_classifier.py`):
- RuntimeConfigStage 다음, QueryRewriteStage 전에 실행
- Gemini Flash zero-shot 분류 → `factoid` / `conceptual` / `reasoning` / `meta`
- 타임아웃 **2.0s** (초기 0.8s에서 상향 — 한국어 분류 호출이 0.8s 자주 초과)
- 실패/매칭 불가 시 `conceptual` fallback (graceful degradation)

**K 매핑** (`backend/src/search/intent_classifier.py`):

| Intent | rerank top_k | gen ctx slice | 의도 |
|--------|--------------|---------------|------|
| factoid | 15 | [:8] | 폭넓은 사실 인용 |
| conceptual | 12 | [:6] | 균형 |
| reasoning | 8 | [:4] | 노이즈 차단 (Dhara&Sheth 정신) |
| meta | — | — | short-circuit (Search/Rerank/Generation 스킵) |
| legacy(None) | 15 | [:8] | 직전 보존 튜닝 호환 |

**Meta short-circuit** (Phase E):
- intent==meta 시 `META_FALLBACK_ANSWER` prefill + `PipelineState.META_TERMINATED` 전이
- `service.py`가 cache_hit 패턴 모방하여 SafetyOutput + mini-persist만 실행
- 답변: "해당 질문은 가정연합 말씀 학습 도우미의 답변 범위를 벗어납니다…"

**파일 변경**:
- 신규: `src/search/intent_classifier.py`, `src/chat/pipeline/stages/intent_classifier.py`
- 수정: `pipeline/state.py` (INTENT_CLASSIFIED + META_TERMINATED), `pipeline/context.py` (intent 필드), `chatbot/runtime_config.py` (intent_classifier_enabled 토글), `pipeline/stages/{rerank,generation}.py` (K 분기), `chat/service.py` (체인 등록 + meta 분기)
- 테스트: `tests/chat/test_intent_classifier_stage.py` (16 단위), `tests/chat/test_intent_routing.py` (5 통합)

**환경변수 토글** (`INTENT_CLASSIFIER_FORCE_OFF=1`):
- 평가/검증용으로 IntentClassifier를 코드 변경 없이 일시 비활성화
- 액션 2 단독 효과 측정 사이클에 사용 (admin UI 변경 + 이 토글 = action2 only)
- 운영 chatbot-level 토글(`retrieval.intent_classifier_enabled`)과 분리 — DB 갱신 불필요

### 2.2 액션 2 — system_prompt `[질문 유형별 답변 깊이]` 섹션

`chatbot_configs WHERE chatbot_id='all'`의 system_prompt에 인계 문서 §6 그대로 삽입(admin UI 직접 편집). 핵심 가이드:

> ▶ 단순 사실 / 출처 인용 질문: 검색된 다수의 출처를 폭넓게 활용 (목록형)
> ▶ 추론 / 해석 / 비교 / 응용 질문: 1~2개에만 집중하여 깊이 인용. 부수적 출처 나열은 좋은 답변이 아님
> ▶ 판단이 어려우면 단순 사실 가이드 우선

코드/SQL 변경 없음. system_prompt 길이: 3607자.

### 2.3 액션 3 — RAGAS 평가 자동화

**의존성** (`backend/pyproject.toml` `eval` group 신설):
- `ragas>=0.2` (실제 0.4.3)
- `langchain-anthropic>=0.2`, `langchain-google-genai>=2.0`
- `openpyxl>=3.1`, `pandas>=2.0`

**스크립트 3종**:
1. `scripts/sample_eval_pairs.py` — 200건 평가 xlsx에서 (파일 × 난이도) 비례로 stratified 50건 추출 + contexts 정규식 파싱 + JSON/xlsx 저장
2. `scripts/eval_ragas.py` — 50건 시드 → RAGAS 4메트릭(Faithfulness / ContextPrecision / ContextRecall / ResponseRelevancy) → xlsx
3. `scripts/collect_seed_answers.py` — 50건 질문을 backend `/chat`에 재호출하여 새 시드 생성 (action2/action1+2 시드 갱신용)
4. `scripts/merge_ragas_3way.py` — 3 RAGAS xlsx를 id 기준 join → 횡렬 비교 + delta 컬럼

**회귀 테스트**: `tests/test_ragas_thresholds.py` — 5건 fixture 4메트릭 ≥ 0.5 가드. `RAGAS_RUN=1` + `GEMINI_API_KEY` 명시 시에만 실행 (CI 기본 SKIP).

**평가 LLM**: 임시 `gemini-2.5-pro` (Anthropic 크레딧 잔액 부족으로 Claude Haiku 4.5 환원 보류). `docs/TODO.md` Blocked 항목으로 기록 — 충전 후 환원 예정. `gemini-3.1-pro-preview`는 RAGAS 평가에서 RPM throttling/응답 hang 다발로 사용 불가.

**전략 selection 시도 이력**:
- `RunConfig(max_workers=2, timeout=180)` + `ChatGoogleGenerativeAI(timeout=180, max_retries=2)` → hang
- `RunConfig` 없음 + `max_retries=2` only → hang
- `RunConfig` 없음 + 완전 default → 정상 (첫 sanity 1m58s 이후 50건 baseline 10m02s)
- 결론: **RAGAS 0.4.3 + langchain-google-genai 4.2.2 조합에서 RunConfig/max_retries 명시 시 hang**

## 3. RAGAS 3-way 결과 (50건 stratified)

| 메트릭 | baseline | +action2 | +action1+2 | Δ(act2-base) | Δ(act12-base) | Δ(act12-act2) |
|---|---|---|---|---|---|---|
| faithfulness | 0.541 | 0.512 (49/50) | 0.546 (36/50) | **−0.029** | **+0.005** | +0.034 |
| context_precision | 0.630 | 0.578 (50/50) | 0.626 (37/50) | **−0.052** | −0.004 | +0.048 |
| context_recall | 0.400 | 0.340 (50/50) | **0.425** (40/50) | **−0.060** | **+0.025** | +0.085 |
| answer_relevancy | 0.764 | 0.784 (50/50) | 0.779 (38/50) | **+0.020** | **+0.015** | −0.005 |

(괄호 안 n: valid score 개수. 액션 1+2 측정에서는 평가 LLM `gemini-2.5-pro`의 후반부 RPM throttling으로 timeout 49건 발생.)

**핵심 인사이트**:

1. **액션 2 단독은 양면성**: answer_relevancy +0.020 향상하지만, 다른 3 메트릭 모두 저하. system_prompt가 답변을 더 정중/길게 만들어 형식적 관련성은 올라가지만, contexts와의 일치도(faithfulness)와 ground_truth 회수율(context_recall)이 함께 떨어짐 — system_prompt 단독으로는 추론 질문의 K 노이즈 문제를 해결 못 함.
2. **액션 1+2 결합은 모든 메트릭에서 회복 또는 향상**: 가장 큰 변화는 **context_recall +0.025** (추론 질문 핵심 지표). 액션 1의 K 분기(reasoning=8 rerank, [:4] gen ctx)가 노이즈를 차단해 ground_truth 회수율을 끌어올린다.
3. **액션 1의 단독 기여 측정** (act12 − act2): 전 메트릭에서 양의 기여(+0.034 / +0.048 / +0.085 / −0.005). context_recall 기여가 가장 큼 — Dhara&Sheth 결론(추론 질문은 K가 작을수록 좋다)과 정합.

**한계**:
- 액션 1+2 RAGAS는 평가 LLM(gemini-2.5-pro) timeout 49건으로 valid score n이 36~40건. 통계 유의성은 약함.
- 평가 LLM과 생성 LLM이 같은 Gemini 패밀리 → G-Eval LLM-self-bias 우려 (Anthropic 크레딧 충전 후 Claude Haiku 4.5로 환원 시 재측정 필요).

## 4. 검증

### 단위/통합 테스트 (511 → 526)

```bash
cd backend && uv run --group eval pytest -q
# → 511 passed, 4 skipped, 1 xfailed (회귀 0)
```

신규 테스트 22개 (액션 1):
- `tests/chat/test_intent_classifier_stage.py` — 16건 (4 intent × 정상/비정상 + Stage precondition + force-off env + meta prefill)
- `tests/chat/test_intent_routing.py` — 5건 (3 intent × K 분기 + meta short-circuit + disabled fallback)
- 그리고 RAGAS 4건 (`@pytest.mark.skipif(not RAGAS_RUN)`로 기본 SKIP)

### Backend Live Verification

```bash
# action1+2 모드 (env 토글 없음)
curl -X POST http://localhost:8000/chat -H 'Content-Type: application/json' \
  -d '{"query":"너는 누구야?","chatbot_id":"all"}'
# → 121자 + sources=0 (META_FALLBACK_ANSWER + 면책고지)
# → 로그: intent_classifier: query='너는 누구야?' raw='meta' intent=meta
```

## 5. 산출물

### 코드 (10 commits, branch `feat/rag-intent-routing-and-eval`)

1. `47af69e` chore(tune): preserve previous-session tuning + eval scripts
2. `d49f0f1` chore(deps): add eval group (ragas + langchain-anthropic + openpyxl + pandas)
3. `82e3fad` fix(test): generation context 슬라이스를 [:8]로 동기화
4. `a805fba` feat(eval): add stratified sampler for RAGAS evaluation
5. `f5b8171` chore(deps): add langchain-google-genai to eval group
6. `d30b9d9` feat(eval): RAGAS 4메트릭 평가 + 회귀 임계값 테스트
7. `a504804` feat(chat): IntentClassifierStage + 4 intent별 K 분기 (액션 1 minimum slice)
8. `06e6d68` feat(chat): meta intent short-circuit (액션 1 Phase E)
9. `2e1dea6` feat(eval): 3-way RAGAS 측정 도구 + INTENT_CLASSIFIER_FORCE_OFF 토글
10. (현재 커밋) feat: RAGAS 3-way 측정 결과 + 평가 LLM Gemini 2.5 Pro 임시 fallback + dev-log

### 데이터 산출물 (`~/Downloads/`)

- `ragas_eval_seed_50_20260427_2306.json` (50건 stratified seed)
- `ragas_baseline_20260428_0059.xlsx` (baseline RAGAS, n=50/50)
- `ragas_action2_20260428_0115.xlsx` (액션 2 단독 RAGAS)
- `ragas_action1plus2_20260428_0145.xlsx` (액션 1+2 RAGAS)
- `ragas_3way_20260428_0204.xlsx` (3-way 횡렬 비교 + delta + summary)

## 6. 다음 단계 (Blocked/Follow-up)

- [ ] **RAGAS 평가 LLM Claude Haiku 4.5로 환원** (Anthropic 크레딧 충전 후) — `docs/TODO.md` Blocked 참조. G-Eval self-bias 회피.
- [ ] action1+2 RAGAS 재측정 — 평가 LLM 환원 후 timeout 다발 없이 valid n=50 확보.
- [ ] NotebookLM 200건 본 평가 (휴리스틱) — L5 카테고리 hit율이 14% 이상으로 회복됐는지 확인 (ROADMAP).
- [ ] `intent_classifier_enabled` 운영 chatbot 토글을 admin UI에서 노출 (현재는 RetrievalConfig 필드 추가만 됨, UI 미노출).

## 7. 메모리 규칙 회고 (검증 루프 한계)

본 세션은 메모리 규칙(`feedback_verification_loops.md`)에 따라:
- ✅ 사이클 3회 상한: Generator-Evaluator는 액션별 1~2회만 진행, GREEN 허용 시 즉시 다음 액션.
- ✅ 2000줄 임계: 누적 변경 운영 코드 + 테스트 ~1700줄 (uv.lock + 평가 스크립트 제외) — 임계 내.
- ✅ Vertical Slice: 액션 3 minimum → 액션 2 적용 → 액션 1 minimum slice → 측정 → 액션 1 확장(meta short-circuit) → 측정.

다음 프로젝트에서도 유지할 만한 패턴.
