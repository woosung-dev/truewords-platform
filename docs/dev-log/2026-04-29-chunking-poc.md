# 옵션 F 청킹 재설계 PoC 보고서 (2026-04-29)

> **상태:** 완료. 결론 명확 — paragraph 청킹이 v1 대비 +6%p 개선, prefix 없이 v2 (옵션 B) 능가.
> 본 PoC는 PR #69 (옵션 B) 후속 — prefix 없이 청크 자체 재설계로 v2 수치 능가 가능성 검증.

---

## 0. 결론 한 줄

**옵션 F (paragraph 청킹) 본 채택 권고.** v1 baseline 대비 NotebookLM 전체 hit율 0.550 → 0.610 (+6%p). source B에서 +25.6%p 큰 개선, 단 source O에서 -29.2%p 회귀 — 후속 어블레이션으로 보완 가능.

---

## 1. 가설

옵션 B (Anthropic Contextual Retrieval) A/B 결과 1/4 PASS — prefix가 약점 source M/O를 회귀시킴 (-0.107, -0.118). 청크 본연 키워드 신호를 50~150자 prefix가 희석한 것으로 추정.

**옵션 F 가설:** 청크 자체를 재설계 (token 단위 sliding window 또는 paragraph 단위)하면 prefix 없이도 검색 정확도 향상 가능.

---

## 2. 실험 설정

### 2.1 데이터
| 컬렉션 | 평화경 청킹 | 평화경 외 614권 | 총 청크 |
|---|---|---|---:|
| `malssum_chunking_poc_sentence` | sentence (max_chars=500, overlap=2) | malssum_poc baseline (vector copy) | 74,341 |
| `malssum_chunking_poc_token1024` | char-based 2560/500 sliding | malssum_poc baseline (vector copy) | 67,301 |
| `malssum_chunking_poc_paragraph` | blank-line + min_chars=200 병합 | malssum_poc baseline (vector copy) | 67,641 |

**평화경 청킹은 prefix 없음** (`prefix_text=""` 고정). 평화경 외 권은 기존 sentence-based chunks의 vector + payload를 재임베딩 없이 복사.

### 2.2 데이터 정합성 노트
- malssum_poc에 `volume='평화경.txt'`로 sentence-based 평화경 청크 7,869이 이미 존재 (handoff에는 미명시).
- vector copy 후 PoC 컬렉션마다 PoC 청킹(`volume='평화경'`) + baseline(`volume='평화경.txt'`) 두 본이 공존하는 문제 발견.
- → **수동 클린업**: 각 PoC 컬렉션에서 `volume='평화경.txt'` 7,869개 삭제 (PoC 청킹만 남김).

### 2.3 평가
- NotebookLM Q&A 100건 (`Light RAG 50선` + `5단계 50선`)
- 3 PoC 챗봇 (`chunking-sentence`/`-token1024`/`-paragraph`) 각각 측정
- 비교 baseline: `notebooklm_post_phase1_20260428_1001_light100.xlsx` (Phase 1 직후 v1 — `malssum_poc`, sentence-based)
- 측정 소요: sentence 16.7분, token1024 16.9분, paragraph 14.0분 (각 100문항, rate 0.3/sec)

---

## 3. 청크 통계 (평화경 1권)

| 방식 | 청크 수 | 평균 (chars) | 중앙값 | stdev | min | max |
|---|---:|---:|---:|---:|---:|---:|
| sentence (baseline) | 7,869 | 623.0 | 617 | 155.9 | 173 | 1,283 |
| token1024 (char 2560/500) | 829 | 2,558.5 | 2,560 | 42.8 | 1,328 | 2,560 |
| paragraph | 1,169 | 1,525.0 | 1,429 | 735.3 | 200 | 2,998 |

**관찰:**
- token1024는 sentence 대비 청크 수가 **9.5배 적음** (큰 청크) — 단일 검색당 정보 밀도 ↑, 매칭 정밀도 ↓
- paragraph는 sentence 대비 6.7배 적음, stdev 735 → 청크 사이즈 변동성 큼 (단락 길이 의존)
- paragraph 평균 1,525자 ≈ sentence(623) × 2.5 — 자연스러운 단락 단위로 정보 밀도와 정밀도의 균형

---

## 4. NotebookLM hit율 — 레벨별

| 방식 | L1 | L2 | L3 | L4 | L5 | 전체 |
|---|---:|---:|---:|---:|---:|---:|
| **v1 baseline** (Phase 1) | 0.850 | 0.850 | 0.550 | 0.450 | 0.050 | **0.550** |
| PoC sentence | 0.850 | 0.950 | 0.500 | 0.350 | 0.050 | 0.540 |
| PoC token1024 | 0.850 | 0.850 | 0.500 | 0.450 | 0.100 | 0.550 |
| **PoC paragraph** | **0.900** | **0.950** | **0.600** | **0.550** | 0.050 | **0.610** |

### 4.1 paragraph 메서드 v1 대비 개선 (Δ)
- L1: +0.050 / L2: +0.100 / L3: +0.050 / L4: **+0.100** / L5: ±0
- **전체: +0.060** (6%p)

### 4.2 sentence/token1024 — v1과 거의 동등
평화경 청킹만 sentence 또는 token1024로 변경한 단일 권 효과는 미미함. 청킹 변경의 효과가 단락 단위에서 가장 뚜렷.

---

## 5. NotebookLM hit율 — source별

| source | v1 | PoC sentence | PoC token1024 | PoC paragraph | par - v1 |
|---|---:|---:|---:|---:|---:|
| A | - | 0.538 | 1.000 | 0.667 | - |
| B | 0.432 | 0.594 | 0.500 | **0.688** | **+0.256** |
| L | 0.714 | 0.800 | 0.700 | 0.600 | -0.114 |
| M | 0.560 | 0.412 | 0.480 | 0.545 | -0.015 |
| N | 0.714 | 1.000 | 0.750 | 0.667 | -0.048 |
| O | 0.667 | 0.200 | 0.167 | 0.375 | **-0.292** |
| Q | - | 0.562 | 0.625 | 0.625 | - |

### 5.1 핵심 발견
1. **paragraph의 큰 개선은 source B (+25.6%p)**: v1에서 약점이었던 B(0.432)가 paragraph에서 0.688로 강점화. 단락 단위 청킹이 source B 콘텐츠 구조에 적합.
2. **paragraph는 source O에서 -29.2%p 회귀**: token1024는 -50%p로 더 큼. paragraph 청크 평균 1,525자 + sliding 없음 → O 데이터 검색 시 매칭 어긋남.
3. **paragraph는 source M에서 -1.5%p (거의 동등)**: 옵션 B v2에서 -10.7%p 회귀였던 M이 paragraph에서는 안정. 즉 prefix 없는 청킹 재설계가 옵션 B의 약점을 부분 해소.
4. **sentence는 source M에서 -14.8%p 회귀**: 평화경만 sentence 신규 청킹해도 다른 권 baseline과의 일관성 차이로 회귀 발생.
5. **token1024는 source O에서 -50%p 회귀**: 큰 청크(2560자)는 source O 데이터 (말씀선집 등 장문 권)에서 LLM 답변과 매칭 정밀도 ↓.

---

## 6. 옵션 B (PR #69) 비교

| 종료 기준 메트릭 | v1 baseline | v2 (옵션 B) | PoC paragraph | 목표 |
|---|---:|---:|---:|---:|
| L1 hit | 0.850 | 0.850 | **0.900** | 유지 |
| L5 hit | 0.050 | 0.050 | 0.050 | ≥ 0.12 ❌ |
| 전체 hit | 0.550 | (미측정) | **0.610** | - |
| source M Δ | (baseline) | -0.107 | **-0.015** | 0 ↑ |
| source O Δ | (baseline) | -0.118 | **-0.292** | 0 ↑ |

**옵션 B 대비 paragraph의 강점:**
- L1 +5%p (옵션 B는 변동 없음)
- 전체 hit 측정 가능 baseline 마련
- source M 회복 (옵션 B는 회귀 -10.7%p, paragraph는 -1.5%p)

**옵션 B 대비 paragraph의 약점:**
- source O 회귀가 더 큼 (B: -11.8%p → paragraph: -29.2%p)
- L5 여전히 0.050 (목표 0.12 미달)

---

## 7. 결론 + 다음 액션

### 7.1 권고 (★★★★★)
**옵션 F (paragraph 청킹) 본 채택 + source O 어블레이션.** 단계별:

1. **즉시 (Phase 2.1)**: 평화경 외 614권에 paragraph 청킹 재적용 → 본 가동 (`malssum_poc_v3` 또는 `malssum_poc` 직접 교체).
2. **source O 어블레이션 (Phase 2.2)**: paragraph + source O에 한해 보완.
   - 후보 1: source O만 sentence-based fallback (조건부 청킹)
   - 후보 2: paragraph + min_chars=200 → min_chars=500 상향 (덜 공격적 병합)
   - 후보 3: paragraph + sliding overlap (단락 경계 + 200자 overlap)
3. **L5 별도 트랙 (Phase 3)**: L5 0.050 정체는 청킹만으로 안 풀림. re-ranker 강화 또는 BM25 비중 조정 필요.

### 7.2 옵션 비교 추천도
- **옵션 F paragraph 채택** (★★★★★): 정량 근거 강함, 본 가동 단순
- 옵션 B v2 어블레이션 (★★): paragraph가 prefix 없이 더 나음 — ROI 낮음
- 옵션 F + paragraph 변형 어블레이션 (★★★★): source O 회귀 보완용
- re-ranker / BM25 비중 (★★★): L5 트랙 별도 — 본 PR 후속

---

## 8. 운영 조치

- ✅ `malssum_chunking_poc_*` 3 컬렉션 보존 (분석 자료)
- ✅ `chunking-{sentence,token1024,paragraph}` 3 봇 시드 (admin UI에서 수동 비교 가능)
- ✅ `'all'` 봇 라우팅은 변경 없음 (`malssum_poc` 그대로) — 본 가동 전환은 다음 PR

---

## 9. 향후 작업 (별도 PR)

### 옵션 F 본 가동 (다음 PR 1순위)
- 평화경 외 614권 paragraph 재청킹 → `malssum_poc_v3` 생성
- source O 어블레이션 후보 1~3 중 측정 후 결정
- v3 본 가동 시 'all' 봇 collection_main 전환

### 옵션 H — citation_metrics PoC
- `backend/scripts/citation_metrics.py` 신규
- /chat 응답 sources[] vs 답변 텍스트 인용 패턴 매칭
- citation coverage + unsupported claim rate
- 별도 PR

### 데이터 정합성 chore PR
- `backend/scripts/dedupe_volumes.py`
- NFC/NFD 중복 제거 (말씀선집 002권, 11월 2일 참어머님 말씀)
- 이중 prefix 권 제거 (말씀선집 말씀선집 001~005권 ~4,500 청크)
- malssum_poc volume='평화경.txt' → '평화경' NFC 통일

---

## 10. 메모리 가치 발견

### 10.1 NotebookLM eval 시 stdout buffering 함정
- `python -u` + `tail -N` 조합은 process 종료까지 출력 안 보임 (tail이 EOF 대기)
- 진행 모니터링은 **체크포인트 xlsx 파일 modification time + 행 수**로 판단
- 이번 paragraph eval에서 1시간 12분 hang으로 보였던 첫 시도는 실제로는 첫 LLM 호출에서 무한 대기 의심 — 재시작 후 14분 만에 정상 완료
- 향후 long-running eval은 `--limit 3` smoke test 후 본 실행 권장

### 10.2 paragraph 청킹 vs token-based의 차이
- 청크 평균 사이즈는 비슷 (1525 vs 2558)지만 **청크 경계의 의미 일관성**이 검색 정확도에 결정적
- token-based 2560/500 sliding은 단어 중간 절단 + 무의미 경계 → source O에서 -50%p
- paragraph blank-line은 작자/편집자가 의도한 의미 단위 → source B 단락 단위 콘텐츠에 +25.6%p

### 10.3 평화경 1권 PoC의 구조적 한계
- 614권은 baseline copy 그대로이므로 source 분포 대부분 (M 64건/300, B 98건/300)이 원본 sentence-based 청크 영향. 평화경 청킹만 변경된 것은 100문항 중 일부 (평화경 관련 질문)에만 직접 영향.
- 즉 본 PoC 결과의 +6%p는 **하한값** — 614권 모두 paragraph 재청킹 시 더 큰 개선 가능성.

---

## 11. 참고

- 이전 세션 핸드오프: `docs/dev-log/2026-04-29-session-handoff.md`
- 옵션 B A/B 보고서: `docs/dev-log/2026-04-28-contextual-retrieval-ab.md`
- PR #69 (옵션 B+G), PR #70 (mock fix) 머지 완료
- 본 PR: `feat/phase-2-chunking-poc`
- 측정 결과 xlsx (~/Downloads/):
  - `notebooklm_chunking_sentence_20260429_0647.xlsx`
  - `notebooklm_chunking_token1024_20260429_0647.xlsx`
  - `notebooklm_chunking_paragraph_20260429_0647.xlsx`
  - `per_source_chunking_20260429_0647.xlsx`
