# 51. v5 (Recursive 700/150) 88권 적재 + 운영 채택 결정

- 일자: 2026-04-30
- 상태: 결정 완료 (운영 v3 → v5 전환)
- 영역: Phase 2.4 — 청킹 운영 최종 결정
- 선행: dev-log 45/47/48/49/50 (Phase 2.2~2.3 청킹 PoC)

---

## Context

dev-log 50에서 신학/원리 5권 한정 PoC로 A/F/Recursive 비교했으나 **5권 한정 절대 점수의 신뢰도 부족** + **자동 vs Codex 일부 충돌**로 운영 채택 보류했다.

사용자가 "데이터 더 넣고 검증" 요청 → **88권 전체에 Recursive 적재 + Light RAG 100선 평가셋으로 v3 vs v5 직접 비교**.

또 사용자가 "측정 순서 효과 우려" 제기 → **순서 반전(v5 → v3) 재측정으로 검증**.

---

## 측정 조건

### 컬렉션
- `malssum_poc_v3` (paragraph, 22,419 청크) — 운영 중
- **`malssum_poc_v5` (Recursive 700/150 + 한국어 종결어미 separator, 45,233 청크) — 신규**
  - 5권(theology_poc_recursive 10,558) vector 복사 + 83권(34,675) 신규 임베딩
  - 임베딩 비용 ~$0.20 ≈ ₩273원
  - 적재 시간 ~33.5분

### 평가셋
- `Light RAG전 성능 평가용 5단계 테스트 데이터셋 기존전략에서 업그레이드 유무를 위한.xlsx`
- 100문항, ID 201~300, L1~L5 각 20건 균등
- 표준 6컬럼 형식 (변환 불필요)

### 측정 절차
1. **라운드 1**: v3 → v5 (cache 격리, 각 22분)
2. **라운드 2 (순서 반전)**: v5 → v3 (cache 격리, 각 22분)
3. 평가: RAGAS + LLM-Judge × 4 + Codex 정성 (라운드 1만)

### 비용/시간 합계
- 임베딩: ~₩273원
- 측정: 100문항 × 4회 = ~88분
- 평가: ~5분
- 합계: 약 2시간, ₩300원

---

## 결과

### 자동 메트릭 (1차 + 2차 평균)

| 평가 | v3 평균 | **v5 평균** | 차이 (v5-v3) |
|---|---:|---:|---:|
| RAGAS faithfulness | 0.839 | **0.880** | +0.041 |
| RAGAS context_precision | 0.678 | **0.812** | **+0.134** |
| RAGAS context_recall | 0.767 | **0.834** | +0.067 |
| **LLM-Judge 총점** | **16.88** | **18.03** | **+1.15** |
| 키워드 F1 | 0.389 | **0.437** | +0.048 |

### L별 LLM-Judge 분포 (1차+2차 평균)

| 난이도 | v3 | **v5** | 차이 |
|---|---:|---:|---:|
| L1 (단순 사실) | 15.25 | **17.40** | **+2.15** |
| L2 (출처 인용) | 15.23 | **17.08** | **+1.85** |
| L3 (주제 요약) | 17.38 | **18.60** | +1.22 |
| L4 (개념 연결) | 18.03 | **18.48** | +0.45 |
| L5 (교리 추론) | 18.53 | 18.58 | +0.05 |

→ **v5가 모든 L에서 우월**. 특히 L1, L2에서 가장 큰 격차.
→ paragraph(v3)의 L1/L2 약점이 Recursive(v5)에서 명확히 해소됨.

### 측정 순서 효과 검증

| 옵션 | 후행 측정 → 선행 측정 변화 |
|---|---:|
| v3 (1차 후행, 2차 선행) | LLM-Judge +0.20 |
| v5 (1차 후행, 2차 선행) | LLM-Judge -0.41 |

→ 후행 측정이 약간 더 좋은 경향 있으나 격차 작음(0.2~0.4점).
**v5 우월 격차(+1.15)가 순서 효과(0.4)의 3배 이상** → 순서 효과 보정 후에도 v5 우월 결론 유지.

### Codex 정성 평가 (10건 stratified, 라운드 1)

| 판정 | 건수 |
|---|---:|
| **v5 승** | **6** |
| v3 승 | 3 |
| 동등 | 1 |

Codex 핵심 권고:
> **v5 채택 권고. 88권 corpus에서는 paragraph 2300자 청크가 너무 크다. 검색이 맞는 문서로 가도 정답 문장이 묻히고 모델이 일반론으로 답한다. v5는 작은 청크로 정답 문장에 직접 접근.**
>
> **5권 PoC와 결론 다른 이유**: 5권은 corpus 작아 큰 청크도 대체로 관련 문맥 포함 → v3가 신학적 맥락 보존 장점 살아남. 88권에서는 검색 후보 폭증 + 같은 키워드 여러 권 반복 → 큰 청크의 약점 명확. 작은 청크는 질문-정답 문장 매칭에서 유리.

### dev-log 48 채택 기준 (자동 + Codex 둘 다 우월) **통과 ✅**

이전 v4(meta-prefix injection) PoC에서는 자동만 우월하고 Codex 동률이라 보류했지만:
- **v5는 자동(5/5 메트릭) + Codex(6승) + 측정 순서 반전 검증 + L별 모든 난이도 우월**으로 4중 검증 일치

---

## 결정

### 운영 v3 → v5 전환

`'all'` 봇 `collection_main`: `malssum_poc_v3` → **`malssum_poc_v5`** 영구 변경.

또한 적재 파이프라인도 v5로 통일 (dev-log 49의 v3 통일을 v5로 갱신):
- `settings.collection_name`: `malssum_poc_v3` → `malssum_poc_v5`
- `data_router.py` 청킹: `chunk_paragraph` → `chunk_recursive`
- `.env` / `.env.production.local` / `deploy.yml` env COLLECTION_NAME 갱신

### 보존 컬렉션
- `malssum_poc_v3` (paragraph 88권) 보존 — 비교 분석용
- `malssum_poc` (sentence 88권) 보존
- `malssum_poc_v2` (prefix 88권) 보존
- `malssum_poc_v4` (paragraph + meta-prefix 88권) 보존
- 5권 한정 컬렉션 3개 보존

### 14% 적재 한계는 여전히 존재

현재 88권/615권 (~14%) 적재. v5도 이 한계 안에서의 결정.
다음 데이터 적재 마일스톤(50%/75%/100%)에서 v5 vs v3 재측정 권장.

---

## 후속 액션

### ★★★★★ 적재 파이프라인 v5 통일 (즉시)
`docs/dev-log/49`의 v3 통일을 v5로 갱신 — 새 데이터 업로드 시 Recursive 청킹으로 `malssum_poc_v5`에 적재.

### ★★★★ Codex 권고 — 메타데이터 구조화 (별도 PR)
Codex가 강하게 권고: "v5도 보강 필요 — synthesis prompt 강화, 명칭 직답 우선, 호칭 나열 시 원문/추론 구분."
dev-log 46 방안 E (메타데이터 필터/부스팅) 별도 PR로 진행.

### ★★★ 데이터 적재 마일스톤별 재측정 schedule
50%/75%/100% 적재 시점에 v3 vs v5 재측정.

---

## 산출물

| 파일 | 내용 |
|---|---|
| `~/Downloads/notebooklm_qa_v3_n100_LightRAG_*.xlsx` | v3 1차 측정 |
| `~/Downloads/notebooklm_qa_v5_n100_LightRAG_*.xlsx` | v5 1차 측정 |
| `~/Downloads/notebooklm_qa_v5_n100_LR_round2_*.xlsx` | v5 2차 측정 (순서 반전) |
| `~/Downloads/notebooklm_qa_v3_n100_LR_round2_*.xlsx` | v3 2차 측정 |
| `~/Downloads/ragas_v{3,5}_n100_LR{,_r2}_*.xlsx` | RAGAS 4건 |
| `~/Downloads/llm_judge_v{3,5}_n100_LR{,_r2}_*` | LLM-Judge 4건 |
| `~/Downloads/codex_compare_v3_v5_LR.md` | Codex 검토 입력 |
| `~/Downloads/codex_review_v3_v5_LR.md` | **Codex 판정 (v5 6승 / v3 3승 / 동등 1)** |
| `~/Downloads/v3_v5_comparison_n100_LR_*.xlsx` | 통합 5시트 |
| `~/Downloads/phase2_v5_PoC_report_*.md` | 라운드 1 결론 보고서 |

---

## 핵심 학습

1. **5권 한정 PoC는 청킹 비교에 부적합** — corpus 작으면 큰 청크의 약점이 안 드러남. 88권 전체 측정 필수.
2. **측정 순서 효과는 작음 (0.2~0.4점)** — v5 우월 격차 1.15점의 1/3 수준 → 결론 영향 X.
3. **Recursive(700/150)는 88권 corpus에서 paragraph보다 명확히 우월** — 자동 + Codex + 순서 반전 + L별 분포 모두 일치.
4. **Codex 권고대로 "작은 청크 + 정답 문장 직접 매칭"이 88권 운영의 핵심** — paragraph 2300자는 너무 큼.
5. **L1/L2 약점 해결은 chunking으로 가능** — 메타데이터 구조화 없이도 Recursive로 +2점 향상.

---

## 비용 / 시간 라인

| 단계 | 시간 |
|---|---:|
| v5 컬렉션 생성 + 5권 vector 복사 | 1분 |
| 83권 Recursive 적재 (paid tier) | 33.5분 |
| v3 라운드 1 측정 | 21분 |
| v5 라운드 1 측정 | 19분 |
| v5 라운드 2 측정 (순서 반전) | 20분 |
| v3 라운드 2 측정 | 21분 |
| 평가 4건 (RAGAS + LLM-Judge) | 4분 |
| Codex 정성 (라운드 1) | ~6분 |
| **합계** | **약 125분 (2시간)** |

비용:
- 임베딩 (paid tier): ~$0.20 ≈ ₩273원
- LLM-Judge / RAGAS (gemini-3.1-flash-lite-preview): 800회 호출 (포함됨)
- Codex consult 1회 (gpt-5-codex)
