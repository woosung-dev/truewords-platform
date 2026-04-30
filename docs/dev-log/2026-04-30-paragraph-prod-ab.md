# 옵션 F (paragraph) 본 가동 A/B 보고서 (2026-04-30)

> **결과: 통과 미달 → v3 폐기 권고, v1(sentence) 유지.**
> PR #74 (옵션 F PoC) 후속 — 88권 paragraph 재청킹 본 가동 검증.

---

## 0. 결론 한 줄

**옵션 F 본 가동 폐기 권고**. NotebookLM 100문항 A/B 결과 v3가 v1 대비 전체 hit -2%p 회귀 (0.550→0.530), 통과 기준(전체 ≥ 0.580 AND L1 ≥ 0.870) 모두 미달. v3 컬렉션 보존 + 'all' 봇 v1 유지. 옵션 B 폐기와 동일 패턴.

---

## 1. 가설 (PoC와 동일)

PR #74 PoC 결과: 평화경 1권만 paragraph + 614권 baseline copy → 전체 +6%p (0.550→0.610). 본 가동 시 88권 모두 paragraph로 변경하면 효과 더 클 것으로 예상.

---

## 2. 실험 설정

### 2.1 데이터
- **v1 baseline**: `malssum_poc` 88권 sentence 청킹 (68,617 청크)
  - 8권 사전 삭제 (이중 prefix 5건 + NFC/NFD 1건 + 002·149 매칭 보강 미적용 2건)
- **v3 treatment**: `malssum_poc_v3` 88권 paragraph 청킹 (22,419 청크, v1 대비 32.7%)
- raw 폴더: `/Users/woosung/Downloads/말씀(포너즈)` (88권 매칭)

### 2.2 청킹 통계 (v3)
- 총 청크 22,419 (v1 68,617의 32.7%)
- paragraph 평균 청크 사이즈 ≈ 1500자 (sentence 600자 대비 2.5배)
- 적재 소요: 28.8분 (paid tier, 429 재시도 2회)

### 2.3 평가
- NotebookLM Q&A 100문항 (`Light RAG 50` + `5단계 50`)
- 'all' 봇 (v1) vs 'all-paragraph' 봇 (v3) 각 100문항
- 측정 시간: all 22분, all-paragraph 19분, 총 41분

---

## 3. NotebookLM hit율 — 레벨별

| 방식 | L1 | L2 | L3 | L4 | L5 | 전체 |
|---|---:|---:|---:|---:|---:|---:|
| **v1 (all, sentence)** | 0.800 | 0.950 | 0.600 | 0.350 | 0.050 | **0.550** |
| **v3 (all-paragraph)** | 0.800 | 0.850 | 0.550 | 0.350 | 0.100 | **0.530** |
| Δ (v3 - v1) | 0 | **-0.100** | **-0.050** | 0 | +0.050 | **-0.020** |

**해석:**
- L2 (출처 인용) **-10%p 큰 회귀** — paragraph 큰 청크가 출처 매칭 정밀도 ↓
- L3 (주제 요약) -5%p 회귀
- L1, L4 동등 — 영향 없음
- L5 +5%p 개선 — 큰 청크가 추론 컨텍스트 제공에 유리

---

## 4. NotebookLM hit율 — source별

| source | v1 | v3 | Δ |
|---|---:|---:|---:|
| B (어머니말씀) | 0.529 | 0.500 | -0.029 |
| L (원리강론) | 0.593 | 0.636 | +0.044 |
| **M (3대 경전)** | **0.640** | **0.533** | **-0.107** |
| N (자서전) | 0.455 | 1.000 | **+0.545** |
| **O (말씀선집)** | 0.000 | 0.143 | **+0.143** |
| Q (통일사상요강) | - | 0.700 | - |

### 4.1 핵심 발견
1. **source M -10.7%p** (3대 경전, 천성경) — PoC에서도 -10.7%p 회귀였던 옵션 B와 동일 수준의 회귀
2. **source N +54.5%p** (자서전) — paragraph가 자서전 narrative 구조에 매우 적합
3. **source O +14.3%p** (말씀선집) — PoC에서 -29.2% 회귀였던 결과와 **정반대**
4. **source B -2.9%p, L +4.4%p** — 미미

---

## 5. PoC vs 본 가동 — 정반대 결과

| 메트릭 | PoC (평화경 1권만 paragraph) | 본 가동 (88권 모두 paragraph) |
|---|---:|---:|
| 전체 hit | 0.550 → **0.610** (+6%p) | 0.550 → **0.530** (-2%p) |
| L1 | 0.850 → 0.900 (+5%p) | 0.800 → 0.800 (0) |
| L2 | 0.850 → 0.950 (+10%p) | 0.950 → 0.850 (-10%p) |
| source M | -1.5%p | -10.7%p |
| source O | -29.2%p | +14.3%p |
| 결론 | paragraph 채택 | **paragraph 폐기** |

### 5.1 가설 (왜 정반대?)
PoC의 +6%p는 사실 **"평화경 1권만 paragraph + 614권 sentence baseline"** 조합 효과:
- 검색 결과의 대부분 청크는 sentence (정밀)
- 평화경 관련 질문에서만 paragraph 청크 hit (단락 단위로 풍부한 컨텍스트)
- → "두 청킹 방식의 시너지"가 효과의 정체

본 가동에서 88권 모두 paragraph로 통일 시:
- 모든 검색 결과가 큰 paragraph 청크
- L2 (출처 인용) 같은 단문 매칭은 sentence가 우월
- 일부 source(M, B)는 paragraph 분할이 의미 단위로 떨어지지 않음 → 회귀

### 5.2 의미
- **단일 청킹 전략은 데이터 다양성을 흡수 못 함** (Adaptive Chunking 학술 근거와 일치)
- source별로 적합한 청킹이 다름 (N=paragraph 강세, M=sentence 강세)
- 본 가동 회귀는 paragraph 전체 적용의 결함이 아니라 **하이브리드 청킹의 부재**

---

## 6. 통과 기준 평가

| 기준 | 목표 | 실측 | PASS |
|---|---|---|:---:|
| 전체 hit | ≥ 0.580 | 0.530 | ❌ |
| L1 hit | ≥ 0.870 | 0.800 | ❌ |

**둘 다 미달** → v3 폐기.

---

## 7. 결론 + 다음 액션

### 7.1 즉시 조치 (★★★★★)
- ✅ 'all' 봇 v1(`malssum_poc`) 유지 — 라우팅 변경 없음
- ✅ `malssum_poc_v3` 컬렉션 **보존** (분석 자료로 활용)
- ✅ `all-paragraph` 봇 **보존** (admin UI에서 비교용)
- ✅ 8권 삭제는 v1에 영향 — 하지만 사용자 동의 + 정합성 개선이라 유지

### 7.2 다음 트랙 (별도 PR)

**옵션 F 단일 청킹은 폐기. 검색 정확도 향상 다른 방향:**

1. **하이브리드 청킹 (★★★)**: source별 적응 (N/O는 paragraph, M/B는 sentence). Adaptive Chunking 학술 근거. 단 운영 복잡도 ↑
2. **Re-ranker 강화 (★★★★)**: 현재 Cross-encoder 또는 Gemini reranker 강화 — 청킹 영역 외에서 정확도 ↑
3. **BM25 sparse 비중 조정 (★★★)**: 현재 RRF 50:50 → 70:30 등 — L2 출처 매칭 개선 가능
4. **임베더 교체 (★★)**: Gemini → BGE-M3 / Solar Embedding — 한국어 종교 도메인 fine-tune 가능성

### 7.3 옵션 B + 옵션 F 모두 폐기 시사점
- Phase 2 청킹/임베딩 영역에서 단일 변경으로는 본 가동 향상 어려움
- **검색 파이프라인 다른 단계 (re-ranker, hybrid weight)에서 개선 시도가 정공**
- L5 (고난이도 추론) 0.050 정체는 청킹/임베딩만으로 안 풀림 — generation 단계 또는 LLM 모델 변경 필요

---

## 8. 운영 영향

### 8.1 'all' 봇 운영
- 청크 수: 74,341 → 68,617 (8권 삭제, 7.7% 감소)
- 영향:
  - 이중 prefix 5건 (001~004): 단일 prefix 동일 내용 보존 → 검색 결과 영향 거의 없음
  - 005권: 단일 prefix 881 vs 이중 prefix 600 차이 → 약간 손실 가능
  - NFC/NFD 중복 1건: 다른 형태 보존 → 영향 없음
  - 002, 149: raw 보유 권 매칭 보강 안 함 → **검색 결과 영향 가능** (chore PR로 복원 가능)

### 8.2 후속 chore PR 필요
- `말씀선집 002권.pdf` raw 매칭 보강 후 paragraph or sentence 재적재
- `149(이성욱).pdf` 동일
- NFC/NFD 정책 통일

---

## 9. 적재 통계

| 컬렉션 | 청크 수 | 권 수 | 청킹 |
|---|---:|---:|---|
| malssum_poc (v1, 운영) | 68,617 | 88 | sentence (max 500자) |
| malssum_poc_v3 (보존) | 22,419 | 88 | paragraph (blank-line + min 200자) |
| 평화경.txt | (sentence + paragraph 둘 다 보유) | 1 | 양쪽 |

---

## 10. 메모리 가치 발견

### 10.1 PoC ≠ 본 가동
**PoC 결과를 본 가동 효과로 일반화 위험.** 청킹 변경 sample이 1권일 때와 88권일 때 효과 정반대 가능. 향후 PoC 설계 시:
- "sample 권 + baseline copy"의 시너지 효과를 명시적으로 분리 측정
- PoC 결과는 **부분 적용의 효과**로 한정 해석

### 10.2 단일 청킹 전략의 한계
Adaptive Chunking 학술 근거 확인. source 분포 다양한 corpus에서 단일 전략은 trade-off 필연. 하이브리드(source별 분기) 또는 다단계(parent-child) 검토.

### 10.3 통과 기준의 가치
PoC 결과(+6%p)에 흥분해 통과 기준을 낙관적으로 설정 (≥0.580 AND L1≥0.870)했으나, 본 가동이 미달한 결과는 통과 기준이 옳았다는 증거. **보수적 기준이 폐기 결정의 신뢰도를 높임.**

---

## 11. 참고

- 이전 PoC 보고서: `docs/dev-log/2026-04-29-chunking-poc.md`
- 옵션 B A/B 보고서: `docs/dev-log/2026-04-28-contextual-retrieval-ab.md`
- 핸드오프: `docs/dev-log/2026-04-29-session-handoff.md`
- PR #74 (옵션 F PoC) 머지 완료
- 본 PR: `feat/phase-2-paragraph-ab`
- 측정 결과 xlsx (~/Downloads/):
  - `notebooklm_prod_ab_all_20260429_1501.xlsx`
  - `notebooklm_prod_ab_all-paragraph_20260429_1501.xlsx`
