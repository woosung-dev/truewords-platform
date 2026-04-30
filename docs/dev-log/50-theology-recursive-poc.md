# 50. 신학/원리 5권 한정 A vs F vs Recursive 청킹 PoC

- 일자: 2026-04-30
- 상태: 결정 보류 (PoC 결과 → 운영 채택 보류, 추가 검증 후 재결정)
- 영역: Phase 2.3 — 청킹 기법 비교 마지막 검증
- 선행: dev-log 45/47/48/49 (Phase 2.2 — sentence/prefix/paragraph/meta-prefix 측정 + 적재 통일)

---

## Context

dev-log 47에서 paragraph(F=v3)의 L2(출처 인용) 약점이 발견됐고, dev-log 48에서 v4(meta-prefix injection)는 Codex 정성 검토로 채택 보류됐다. 사용자 자료(청킹 기법 추천도 표)에 의하면 **Recursive 청킹은 일반 RAG ★★★★★ "안전한 default"**로 평가되지만 본 프로젝트에서 직접 측정 없음.

본 PoC는 임베딩 비용 절감을 위해 **신학/원리 5권 한정**으로 A(sentence) vs F(paragraph) vs Recursive 3방식을 비교한다.

**의도하는 결과**: F의 L2 약점을 Recursive가 보완하는지 + 신학 텍스트에 가장 적합한 청킹 식별.

---

## 측정 조건

- **데이터**: 원리강론(1권) + 3대경전(2권, 천성경/평화경) + 통일사상요강(2권) = **5권** (전체 615권 중 0.8%)
- **평가셋**: `통일원리 및 평화사상 단계별 학습 질의서.xlsx` 100문항 (L1~L5 각 20건)
- **3개 신규 컬렉션** (v3 동일 스펙: dense 1536 cosine + sparse):
  - `theology_poc_a` — sentence 청킹 (max_chars=500), 21,016 청크
  - `theology_poc_f` — paragraph 청킹 (min_chars=200, max_chars=3000), 3,627 청크
  - `theology_poc_recursive` — RecursiveCharacterTextSplitter (chunk_size=700, overlap=150, 한국어 종결어미 separators), 10,558 청크
- **측정 순서**: A → F → Recursive (각 batch 사이 cache delete + ensure)
- **'all' 봇 collection_main 토글**: theology_poc_a → theology_poc_f → theology_poc_recursive → malssum_poc_v3 (운영 복원)
- **평가 모델**: gemini-3.1-flash-lite-preview, temperature=0
- **Codex**: OpenAI gpt-5-codex (consult mode, model_reasoning_effort=medium)

### Recursive separators (한국어 종결어미 우선순위)

```python
[
    "\n\n",        # 단락 경계
    "\n",          # 줄바꿈
    "다. ",        # 한국어 평서문 종결
    "니다. ",      # 한국어 격식체 종결
    "까? ",        # 한국어 의문문 종결
    "요. ",        # 한국어 비격식·구어체 종결
    "라. ",        # 한국어 명령·간접 인용 종결
    ". ",          # 일반 마침표
    " ",           # 공백
    "",            # 글자 단위 fallback
]
```

청크 평균 길이: 약 524자 (paragraph 2361자 vs sentence 648자 사이의 중간값).

---

## 결과 — 자동 메트릭 vs Codex 정성 평가 일부 충돌

### 1. RAGAS 4메트릭

| 메트릭 | A | F | Recursive | 최고 |
|---|---:|---:|---:|---|
| faithfulness | 0.931 | **0.967** | 0.952 | F |
| context_precision | 0.868 | 0.756 | **0.877** | **Recursive** |
| context_recall | 0.880 | **0.960** | 0.942 | F |
| response_relevancy | (보고서 자동 생성) | | | |

### 2. LLM-Judge 정성 4메트릭

| 메트릭 | A | F | Recursive | 최고 |
|---|---:|---:|---:|---|
| answer_correctness | 4.57 | **4.76** | 4.72 | F |
| context_relevance | 4.86 | 4.84 | **4.95** | **Recursive** |
| context_faithfulness | 4.53 | **4.69** | 4.62 | F |
| context_recall | 4.60 | 4.80 | **4.81** | **Recursive** |
| **총점 (4~20)** | **18.56** | **19.09** | **19.10** | **Recursive (F와 +0.01 동등)** |
| 키워드 F1 | 0.613 | **0.640** | 0.612 | F |

→ 자동 메트릭: **Recursive와 F 사실상 동률, A 다소 열세**.

### 3. **L별 LLM-Judge 분포 — Recursive가 L2 약점 해결**

| 난이도 | A | F | **Recursive** | 최고 |
|---|---:|---:|---:|---|
| L1 (단순 사실) | 17.75 | **19.35** | 18.40 | F |
| **L2 (출처 인용)** | 18.70 | **17.25** ❌ | **19.40** ✅ | **★ Recursive** |
| L3 (주제 요약) | 18.30 | **19.40** | 19.05 | F |
| L4 (개념 연결) | 18.60 | **19.75** | 19.60 | F |
| L5 (교리 추론) | 19.45 | **19.70** | 19.05 | F |

**가장 중요한 발견**: 이전 dev-log 45/47에서 F의 L2 약점(88권 측정에서도 10.50)이 5권 한정 측정에서도 **17.25로 재현**됐고, **Recursive가 L2에서 19.40으로 가장 우월**. 한국어 종결어미 separators가 출처 제목·날짜·권수 인용 검색에 효과 있음.

### 4. Codex 3-way 독립 검토 (10건 stratified)

| 판정 | 건수 | 사례 |
|---|---:|---|
| **F 승** | **5** | 사례 1, 4, 5, 6, 7 |
| **Recursive 승** | 3 | 사례 3, 9, 10 |
| **A 승** | 2 | 사례 2, 8 |
| 동등 | 0 | — |

**자동 메트릭과 충돌**: 자동은 Recursive ≈ F 동률이지만 Codex는 F 5승. 다만 L별 패턴은 일치:
- F: 개념형(L3)·종합형 강함, **L2 제목형에서 치명적 실패** (사례 3 — 다른 제목 답변)
- Recursive: 제목·출처·추론형 안정적, L2 + L5 균형
- A: 단답형 강함, L3 이상 근거 끊김

### Codex 핵심 메시지

> **기본 운영 옵션은 Recursive(700/150) 권장.**
>
> - A보다 문맥 보존력이 좋고, F보다 검색 정밀도 손실이 작다.
> - L2 제목형과 L5 추론형 모두에서 균형이 좋다.
> - 한국어 종결어미 separator는 신학 텍스트의 논증 단위를 자르는 데 효과가 있다. 문장 단위보다 덜 파편화되고, 단락 단위보다 덜 뭉개진다.
>
> 보강 필요:
> - L2 제목/출처 질문은 별도 인덱스가 필요하다. `title`, `section`, `date`, `event`, `page` 메타데이터를 구조화하지 않으면 chunking만으로 안정화하기 어렵다.
> - F는 개념형 fallback으로 남길 가치가 있다. 다만 단독 기본값으로 쓰면 제목형 검색 실패가 반복될 수 있다.
> - A는 정밀 단답용 보조 retriever로만 적합하다.

---

## 결정 — 운영 즉시 채택 보류, 추가 검증 후 재결정

### 1. 본 PoC는 5권 한정 — 운영 결정 근거로 부족

현재 **88권/615권 (~14%) 적재 상태에서 5권/615권 (~0.8%) 한정 측정**. Codex 권고:

> 18점 이상이 나온 것은 chunking만의 성과로 보기 어렵다. corpus가 5권으로 폐쇄되어 검색 공간이 작다. 평가 질문이 corpus 내부 표현과 강하게 맞물린다. 절대 점수의 corpus quality + 평가셋 친화성 + 닫힌 검색공간 효과가 크다.

→ 절대 점수 18+가 chunking 우열보다는 **폐쇄 corpus의 효과**일 가능성. 88권 전체 적용 시 결과 다를 수 있음.

### 2. 자동 메트릭 vs Codex 충돌 — dev-log 48 학습 그대로 적용

- 자동: Recursive ≈ F 동률
- Codex: F 5승, Recursive 3승

→ **양쪽 모두 같은 방향이어야 운영 채택**. 본 결과는 부분 충돌이라 즉시 채택 안 됨.

### 3. 운영 권장 변화 — Recursive를 신학/원리 봇 후보로 보존

운영 변경 없음:
- `'all'` 봇 `collection_main = malssum_poc_v3` 그대로
- 3개 신규 컬렉션(`theology_poc_a/f/recursive`) 분석용 보존

다만 **88권 전체 Recursive 측정**을 후속 PoC로 진행할 가치 있음 (Recursive가 L2 약점 해결 가능성 + Codex 권고).

### 4. 사용자 자료(청킹 기법 추천도) 확인

| 청킹 | 종교 도메인 적합도 | 본 PoC 결과 | 일치 여부 |
|---|---|---|---|
| Paragraph (F=v3) | ★ 중하 | L2 약점 명확, 다른 L 강함 | 일부 일치 (전체로는 좋지만 L2 약함) |
| Sentence (A=v1) | ★★ | L3+ 약함 | 일치 (단답형만 강함) |
| **Recursive** | ★★★ (일반) | **L별 균형 + L2 강함** | **양호 — 사용자 자료 권고와 일치** |

→ 사용자 자료의 Recursive 권장이 본 측정에서도 부분 검증됨.

---

## 후속 액션 (우선순위)

### ★★★★★ 88권 전체 Recursive 적재 + 측정

5권 한정 결과 신뢰도 부족 → 88권 전체에 Recursive 적용 + 같은 평가셋 + dev-log 47의 새 50문항 + 통일원리 100문항으로 재측정.

- 새 컬렉션 `malssum_poc_v5` (Recursive 700/150)
- 88권 임베딩 비용 ~30~40분 (paid tier)
- 측정 후 v3 vs v5 직접 비교 → 자동 + Codex 둘 다 우월하면 운영 v5 채택

### ★★★★ Codex 권고 — 메타데이터 구조화 (방안 E)

Codex가 강하게 지적: "L2 제목/출처 질문은 별도 인덱스가 필요. title/section/date/event/page 메타데이터를 구조화하지 않으면 chunking만으로 안정화 어려움."

→ dev-log 46의 방안 E (메타데이터 필터/부스팅) 별도 PR 필수.

### ★★★ 5권 한정 corpus의 한계 명시

본 PoC 절대 점수(18+)는 신뢰도 낮음. 88권 전체 측정으로 전환할 때 점수가 15~17 수준으로 떨어질 수 있음을 주의.

### ★★ A는 단답용 보조 retriever만 고려

Codex: "A는 정밀 단답용 보조 retriever로만 적합." 운영 단독 채택 후보 아님.

---

## 산출물

| 파일 | 내용 |
|---|---|
| `backend/src/pipeline/chunker.py` | `chunk_recursive` 함수 추가 |
| `backend/scripts/batch_chunk_theology.py` | **신규** — 5권 한정 + 3방식 적재 |
| `backend/scripts/normalize_eval_xlsx.py` | **신규** — 평가셋 컬럼 표준화 (L 단독 → "L1 (단순 사실 조회)") |
| `~/Downloads/notebooklm_qa_theology_{A,F,Recursive}_n100_*.xlsx` | raw 측정 |
| `~/Downloads/ragas_theology_{A,F,Recursive}_n100_*.xlsx` | RAGAS 결과 |
| `~/Downloads/llm_judge_theology_{A,F,Recursive}_n100_*` | LLM-Judge 결과 |
| `~/Downloads/codex_compare_theology_3way.md` | Codex 검토 입력 |
| `~/Downloads/codex_review_theology_3way.md` | **Codex 판정 (F 5/Recursive 3/A 2/동등 0)** |
| `~/Downloads/theology_3way_comparison_n100_*.xlsx` | 통합 5시트 |
| `~/Downloads/phase2_theology_3way_report_*.md` | 결론 보고서 |

신규 신학/원리 5권 Qdrant 컬렉션 (분석용 보존):
- `theology_poc_a` (21,016 청크)
- `theology_poc_f` (3,627 청크)
- `theology_poc_recursive` (10,558 청크)

---

## 핵심 학습

1. **Recursive(700/150)는 L2 출처형 질문에서 가장 안정적** — 한국어 종결어미 separators가 paragraph 단위 검색 누락을 막아주는 효과 확인.
2. **Paragraph(F)의 L2 약점은 corpus 크기와 무관** — 88권에서도, 5권에서도 동일하게 재현. 청킹 알고리즘 자체의 본질적 한계.
3. **5권 한정 PoC는 절대 점수 신뢰도 낮음** — 폐쇄 corpus 효과 + 평가셋 친화성으로 18+ 점수가 인위적으로 부풀려짐. chunking 우열은 상대 비교(L별)로만 신뢰 가능.
4. **Codex가 자동 메트릭이 놓치는 패턴 잡아냄** — 사례 3 같은 "F의 L2 치명적 오답"이 자동 평균에서는 +0.5 정도로 희석되지만 정성 평가에서는 명확.
5. **메타데이터 구조화는 chunking으로 대체 불가** — 출처/제목/권수 인용은 별도 인덱스 + filter/boost 필수. dev-log 46 방안 E를 우선순위 최상으로 유지.

---

## 비용

- 임베딩: 5권 × 3방식 = 15권어치 (~37분, paid tier ~₩300-500원)
- LLM-as-Judge: 100문항 × 3방식 × 2평가 = gemini-3.1-flash-lite-preview 600회
- Codex consult 1회 (gpt-5-codex)

---

## 측정 시간 라인

| 단계 | 시작 | 소요 |
|---|---|---:|
| F 적재 | 13:18 | 7분 |
| Recursive 적재 | 13:25 | 9.5분 |
| A 적재 | 13:35 | 20분 |
| A 측정 | 13:55 | 22분 |
| F 측정 | 14:18 | 19분 |
| Recursive 측정 | 14:38 | 19분 |
| 평가 + Codex + 보고서 | 14:57 | 15분 |
| **합계** | | **~112분 (1h 52min)** |
