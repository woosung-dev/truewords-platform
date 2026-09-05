# 54. Phase 4 청킹 PoC — Hierarchical + Contextual Retrieval (5권 신학/원리 scope)

- 일자: 2026-05-01
- 상태: PoC 완료, **운영 적용 보류** — 둘 다 자동 메트릭 임계값 미달
- 영역: Phase 4 — 마지막 청킹 결정 (88권 재임베딩 비용 ~₩2,000+ 전 검증)
- 선행: dev-log 51 (v5 Recursive 운영 채택), dev-log 53 (Phase 3 메타필터 PoC)
- 관련 PR: feat/phase-4-chunking-poc

---

## Context

dev-log 51 v5 Recursive 88권 운영 채택 후, 사용자 자료 표 1.기본 추천도 ★★★★★ 청킹 기법 (Hierarchical Parent-Child, Anthropic Contextual Retrieval) 을 5권 신학/원리 scope 에서 검증. 88권 재임베딩 비용이 상당하므로 마지막 결정 전 저비용 PoC.

선행 결정 (dev-log 53):
- Volume payload bug 수정 (PR #90, #91) → v5 backfill 완료
- Phase 3 메타필터 정합성 회복

---

## 측정 조건

### 컬렉션 (모두 5권 신학/원리 scope, source=A)

| 컬렉션 | 청킹 방식 | 청크 수 | 적재 시간 |
|---|---|---:|---:|
| `theology_poc_recursive` (baseline) | Recursive 700/150 + 한국어 종결어미 | 10,558 | 기존 |
| `theology_poc_hierarchical_pc` | Parent 1500 / Child 300 (Recursive splitter ×2) | 27,074 | 28분 |
| `theology_poc_contextual_v1` | Recursive 700/150 + Gemini Flash Lite 컨텍스트 prefix (Anthropic 패턴) | 10,558 | 21분 |

### 평가셋
- `~/Downloads/통일원리_평화사상_normalized.xlsx` (100문항, L1~L5 각 20건)
- 기존 dev-log 50 평가셋과 동일

### 측정 방법
- `eval_theology_3way.py` 신규 — chat 파이프라인 일부 직접 호출 (검색 + rerank + 생성, safety/cache/DB 우회)
- 각 컬렉션 100건 측정 ~11분
- LLM-Judge: Gemini 2.5 Pro (eval_llm_judge.py 그대로 재사용)
- Codex 정성: gpt-5.5 high reasoning, L별 stratified 10건 (build_phase4_3way_codex.py)

---

## 결과

### 자동 메트릭 (LLM-Judge 4 metric × 1~5점, 총점 4~20)

| 컬렉션 | 총점 | F1 | answer_correctness | context_relevance | context_faithfulness | context_recall |
|---|---:|---:|---:|---:|---:|---:|
| 🔵 **Recursive (baseline)** | **16.93** | 0.611 | 4.26 | 4.70 | 3.68 | 4.29 |
| 🟢 Hierarchical | 16.38 | 0.606 | 4.23 | 4.45 | 3.72 | 3.98 |
| 🟣 Contextual | 16.29 | 0.615 | 4.17 | 4.45 | 3.63 | 4.04 |

### L별 분포

| Level | Recursive | Hierarchical | Contextual | Δ Hier | Δ Ctx |
|---|---:|---:|---:|---:|---:|
| L1 (단순 사실) | 18.65 | 18.05 | 17.70 | -0.60 | -0.95 |
| L2 (출처 인용) | 18.40 | 17.90 | 17.05 | -0.50 | **-1.35** |
| L3 (주제 요약) | 15.35 | **14.05** | 15.00 | **-1.30** | -0.35 |
| L4 (개념 연결) | 15.95 | 15.55 | 15.50 | -0.40 | -0.45 |
| L5 (교리 추론) | 16.30 | 16.35 | 16.20 | +0.05 | -0.10 |
| **총점** | **16.93** | **16.38** | **16.29** | **-0.55** | **-0.64** |

**관찰**:
- 두 신규 기법 모두 모든 레벨에서 Recursive 미달 또는 동률 (L5 Hierarchical +0.05만 예외, 미세)
- **Hierarchical L3 -1.30** 가장 큰 하락 — 작은 child(300자) 가 주제 요약 질문에 부적합
- **Contextual L2 -1.35** 가장 큰 하락 — prefix 가 출처 인용 정확도를 오히려 흐림 (모범답변에서 본문 직접 인용 필요한 케이스)
- **F1 키워드 포함률**: 셋 다 0.61 근처 (사실상 동률) → 답변 자체의 키워드 활용은 비슷, 차이는 컨텍스트 충실도/회수율에서 발생

### Codex 정성 평가 (gpt-5.5, 10건 stratified)

**사례별 승자 분포**:
| 승자 | 사례 수 |
|---|---:|
| Recursive 단독 | 2 |
| Hierarchical 단독 | 2 |
| Contextual 단독 | 3 |
| Recursive = Contextual | 2 |
| 동등 | 1 |

→ 공유 승자 0.5점 환산: Recursive 3 / Hierarchical 2 / Contextual 4. 10건 표본만 보면 Contextual 약간 우세하나 자동 메트릭(100선) Recursive 우위와 충돌. Codex는 표본 크기 한계 인정.

**Codex 패턴 분석**:
- **정확도**: L1/L2 사실 조회 — Recursive 가장 안정. Contextual 추론형 우수하나 프레이밍 과잉. Hierarchical 교리적 구조 요약 강점, 세부 날짜/표현 생략.
- **문맥 활용**: Recursive 직접 근거 회수 강. Hierarchical parent_text 덕분에 넓은 설명, 노이즈 동반. Contextual 추상 질문 연결력, prefix가 답변 방향 과유도.
- **환각 리스크**: Recursive 낮음 (대신 일반론). Hierarchical 중간 (답 맞아도 구조적 표현 섞임). Contextual 중간 (L4 사상 비교 프레이밍 오류).

**Codex 운영 권장 인용**:
> "현재 기준으로는 **v5 Recursive를 운영 기본 전략으로 유지**하는 것이 맞습니다. 88권 전체를 Hierarchical 또는 Contextual로 재임베딩할 근거는 아직 약합니다."

Codex 후속 PR 우선순위 (1순위 → 3순위):
1. **v5 Recursive 유지 + 검색/리랭킹 개선** (keyword-aware rerank, citation grounding)
2. **L3~L5 전용 query classifier 기반 fallback 실험** (전체 재임베딩 아님)
3. **Contextual/Hierarchical 88권 재임베딩 보류**

---

## 채택 판정

### 임계값 (확정 룰)

| 기준 | 임계값 | Hierarchical | Contextual | 판정 |
|---|---:|---:|---:|---|
| LLM-Judge 총점 | ≥ 16.93 + 0.5 = 17.43 | 16.38 | 16.29 | **둘 다 미달** |
| Codex 정성 우월 | 우월 | 보류 권고 | 보류 권고 | **둘 다 미달** |

### 결론

**❌ 두 기법 모두 운영 적용 보류.** v5 Recursive (88권, dev-log 51) 그대로 유지.

**근거**:
1. 자동 메트릭에서 두 기법 모두 baseline 미달 (-0.55, -0.64)
2. plan 룰: "자동 + Codex 둘 다 우월" → 자동 미달 시점에서 채택 불가 (dev-log 48 학습)
3. 88권 재임베딩 비용 (~₩600 / ~₩2,000+) 정당화 안 됨

### 인사이트

**Hierarchical 약점**:
- **L3 주제 요약 -1.30**: child(300자) 가 너무 작아 큰 그림이 분산. parent_text 부착으로 LLM 컨텍스트는 회복되지만, **검색 매칭 단계**에서 개별 child 가 주제 표현 부족.
- 예상치 못한 결과 — 자료에서 "정밀 검색 + 넓은 컨텍스트" 라고 했지만, 본 도메인(짧은 인용 답변 우세) 에서는 child 가 너무 fragmented.

**Contextual Retrieval 약점**:
- **L2 출처 인용 -1.35**: 청크 본문에 LLM 생성 컨텍스트 prefix 가 prepend 되면서 임베딩 vector 의 의미 분산. 출처 정확 인용 케이스에서 본문 직접 매칭 우위가 희석됨.
- 평화경 권에서 1509/3304 청크가 prefix 생성 실패 → 메타데이터 fallback 적용. Anthropic 보고 ~35-49% 개선과 큰 격차. 실패 분석 필요.
- 추정: Gemini Flash Lite 의 한국어 종교 텍스트 이해도 한계 + concurrency=20 으로 발생한 throttling.

**Recursive 의 강점 재확인**:
- 700자 청크가 한국어 종결어미 separator 와 결합해 적절한 단위
- 답변 키워드 직접 매칭 + 컨텍스트 적합도 균형
- L1/L2 (단순/출처) 와 L3-L5 (주제/추론) 모두 baseline 으로 적절

---

## 비용/시간 합계 (실제)

| 항목 | 비용 | 시간 |
|---|---:|---:|
| Hierarchical 적재 (27K embed) | ~₩150 | 28분 |
| Contextual prefix 생성 (10K LLM call) | ~₩40 | 21분 |
| Contextual 적재 (10K embed) | ~₩40 | 포함 |
| 3-way 측정 (300 query × full pipeline) | ~₩30 | 33분 |
| 3-way LLM-Judge (300 × 4 metric) | ~₩50 | 30분 |
| Codex 3-way (gpt-5.5, 10건) | ~₩20 | ~10분 |
| **합계** | **~₩330** | **~2시간** |

원래 plan 추정 ₩280 / 8시간 vs 실제 ₩330 / 2시간 — 비용 미세 초과(평화경 prefix 실패 후 fallback 적용 후 정상), 시간 단축 (병렬 실행).

---

## 후속 권장

### 본 PR 로 머지할 것
- Hierarchical chunker 코드 (`chunk_hierarchical`) — 이후 다른 도메인 PoC 에서 재사용 가능
- Contextual Retrieval 적재 인프라 (`batch_chunk_theology_contextual.py`) — 이후 prompt caching 추가 후 615권 운영 시 재사용 가능
- 단위 테스트 8건 + eval_theology_3way 측정 스크립트 + build_phase4_3way_codex 비교 빌더

### 본 PR 로 머지하지 말 것
- 신규 컬렉션 (`theology_poc_hierarchical_pc`, `theology_poc_contextual_v1`) 은 PoC 산출물로 유지하되 운영 트래픽 미연결 (현재 신학/원리 봇은 v5 운영 컬렉션 사용)
- 88권 재임베딩 트리거 0건 (보류)

### 후속 PR 우선순위 (Codex 권고 반영)

| 순위 | PR | 효과 |
|---|---|---|
| **1** | **keyword-aware reranker + citation grounding** (Codex 1순위) | L4/L5 평가 키워드 직접 회수 + "문맥에 없는 확장" grounding rule |
| 2 | payload 책별 분리 (`book_series` 필드) | Phase 3 dev-log 53 권고, 권번호 충돌 방지 |
| 3 | L3~L5 전용 query classifier 기반 fallback (Codex 2순위) | 전체 재임베딩 없이 추론형 질문에만 parent expansion / contextual rerank 선택 적용 |
| 4 | Reranker 메타데이터 가중치 | dev-log 53 후속, exact match positive feature |
| 5 | Contextual Retrieval 재시도 + prompt caching (선택) | 평화경 prefix 1509/3304 실패 진단 + 영어 원형 prompt + 615권 재시도 (보류 권고)
| 6 | Hierarchical 변형 (parent=2000/child=600, 선택) | child fragmentation 완화 후 재측정 |

---

## 산출물

- 측정 xlsx: `tmp_match/phase4_eval/eval_{recursive,hierarchical,contextual}_*.xlsx` (gitignore)
- seed JSON: `~/Downloads/ragas_seed_theology_{recursive,hierarchical,contextual}_phase4_*.json`
- LLM-Judge: `~/Downloads/llm_judge_theology_{recursive,hierarchical,contextual}_phase4_*_{summary.md,detail.csv}`
- Codex 3-way: `tmp_match/phase4_eval/{codex_compare_3way.md, codex_review_3way.md}`
- Phase 4 인프라: `backend/scripts/{batch_chunk_theology_contextual.py, eval_theology_3way.py, build_phase4_3way_codex.py}`

---

## 변경 이력 갱신

| Phase | 결과 |
|---|---|
| 2.4 (88권 v3 vs v5) | v5 18.03, v3 16.88 (LLM-Judge) — v5 운영 채택 (dev-log 51) |
| 3 (메타필터 v5+필터) | 자동 미달 + 측정 무효 (volume bug) — Phase A 정정 후 별도 검토 (dev-log 53) |
| **4 (5권 PoC: Recursive vs Hierarchical vs Contextual)** | **Recursive 16.93 / Hier 16.38 (-0.55) / Ctx 16.29 (-0.64) — 둘 다 미달, v5 Recursive 유지 (dev-log 54)** |
