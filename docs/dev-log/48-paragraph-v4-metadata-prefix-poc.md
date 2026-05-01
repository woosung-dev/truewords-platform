# 48. v4 (paragraph + metadata prefix injection) PoC — 자동 메트릭 vs Codex 의견 충돌

- 일자: 2026-04-30
- 상태: 결정 보류 (PoC 결과 → 운영 채택 보류, 추가 검증 필요)
- 영역: Phase 2.2 후속 — 단일 청킹 통일 + L2 강화 시도
- 선행: dev-log 45 (F 운영 전환), 46 (L2 보강 plan), 47 (3-way 재검증)

---

## Context

dev-log 47의 3-way 재검증에서 B(prefix)가 L1/L2에 강하고 F(paragraph)가 L3~L5에 강하다는 패턴이 확인됐다. 사용자가 하이브리드(F+B 동시 검색)의 운영 부담(2x 적재/임베딩, 동기화 부담, 신규 청킹 도입 시 일관성)을 지적하면서 **단일 청킹으로 통일하되 메타데이터 강점을 살리는 방향**을 요청.

→ dev-log 46의 **방안 A (paragraph 본문 앞에 권/날짜 prefix injection 후 재임베딩)** 를 PoC로 진행. 새 컬렉션 `malssum_poc_v4`를 만들고 v3와 동일 평가셋 100문항으로 비교.

**의도하는 결과**: v4가 L2 약점을 회복하면서 L3~L5 강점을 유지하는지 확인. 통과 시 단일 청킹 운영 일관성 + L1/L2 보강.

---

## 측정 조건

- 평가셋: 통일교 원리 및 섭리 퀴즈 데이터베이스 (50) + 참부모님 생애와 통일원리 문답 학습서 (50) = **100문항**
- L분포: L1~L5 각 20건씩
- 측정 순서: v4 → v3 (각 batch 사이 cache delete + ensure)
- 'all' 봇 collection_main 토글: v3 → v4 → v3 (운영 복원)
- 평가 모델: gemini-3.1-flash-lite-preview, temperature=0
- Codex: OpenAI gpt-5-codex (consult mode, model_reasoning_effort=medium)

### v4 prefix 형식

`[volume / date]` (date 누락 시 `[volume]`)
- volume: 권명 (확장자 제거)
- date: `extract_metadata`로 텍스트 첫 500자에서 추출
- payload `text`는 원문 본문 그대로 (prefix는 임베딩에만 결합)

`backend/scripts/batch_chunk_paragraph_v4.py:54-72` 신규 작성 — 기존 `Chunk.prefix_text` 인프라 재활용 (이미 옵션 B contextual retrieval용으로 만들어진 필드).

### v4 적재 결과

- 88권 raw 모두 처리 (실패 0)
- 청크 수: **22,419** (v3와 동일)
- 소요: 27분 (paid tier 임베딩)
- prefix 샘플: `[참어머님 말씀정선집_4권 2015-2017_Final_End]`, `[통일사상요강(한글판)v2 / 1993년 4월 30일]` 등

---

## 결과 — 자동 메트릭 vs Codex 정성 평가의 충돌

### 1. 자동 메트릭 (v4 우월 신호)

| 평가 | v3 | v4 | 차이 |
|---|---:|---:|---:|
| RAGAS 4메트릭 평균 | 0.718 | **0.729** | **+0.011** ✅ |
| LLM-Judge 총점 (4~20) | 15.58 | **15.95** | **+0.37** ✅ |
| 키워드 F1 | 0.347 | 0.368 | +0.021 |

### RAGAS 메트릭별

| 메트릭 | v3 | v4 | 차이 |
|---|---:|---:|---:|
| faithfulness | 0.867 | 0.857 | -0.010 |
| context_precision | 0.600 | **0.621** | **+0.021** |
| context_recall | 0.624 | **0.645** | **+0.021** |
| response_relevancy | 0.782 | **0.794** | **+0.012** |

### L별 LLM-Judge 총점

| 난이도 | v3 | v4 | 차이 | 비고 |
|---|---:|---:|---:|---|
| L1 (단순 사실) | 14.00 | **14.75** | +0.75 | v4 향상 |
| **L2 (출처 인용)** | **11.60** | **11.80** | **+0.20** ✅ | **채택 기준 11.5 통과** |
| L3 (주제 요약) | 16.70 | 16.35 | **-0.35** | v3 우세 |
| L4 (개념 연결) | 16.85 | **18.50** | **+1.65** | v4 큰 향상 |
| L5 (교리 추론) | 18.75 | 18.35 | **-0.40** | v3 우세 |

### 채택 기준 자동 판정

| 조건 | 기준 | v3 | v4 | 통과 |
|---|---|---:|---:|---|
| 1. RAGAS 4메트릭 평균 | v4 ≥ v3 | 0.718 | 0.729 | ✅ |
| 2. LLM-Judge L2 총점 | v4 ≥ 11.5 | 11.60 | 11.80 | ✅ |

**자동 판정: v4 채택 후보**.

### 2. Codex 독립 정성 평가 — 다른 결론

10건 stratified Codex 검토 결과:

| 판정 | 건수 |
|---|---:|
| v3 승 | **4건** |
| v4 승 | **4건** |
| 동등 | 2건 |

**자동 메트릭과 달리 사실상 동률**. Codex는 **운영 채택 보류** 권고:

> v4를 전면 채택하기에는 근거가 약하다. 권고는 **조건부 v4 채택**이다.
>
> - L1/L4에서는 v4가 도움 되는 사례가 있다.
> - 그러나 L2의 핵심 가설은 아직 입증되지 않았다.
> - L5에서는 v3가 더 안정적인 사례가 많다.
> - prefix를 본문에 직접 섞는 방식은 의미 검색 공간에 노이즈를 넣을 수 있다.

### Codex가 발견한 prefix injection 부작용

- **사례 4 (L2)**: "120일" 질문이 v4에서 "120가정"으로 끌려감 — 숫자 prefix/본문 혼합 검색의 오탐
- **사례 6 (L3)**: v4가 직접 근거 150권 301쪽보다 십일조 일반론에 끌려감
- **사례 8~10**: prefix가 추론 품질 개선 증거 없음. 고난도 질문은 검색보다 합성 능력이 병목

### Codex의 핵심 권고 (대안)

1. 메타데이터 prefix를 임베딩 본문에 넣는 방식은 유지하되, **L2 질문에는 metadata filter/boost를 별도 적용**
2. "말씀선집 N권", "YYYY년", "p." 같은 패턴은 검색 전 파싱해서 `volume`, `date`, `source` 필터로 강제
3. v4 단독 전환 전, **L2 전용 평가셋 50~100건 추가 검증 필수**
4. v3/v4 hybrid retrieval 또는 rerank 단계에서 원문 적합도와 메타데이터 적합도를 분리 scoring

---

## 결정 — 운영 채택 보류 + 추가 검증 후 재결정

### 자동 메트릭은 v4 우월하지만 Codex 정성 평가는 사실상 동률

자동 메트릭의 +0.011/+0.37 격차는 **표본 100건의 통계적 noise 범위 내**일 가능성. Codex가 직접 본 10건에서 실제 답변 품질 차이가 명확하지 않았던 점이 더 중요한 신호.

특히 **L3 -0.35, L5 -0.40 후퇴**가 자동 메트릭에서도 일부 관찰됨 — Codex가 지적한 "prefix가 추론 품질을 약화시키는 경향"과 일치.

### 결정

1. **운영 전환 보류** — `'all'` 봇 `collection_main = malssum_poc_v3` 그대로 유지
2. **v4 컬렉션은 분석용으로 보존** — 추가 평가 + 후속 PoC 비교용
3. **dev-log 47의 권장 진화(F + B 하이브리드)는 사용자 의견에 따라 폐기** — 운영 부담 + 동기화 위험
4. **Codex 권고 대안 채택**: paragraph + 메타데이터 필터링/부스팅 분리 설계 (다음 PoC)

### 14% 적재 한계 명시

현재 88권/615권 (~14%) 적재. Codex도 동일하게 지적:

> 특정 권이 미적재이거나 관련 문맥이 일부만 있으면 prefix 효과를 제대로 측정하기 어렵다. L2는 특히 전체 권 단위 커버리지가 중요하다.

→ **데이터 적재 50%/75%/100% 마일스톤마다 v3/v4 재측정 필수**. 현 시점 결론은 잠정.

---

## 후속 액션 (우선순위 재정렬)

기존 dev-log 46의 우선순위가 v4 PoC 결과로 변경됨:

### ★★★★★ 방안 E (신규) — Codex 권고 채택: 메타데이터 필터링/부스팅 분리 설계

paragraph 청킹은 v3 그대로 유지. 검색 단계에서:

```python
# pseudo
question = "말씀선집 56권에서 1975년 120개국에 선교사를 보낸 섭리적 배경은?"

# 1. 패턴 파싱 (재임베딩 X, 코드만 변경)
volume_match = re.search(r"말씀선집\s*(\d+)\s*권", question)
date_match = re.search(r"(\d{4})년", question)

# 2. 검색 시 강제 필터 또는 점수 부스팅
if volume_match:
    must_filters.append(FieldCondition(
        key="volume",
        match=MatchText(text=f"말씀선집 {volume_match.group(1)}권")
    ))
```

- **장점**: 재임베딩 0, paragraph 청킹 그대로, 메타데이터 강제 필터링이 prefix injection보다 안전
- **단점**: 명시적 패턴이 없는 우회 표현 (예: "70년대 초반")은 미커버
- **검증**: 동일 100문항 재측정 + L2 회복 확인

### ★★★★ 방안 D 폐기 (사용자 의견 반영)

F+B 하이브리드는 운영 부담 큼. dev-log 46/47에서 폐기 명시.

### ★★★ 방안 A (v4) — 보강 후 재PoC

prefix 형식을 더 정교하게:
- 권/날짜만이 아니라 권/날짜 + chunk 내 첫 줄 소제목 추출 (정규식)
- 또는 Anthropic Contextual Retrieval처럼 LLM 생성 prefix 시도 (비용 ↑)

### ★★ 방안 B (질문 파싱 + filter) — 방안 E와 사실상 같음

방안 E의 단순화 버전. 통합.

---

## 청킹 기법 추천도 (사용자 자료 참고)

| 청킹 기법 | 추천도 | 종교 도메인 적합도 | 본 프로젝트 상태 |
|---|---|---|---|
| Hierarchical (Parent-Child) | ★★★★★ | 최상 | **미구현 — v5 후속 후보** |
| Contextual Retrieval (Anthropic) | ★★★★★ | 최상 | B (옵션 prefix) = LLM 생성 prefix |
| Hybrid Search (Dense + BM25) | ★★★★★ | 최상 | 적용 중 (RRF) |
| Structure-aware (장/절 단위) | ★★★★ | 상 | 미구현 — 청크 첫 줄 소제목 추출 |
| Paragraph 단락 | ★ | 중하 | **v3/v4 = 이 방식 (단독 약함)** |

→ 사용자 자료에 따르면 **Paragraph 단독은 종교 도메인 적합도 "중하" 1점**. 추천 1순위는 Hierarchical + Contextual Retrieval. v4(paragraph + 약식 contextual)는 그 중간.

**v5 후속 후보 (별도 PoC)**:
- **Hierarchical (Parent-Child)**: 큰 chunk(parent)로 검색 → 작은 chunk(child)로 답변 생성
- **Contextual Retrieval (Anthropic)**: LLM이 청크별로 50~150자 동적 prefix 생성 (비용 ↑)
- **Structure-aware**: 청크 첫 줄에서 장/절 패턴 추출 (`제\d+장`, `\d+\.\s*\w+`) → metadata 강화

---

## 산출물

| 파일 | 내용 |
|---|---|
| `backend/scripts/batch_chunk_paragraph_v4.py` | **신규** — paragraph + metadata prefix injection |
| `backend/scripts/build_phase2_v3v4_report.py` | **신규** — v3 vs v4 통합 보고서 |
| `~/Downloads/notebooklm_qa_v4_metaPrefix_n100_*.xlsx` | v4 측정 raw |
| `~/Downloads/notebooklm_qa_v3_paragraph_n100_*.xlsx` | v3 측정 raw |
| `~/Downloads/ragas_v{3,4}_n100_*.xlsx` | RAGAS |
| `~/Downloads/llm_judge_v{3,4}_n100_*` | LLM-Judge |
| `~/Downloads/codex_compare_v3_v4_n100.md` | Codex 검토 입력 |
| `~/Downloads/codex_review_v3_v4_n100.md` | **Codex 판정 (v3 4승 / v4 4승 / 동등 2)** |
| `~/Downloads/v3_v4_comparison_n100_*.xlsx` | 통합 5시트 |
| `~/Downloads/phase2_v4_PoC_report_*.md` | 결론 보고서 |

---

## 핵심 학습

1. **자동 메트릭 vs Codex 정성 평가 충돌 발생** — 자동 메트릭만으로 운영 결정 위험. 향후 **자동 + 정성 둘 다 우월할 때만 채택** 원칙 권장.
2. **Prefix injection은 양날의 검** — L1/L4에 도움이지만 L3/L5에 noise. 메타데이터를 임베딩 공간에 섞는 것보다 **검색 단계에서 분리 처리**가 더 안전.
3. **데이터 14% 한계는 절대 결론 신뢰도 제한** — 권 커버리지가 늘어날수록 prefix 효과가 다르게 나타날 수 있음.
4. **사용자 자료 기준으로 Paragraph 단독은 종교 도메인 추천도 "★ 중하"** — 현 v3는 long-term 운영 후보가 아님. v5 후속 PoC 필요.
