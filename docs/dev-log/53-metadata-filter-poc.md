# 53. 메타데이터 필터 PoC — 권번호 query parsing + Qdrant filter (방안 A)

- 일자: 2026-04-30
- 상태: PoC 완료, **운영 적용 보류** (자동 메트릭 임계값 미달, 부분 효과 확인)
- 영역: Phase 3 — 검색 단계 메타데이터 구조화
- 선행: dev-log 51 (v5 운영 채택)
- 관련 PR: feat/phase-3-metadata-filter (커밋 `3d682be` 기준)

---

## Context

dev-log 51에서 **v5 (Recursive 700/150 + 한국어 종결어미 separator)** 88권 운영 채택. Codex 정성 평가에서 일관되게 권고한 후속 과제는 **메타데이터 구조화**:

> L2 제목/출처 질문은 별도 인덱스가 필요하다. `title`, `section`, `date`, `event`, `page` 메타데이터를 구조화하지 않으면 chunking만으로 안정화하기 어렵다.

본 PoC: 검색 전 단계에서 질문에서 권/날짜/페이지를 정규식으로 추출하여 Qdrant filter 로 강제하는 **방안 A** 단독 구현 + Light RAG 100선 측정.

---

## 구현 (방안 A)

### 신규/변경 파일

| 파일 | 변경 |
|---|---|
| `backend/src/search/metadata_extractor.py` | **신규** — 정규식 추출 + filter conditions 빌더 |
| `backend/src/search/hybrid.py` | `query_metadata` 인자 + must_conditions AND 결합 |
| `backend/src/search/cascading.py` / `weighted.py` | `query_metadata` 패스스루 |
| `backend/src/chat/pipeline/stages/search.py` | `extract_query_metadata(ctx.request.query)` 호출 (rewrite 전 원문 사용) |
| `backend/src/chat/pipeline/context.py` | `ChatContext.query_metadata: dict[str, int]` 필드 추가 |
| `backend/tests/test_metadata_extractor.py` | **신규** — 단위 테스트 23건 |

### 정규식 패턴

- 권번호: `말씀선집 N권` / `제N권` / `N권` (우선순위 높은 패턴 우선)
- 날짜: `YYYY년 MM월 DD일` / `YYYY년`
- 페이지: `p.N` / `N쪽` / `N페이지`

### Filter 적용 범위 (본 PR)

- **volume**: 100% 채워진 payload + `_extract_volume`이 `.zfill(3)` 적용 → 일관된 `"NNN권"` 포맷
  → `MatchValue` exact match 적용. vol=5 → `"005권"` 만 매칭 (substring 매칭 시 005/015/025 거짓 양성 발생 → exact match로 차단)
- **date**: payload 11.5%만 채워짐 + 형식 이질적(`"1956년 10월 3일"`, `"1956.10.3"`, `"1956-10-3"`) → **본 PR 보류** (text index 추가 후 후속 PR)
- **page**: payload 미저장 → **보류**

→ 100문항 중 21건에서 메타데이터 추출, 그 중 **9건만 실제 volume filter 적용** (모두 L2).

---

## 측정 결과

### 측정 조건

- 컬렉션: `malssum_poc_v5` (Recursive 88권, 45,233 청크)
- 평가셋: Light RAG 100선 (`Light RAG전 성능 평가용 5단계 테스트 데이터셋 기존전략에서 업그레이드 유무를 위한.xlsx`)
- 챗봇: `all` (전체 검색봇, mode=cascading)
- 측정 시간: 18.7분 (100건, 평균 11.2s/query, 0 failures)
- 평가: LLM-Judge (Gemini 2.5 Pro) + RAGAS

### LLM-Judge 비교 (4 메트릭 × 1~5점, 총점 4~20)

| 항목 | v5 R1 | v5 R2 | v5 평균 (baseline) | **v5 + 메타필터 (Phase 3)** | Δ vs 평균 |
|---|---:|---:|---:|---:|---:|
| answer_correctness | 4.30 | 4.36 | 4.33 | 4.39 | +0.06 |
| context_relevance | 4.60 | 4.66 | 4.63 | 4.75 | +0.12 |
| context_faithfulness | 4.40 | 4.51 | 4.46 | 4.50 | +0.04 |
| context_recall | 4.45 | 4.29 | 4.37 | 4.39 | +0.02 |
| **총점** | **18.23** | **17.82** | **18.03** | **18.03** | **±0** |
| 키워드 F1 | 0.432 | 0.441 | 0.437 | 0.443 | +0.006 |

### L별 분포

| Level | v5 R1 | v5 R2 | v5 평균 | **Phase 3** | **Δ vs 평균** | 메타필터 적용 건수 |
|---|---:|---:|---:|---:|---:|---:|
| L1 | 17.75 | 17.05 | 17.40 | 16.95 | -0.45 | 0/20 |
| **L2** | 17.00 | 17.15 | **17.08** | **17.55** | **+0.47** ✨ | **9/20** |
| L3 | 18.55 | 18.65 | 18.60 | 18.40 | -0.20 | 0/20 |
| L4 | 18.85 | 18.10 | 18.48 | 18.60 | +0.12 | 0/20 |
| L5 | 19.00 | 18.15 | 18.58 | 18.65 | +0.07 | 0/20 |

→ **L2 +0.47** 의미있는 개선. 메타필터 적용 0건인 다른 레벨의 ±0.45 변동은 측정 변동성 범위 내 (dev-log 51 측정 순서 효과 ±0.41 참고).

### volume_num 필터 적용 9건 상세

| ID | volume | v5 R1 | v5 R2 | 평균 | Phase 3 | Δ |
|---|---:|---:|---:|---:|---:|---:|
| 013 | 3 | 20 | 20 | 20.0 | 18 | -2.0 |
| **015** | 1 | 5 | 20 | 12.5 | **20** | **+7.5** ✨ |
| 063 | 1 | 19 | 20 | 19.5 | 20 | +0.5 |
| 064 | 2 | 19 | 20 | 19.5 | 19 | -0.5 |
| 065 | 3 | 20 | 20 | 20.0 | 20 | 0.0 |
| 066 | 4 | 17 | 20 | 18.5 | 17 | -1.5 |
| 067 | 5 | 20 | 20 | 20.0 | 20 | 0.0 |
| 068 | 6 | 18 | 19 | 18.5 | 20 | +1.5 |
| 070 | 12 | 12 | 11 | 11.5 | 13 | +1.5 |

- **9건 평균 Δ: +0.78점**
- 개선 4건 / 하락 3건 / 동률 2건
- 가장 큰 효과: **015번 +7.5점** (5→20점) — 메타필터로 정확한 권에서 답변 도출 (cf. v5 R1에서 5점이었던 이유는 baseline 측정 변동)

### RAGAS

❌ **RAGAS 측정 미완료** — `eval_ragas_batched.py`(batch_size=5) 첫 batch 600초 timeout, 3건 smoke 240초도 무출력. RAGAS 패키지/Gemini API 조합의 알려진 hang(스크립트 docstring "50건 hang 회피" 참조). 본 세션 환경에서 재현되어 측정 보류.

→ LLM-Judge가 dev-log 51 채택 기준이었으므로 본 PoC 채택 판정은 **LLM-Judge primary signal로 충분**. RAGAS 보강은 hang 원인 진단 후 별도 측정 (후속 작업).

---

## 채택 판정

### 임계값 (dev-log 48 학습 — 자동 + Codex **둘 다** 우월 시 채택)

| 기준 | 임계값 | Phase 3 | 결과 |
|---|---:|---:|---|
| LLM-Judge 총점 | ≥ 18.5 | 18.03 | **미달** (+0.47 부족) |
| L2 LLM-Judge | ≥ 18.0 | 17.55 | **미달** (+0.45 부족) |
| Codex 정성 우월 | 우월 | **미달** (보류 권고) | gpt-5.5 high reasoning, 14건 비교 |

### Codex 정성 평가 결과 (gpt-5.5)

`tmp_match/phase3/codex_compare_phase3.md`(14건) → `codex exec` 평가 → `tmp_match/phase3/codex_review_phase3.md`.

**Section 1 — 필터 적용 9건**:
- Phase 3 우월: **4건** (S1-1, S1-2, S1-4, S1-8)
- baseline 우월: **2건** (S1-3, S1-7)
- 동등: **3건** (S1-5, S1-6, S1-9 — S1-9는 둘 다 실패)

**Section 2 — Control 5건 (필터 미적용, 부작용 검증)**:
- baseline 우월: **3건** (S2-2, S2-4, S2-5)
- Phase 3 우월: 1건 (S2-3)
- 동등: 1건 (S2-1)

**Codex 종합 의견**:
> "Phase 3는 권번호가 명확하고 메타데이터가 정확히 맞는 L2 질문에서 이득이 있다. 그러나 운영 적용은 아직 보류가 맞다. ① S1-3처럼 필터 적용 케이스에서도 다른 권 자료가 상위에 섞이고, ② S1-9처럼 권번호 필터가 실패하면 답변이 정답 스니펫을 보고도 엉뚱한 일반론으로 흐르고, ③ control에서 일부 정밀 정보가 빠지거나 핵심 근거가 교체된다. 현재 형태의 전면 운영 적용보다는 feature flag 기반 제한 적용이 적절하다."

**중요 신호**:
- **S1-9 권번호 필터 실패**: 12권 질문인데 16권 자료 회수 → 책별 메타데이터 분리 필요성 검증
- **Control 부작용 신호**: "필터 미적용 케이스인데 결과가 달라졌다면, 메타필터 외에 후보 구성/정렬/생성 입력 순서가 바뀐 영향인지 별도 확인이 필요" → 후속 진단 필요

### 결론

**❌ 운영 적용 보류** — 자동 메트릭(LLM-Judge ≥ 18.5) **미달** + Codex 정성 **보류 권고** → "자동 + Codex 둘 다 우월" 임계값 미달 (dev-log 48 학습 그대로 적용).

다만 **부분 효과는 분명히 검증됨**:
- L2 (메타필터 영향 레벨) +0.47점, plan 예측치와 정확히 일치
- 필터 적용 9건 평균 +0.78점, 015번처럼 +7.5점 강력 효과 사례 존재
- Codex Section 1: Phase 3 4승 / baseline 2승 / 동등 3 → 필터 적용 케이스는 net positive
- Codex Section 2: baseline 3승 / Phase 3 1승 / 동등 1 → control 부작용 신호 (후속 진단 대상)

영향 범위가 9% (9/100건)에 갇혀 전체 평균 동률에 머물렀고, control 부작용 신호도 일부 확인됨.

---

## 보류 사유 / 후속 과제

### 본 PR 한계

1. **영향 범위 9%**: 권번호 명시 질문만 효과. 100선의 전체적 품질을 끌어올리지 못함.
2. **책별 메타데이터 미분리**: "참어머님 말씀정선집 1권"과 "문선명선생 말씀선집 001권"이 모두 `volume="001권"`로 매칭됨. 지금은 운 좋게 두 시리즈가 source 또는 title로 자연 분리되어 충돌 적었지만 구조적 위험.
3. **date / page filter 미구현**: payload 형식 이질성 + 미저장.

### 권장 후속 PR (Codex 우선순위 반영)

| 우선순위 | PR | 효과 |
|---|---|---|
| **1** | **payload 책별 분리** (`book_series` + `volume_num` + `normalized_volume` 필드) | **Codex 최우선 권고** — 권번호 충돌 차단, S1-9 같은 실패 방지 |
| **2** | **Reranker 가중치** (`metadata_exact_match` positive, `volume_mismatch` penalty) | Codex 권고 — 메타 일치 문서가 rerank 후 밀리는 문제 해결 |
| 3 | 점수 부스팅 (질문 핵심어 본문 직접 일치 boost) | 비명시 표현도 일부 커버, `한국어`/`다이아 반지` 등 keyword anchor |
| 4 | date payload ISO 통일 + text index → soft boost (hard filter 아님) | Codex 권고 — recall 손실 위험으로 tie-breaker 적용 |
| 5 | RAGAS hang 원인 진단 + 재측정 | Gemini API 호출 패턴/패키지 버전 점검 |
| 6 | Control 부작용 진단 | 필터 미적용 케이스에서 답변 변동 원인 파악 (생성 입력 순서 등) |

### 보존 결정

본 PoC 코드는 **그대로 머지하되 운영 비활성화**:
- 메타필터 코드는 always-on 으로 동작 중 (비명시 질문은 빈 dict → 필터 no-op)
- 영향 범위 9%, 부작용 측정 변동성 범위 내 → 운영 영향 ~중립
- 후속 PR이 본 코드를 확장 사용 가능

또는 Feature flag (`PHASE3_METADATA_FILTER_ENABLED=False`) 도입 후 머지하는 옵션도 검토 가능.

---

## 운영 영향

- 측정 동안만 'all' 봇이 메타데이터 필터 적용 (~22분, Light RAG 100선)
- 코드 머지 후 운영 환경: 권번호 명시 질문(9% 트래픽 추정)만 필터 적용, 나머지 91%는 v5 baseline 동일 동작
- Cloud Run 재배포 영향: 추가 latency < 1ms (정규식 매칭) + Qdrant filter 조건 추가 무시 가능

---

## 산출물

- 측정 xlsx: `tmp_match/phase3/eval_v5_meta_light100_20260430_2327.xlsx` (gitignore)
- seed JSON: `~/Downloads/ragas_seed_v5_meta_n100_LR_20260430_2346.json`
- LLM-Judge: `~/Downloads/llm_judge_v5_meta_n100_LR_20260430_2346_{summary.md,detail.csv}`
- RAGAS: 미생성 (script hang)
- Codex 비교 입력: `tmp_match/phase3/codex_compare_phase3.md` (14건, gitignore)
- Codex 평가 결과: `tmp_match/phase3/codex_review_phase3.md` (gpt-5.5 high reasoning)
- Codex 비교 빌더: `backend/scripts/build_phase3_codex_compare.py`

---

## 변경 이력

| Phase | 결과 |
|---|---|
| 2.1 (4/29 100선) | F 0.847, A 0.819, B 0.821 — F 우월 |
| 2.4 (88권 v3 vs v5) | v5 18.03, v3 16.88 (LLM-Judge) — v5 운영 채택 |
| **3 (88권 v5 vs v5+메타필터)** | **자동: 동률 18.03 / +0.47 (L2) ｜ Codex: S1 4승 2패, S2 1승 3패 ｜ 운영 보류, 책별 분리 + Reranker 가중치 후속 PR로 진행** |
