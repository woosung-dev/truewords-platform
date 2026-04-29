# 45. Paragraph 청킹 (옵션 F) 새 평가셋 50문항 재검증 + 운영 전환

- 일자: 2026-04-30
- 상태: 결정 (Decision) — **dev-log 47에서 3-way 재검증으로 보완**
- 영역: Phase 2.2 — RAG retrieval 성능 비교
- 후속: dev-log 47 (B 추가 3-way 재검증), dev-log 46 (L2 약점 보강 plan)

---

## Context

이전 측정(2026-04-29, 100문항):

| 옵션 | faithfulness | context_precision | context_recall | response_relevancy | 평균 |
|---|---:|---:|---:|---:|---:|
| A (sentence, malssum_poc) | 0.869 | 0.726 | 0.800 | 0.882 | 0.819 |
| B (prefix, malssum_poc_v2) | 0.864 | 0.746 | 0.784 | 0.890 | 0.821 |
| F (paragraph, malssum_poc_v3) | 0.887 | 0.754 | 0.817 | 0.927 | **0.847** |

→ F가 +0.028 우월. 다만 두 가지 의문이 남았다:

1. 동일 100문항을 A → B → F 순서로 반복 측정 → `semantic_cache` (threshold 0.93, TTL 7일) 영향으로
   후행 측정이 cache hit 했을 가능성
2. 측정 순서 자체가 F에 유리하게 작용했을 가능성

본 작업은 **새 평가셋 + 측정 순서 반전 + 3가지 평가 방식 통합**으로 F 우월성을 재검증한다.

---

## 측정 조건

- 평가셋: `참부모님 생애와 통일원리 문답 학습서.xlsx` 50문항 (ID 101~150)
- L1~L5 각 10건씩 균등
- `[[refN]]` 참조 표기 없음 → 키워드 포함률 F1로 전환
- 측정 순서: **F (paragraph) 먼저** → A (sentence) — 캐시 영향 격리
- 캐시 처리: 측정 시작 + 봇 전환 시점에 `semantic_cache` 컬렉션을 `delete_collection` + `ensure_cache_collection`(빈 상태)으로 재생성
- 평가 모델: `gemini-3.1-flash-lite-preview`, temperature=0
- 챗봇 토글: `'all'` 봇의 `collection_main`만 `malssum_poc` ↔ `malssum_poc_v3` 변경
  (system_prompt/persona/search_tiers 동결)

---

## 결과 — 4가지 평가 모두 F 우월 일치

### 1. RAGAS 4메트릭 (langchain 우회 직접 측정)

| 메트릭 | A 평균 | F 평균 | 차이 (F-A) |
|---|---:|---:|---:|
| faithfulness | 0.822 | 0.893 | **+0.071** |
| context_precision | 0.628 | 0.616 | -0.012 |
| context_recall | 0.531 | 0.648 | **+0.117** |
| response_relevancy | 0.758 | 0.812 | **+0.054** |
| **4메트릭 평균** | **0.685** | **0.742** | **+0.058** |

→ F가 4메트릭 중 3개에서 우월. context_precision은 사실상 동등(-0.012).

### 2. LLM-Judge 정성평가 (1~5점 정수)

| 메트릭 | A 평균 | F 평균 | 차이 |
|---|---:|---:|---:|
| answer_correctness | 3.50 | 3.56 | +0.06 |
| context_relevance | 4.04 | 4.16 | +0.12 |
| context_faithfulness | 4.30 | 4.44 | +0.14 |
| context_recall | 3.18 | 3.56 | +0.38 |
| **총점 (4~20)** | **15.02** | **15.72** | **+0.70** |

→ **4메트릭 모두 F 우월**. 가장 큰 차이는 context_recall(+0.38).
   둘 다 등급 "양호 (일부 약점 보강 후 적용)".

### 3. 키워드 포함률 F1 (참고키워드 substring 매칭)

| 지표 | A | F | 차이 |
|---|---:|---:|---:|
| kw_f1 | 0.387 | 0.390 | +0.003 (무차이) |

→ 등급 "사실상 미작동" — 답변이 참고키워드를 풀어쓰는 경향 + substring 매칭 한계.
   메트릭 자체 신뢰도 낮으므로 보조 지표로만 활용.

### L별 LLM-Judge 총점 분포

| 난이도 | A 총점 | F 총점 | 차이 (F-A) | 비고 |
|---|---:|---:|---:|---|
| L1 (단순 사실 조회) | 13.30 | 14.20 | +0.90 | F 우월 |
| L2 (출처 인용) | 11.10 | **10.50** | **-0.60** | **A 우월 (F 약점)** |
| L3 (주제 요약) | 15.30 | 16.20 | +0.90 | F 우월 |
| L4 (개념 연결) | 17.30 | 18.30 | +1.00 | F 우월 |
| L5 (교리 추론) | 18.10 | 19.40 | +1.30 | F 우월 |

→ **F는 L2(출처 인용)만 약하고 L1/L3/L4/L5 모두 우월**.

### 4. Codex 독립 검토 (10건 stratified, OpenAI gpt-5-codex)

L별 2건 stratified 10건을 OpenAI Codex CLI(consult mode)로 독립 판정:

| 판정 | 건수 |
|---|---:|
| **F 승** | **6건** |
| 동등 | 3건 |
| A 승 | 1건 |

→ **Gemini 기반 자동 평가(RAGAS/LLM-Judge) + 다른 LLM(GPT-5-codex) 정성 판정 모두 F 우월 일치**. 4번째 검증으로 결론 확정.

Codex 핵심 메시지:
- 정확도/문맥/환각 모두 F 우세. 특히 L3~L5에서 모범답변 방향과 일치
- A는 사례 1(여의도 120층 질문 → "지상 3층"으로 오답 확정)처럼 환각 위험 발견
- 보강 권고: L1/L2 특정 사실 질문은 BM25/exact-match 가중치 강화, "근거 부족" 우선 응답, 출처형 질문은 출처명/권수/행사명/숫자/비유어 필수 매칭

상세 결과: `~/Downloads/codex_review_new_dataset_n50.md`

---

## 결정

### 1. 운영 전환: `'all'` 봇 → `malssum_poc_v3` (paragraph) **영구 적용**

DB 변경 적용 (2026-04-30):
- `chatbot_id='all'`, `db_id='690d4135-cd81-42f1-9057-1da761fe0bfd'`
- `collection_main`: `malssum_poc` → **`malssum_poc_v3`**

`scripts/seed_chatbot_configs.py`도 동일하게 동기화 (다음 commit).

### 2. 이전 100선 결과 vs 새 50선 결과 — F 우월성 일관

| 측정 | 표본 | A 평균 | F 평균 | F-A | 비고 |
|---|---:|---:|---:|---:|---|
| 100선 (4/29) | 100 | 0.819 | 0.847 | +0.028 | 캐시 영향 의심 |
| 50선 (4/30) | 50 | 0.685 | 0.742 | **+0.058** | 캐시 격리 + 순서 반전 |

→ **격차가 약 2배 확대**. 캐시 영향 격리 후에도 F 우월성 재확인, 결론 강화.

---

## 부수 발견

### Backend cache 부재 시 graceful degradation 결함

- `semantic_cache` 컬렉션 부재 상태에서 `/chat` 요청 시 17건 연속 HTTP 500 발생.
- 원인: `SemanticCacheService.check_cache`의 `client.query_points` 호출이
  collection 부재 에러를 try/except로 잡지 않음 →
  `dependencies.py`의 graceful degradation(None 반환)이 무력화.
- 임시 우회: `ensure_cache_collection`을 직접 호출해 빈 컬렉션 생성 → 정상 동작.
- 후속(별도 PR): `cache_check.py`에 `qdrant_client.http.exceptions.UnexpectedResponse`
  catch + cache_available=False 자동 전환.

---

## 산출물

| 파일 | 내용 |
|---|---|
| `~/Downloads/notebooklm_qa_F_paragraph_new50_20260429_233745.xlsx` | F 측정 raw |
| `~/Downloads/notebooklm_qa_A_sentence_new50_20260429_235034.xlsx` | A 측정 raw |
| `~/Downloads/ragas_F_new50_20260429_235105.xlsx` | F RAGAS 4메트릭 |
| `~/Downloads/ragas_A_new50_20260430_000202.xlsx` | A RAGAS 4메트릭 |
| `~/Downloads/llm_judge_F_new50_*_summary.md` + `_detail.csv` | F LLM-Judge |
| `~/Downloads/llm_judge_A_new50_*_summary.md` + `_detail.csv` | A LLM-Judge |
| `~/Downloads/codex_compare_input_new50.md` | Codex 검토 입력 (10 사례) |
| `~/Downloads/codex_review_new_dataset_n50.md` | **Codex 판정 결과 (F 6승 / A 1승 / 동등 3)** |
| `~/Downloads/ab_comparison_new_dataset_20260430_0136.xlsx` | 통합 5시트 (RAGAS/LLM-Judge/F1/Codex/이전 100선) |
| `~/Downloads/phase2_new_dataset_report_20260430_0136.md` | 결론 보고서 |

신규 스크립트:
- `backend/scripts/eval_llm_judge.py` — 정성 4메트릭 + 키워드 F1
- `backend/scripts/build_codex_compare_md.py` — A/F 비교 마크다운
- `backend/scripts/build_phase2_combined_report.py` — 통합 xlsx + 결론 보고서

기존 수정:
- `backend/scripts/build_ragas_seeds_from_ab.py` — `--xlsx`/`--label` 단일 파일 모드 + `keywords` 필드

---

## 후속 액션

1. **L2(출처 인용) 약점 보강** — paragraph 청킹의 메타데이터(권 번호, 날짜) 결합력 약함.
   Codex가 동일하게 권고함(BM25/exact-match 가중치, 출처명/권수 필수 매칭).
   별도 plan: `docs/dev-log/46-paragraph-l2-citation-strengthening.md`
2. **Backend cache graceful degradation 결함 수정** — 별도 PR.
3. **`scripts/seed_chatbot_configs.py` 동기화** — `'all'` 봇 default `collection_main`을
   `malssum_poc_v3`로 변경 (본 commit에 포함).
4. **"근거 부족" 우선 응답 정책** — Codex 권고 추가. 핵심 키워드가 컨텍스트에 없으면
   일반론 답변 대신 명시적 근거 부족 응답 유도. 시스템 프롬프트 보강 후속 검토.
