# 46. Paragraph 청킹 L2(출처 인용) 약점 보강 plan

- 일자: 2026-04-30
- 상태: Plan (실행 보류, 후속 작업 후보)
- 영역: Phase 2.2 후속 — paragraph 청킹 retrieval 약점 개선
- 선행 결정: dev-log 45 (옵션 F 운영 전환)

---

## Context

dev-log 45에서 옵션 F(paragraph, malssum_poc_v3) 운영 전환을 결정했지만,
LLM-Judge 50문항 측정에서 **L2(출처 인용)만 A보다 -0.60 약점**이 드러났다:

| 난이도 | A 총점 | F 총점 | 차이 |
|---|---:|---:|---:|
| L1 (단순 사실 조회) | 13.30 | 14.20 | +0.90 (F) |
| **L2 (출처 인용)** | **11.10** | **10.50** | **-0.60 (A)** ❌ |
| L3 (주제 요약) | 15.30 | 16.20 | +0.90 (F) |
| L4 (개념 연결) | 17.30 | 18.30 | +1.00 (F) |
| L5 (교리 추론) | 18.10 | 19.40 | +1.30 (F) |

L2 질문 예시:
- "말씀선집 56권에서 1975년 120개국에 선교사를 보낸 섭리적 배경은…"
- "말씀선집 58권에서 전도 동원 요원이 한 달 식비 최소 얼마…"
- "말씀선집 54권에서 남미·아프리카 사람들을 교차 축복으로…"

LLM-Judge 분석 발췌:
> "제공된 컨텍스트 내에는 질문에 대한 정답인 '말씀선집 56권'에 관한 정보가 전혀 포함되어 있지 않습니다. 생성된 답변은 컨텍스트에 없는 외부 정보를 임의로 인용하여 답변하였으므로 사실 정확도가 매우 낮고 환각이 발생했습니다."

→ paragraph chunk가 **권 번호/날짜 메타데이터를 본문에 결합하지 않아**
   "말씀선집 N권" 같은 키워드로 검색할 때 매칭이 어렵다.

---

## 가설

paragraph 청킹은 단락 단위(평균 ~1500자)로 자르고 payload에만 `volume` 필드가 있다.
그런데 임베딩은 본문 텍스트만 반영하므로:

1. 사용자 질문에 "말씀선집 56권"이 등장해도 **본문 임베딩과의 유사도는 낮음**
2. payload `volume`은 **dense 검색 점수에 반영되지 않음**
3. sparse(BM25) 검색이 보조하지만 권 번호는 흔한 토큰이라 변별력 부족

---

## 보강 방안 (4가지 후보, ★ 추천도)

> **2026-04-30 업데이트**: dev-log 47의 3-way 재검증에서 B(prefix)가 L1/L2에서 가장
> 강하다는 것이 확인됐다. 이에 **방안 D(F+B 하이브리드 검색)**를 추가하고 우선순위
> 재조정. Codex 권고와 일치하는 옵션.

### ★★★★★ 방안 A — 메타데이터 prefix injection (재임베딩)

각 paragraph chunk 텍스트 앞에 메타데이터 prefix 삽입 후 재임베딩.

```text
[말씀선집 56권 / 1975-09-22 / 미국 뉴욕]
이 시기에 참부모님께서는 120개국에 선교사를 파송하시며 …
```

- **장점**: 권/날짜가 본문 일부가 되어 dense + sparse 검색 모두에 반영. 코드 변경은 ingestor 1곳.
- **단점**: 22,419 chunks 재임베딩 (Gemini embedding 비용 + 시간 ~30분).
- **검증 방식**: 동일 50문항 재측정, L2 총점이 A와 동등(11.10) 이상 나오면 채택.

### ★★★★ 방안 B — 질문 파싱 + volume 필터 (재임베딩 불필요)

`query_rewriter.py` 또는 별도 stage에서 정규식으로 권/날짜 추출 후 Qdrant filter 적용.

```python
# pseudo
match = re.search(r"말씀선집\s*(\d+)\s*권", question)
if match:
    vol_filter = FieldCondition(
        key="volume",
        match=MatchValue(value=f"말씀선집 {match.group(1)}권")
    )
    query_filter.must.append(vol_filter)
```

- **장점**: 재임베딩 불필요. 코드 변경 최소.
- **단점**: 질문에 권 번호가 명시되지 않은 우회 표현(예: "70년대 초반")은 커버 못 함.
- **검증**: 50문항 중 L2 10건 + L1 3~5건이 명시적 권/날짜 포함 → 일부만 개선 예상.

### ★★★ 방안 C — Re-ranking에서 메타데이터 가중치

reranker 단계에서 질문의 권/날짜와 chunk payload `volume`이 일치하면 boost score.

- **장점**: 후처리만 변경. 검색은 그대로.
- **단점**: 1차 검색에서 해당 chunk가 top-50에 들어가야 효과 있음. 1차에서 빠지면 무력.
- **검증**: A/F 둘 다 적용 가능 → A의 L2 강점이 F에서도 살아날지 불확실.

### ★★★★★ 방안 D (신규, 2026-04-30) — F + B 하이브리드 검색

`malssum_poc_v3` (F, paragraph) 와 `malssum_poc_v2` (B, prefix) 두 컬렉션 모두에서 검색
후 RRF/Re-ranker로 병합. dev-log 47의 3-way 결과에서 B가 L1/L2 강함, F가 L3~L5 강함이
확인됐기 때문에 두 강점을 결합하는 가장 직접적 방안.

```python
# pseudo
results_f = await hybrid_search(qdrant, q_dense, q_sparse, collection="malssum_poc_v3", top_k=50)
results_b = await hybrid_search(qdrant, q_dense, q_sparse, collection="malssum_poc_v2", top_k=50)
merged = rrf_merge(results_f, results_b, weights={"f": 0.5, "b": 0.5})
top10 = await rerank(query, merged, top_k=10)
```

- **장점**:
  - **재임베딩 불필요** — B 컬렉션 이미 존재 (74,341 청크)
  - L1/L2 약점은 B의 강점으로 직접 보완 (LLM-Judge L2: F 10.50 → B 11.90)
  - Codex 권고와 일치 ("F 기본 + B 보조 검색 후보 병합")
- **단점**:
  - 검색 비용 2배 (두 컬렉션 모두 query)
  - RRF 가중치 튜닝 필요 (L별 다른 가중치 가능성)
  - Cascading search tier 구조 변경 필요
- **검증**: 50문항 재측정으로 hybrid vs F 단일 비교. L2 총점 12+ 회복 + 종합 평균 0.742+ 유지가 통과 기준.

---

## 추천 실행 순서 (2026-04-30 업데이트)

1. **Phase 1 (가장 낮은 비용)**: 방안 D — F+B 하이브리드 검색.
   - 두 컬렉션 모두 존재, 코드만 변경. 재임베딩 0.
   - 50문항 재측정으로 L2 회복 + 종합 유지 확인.
   - Codex가 직접 권장한 옵션이므로 우선 시도.
2. **Phase 2 (방안 D 부족 시)**: 방안 B — 질문 파싱 + volume 필터.
   - 명시적 권/날짜 인용 질문에 대한 정밀 매칭.
3. **Phase 3 (재임베딩 비용 감수 시)**: 방안 A — 메타데이터 prefix injection.
4. **Phase 4 (옵션)**: 방안 C — Re-ranking 가중치.

각 Phase 완료 후 dev-log에 측정 결과 기록.

---

## Out of Scope

- A로 롤백: dev-log 45에서 F의 종합 우월성 확인됨. L2만 -0.60 약점 ≤ L1/L3/L4/L5 평균 +1.0 우월.
  운영은 F 유지 + L2 보강 병행이 최적.
- 새 청킹 알고리즘: 다른 chunk size / overlap 조합은 별도 PoC 필요. 본 plan 범위 외.

---

## 트리거 조건

다음 중 하나가 만족되면 본 plan 실행:

- L2 사용자 만족도 모니터링 (chat_logs 분석)에서 L2 부정 피드백 비율 ≥ 임계
- 다음 raw 측정 회차에서 L2 회복 검증이 필요한 경우
- 사용자 직접 지시
