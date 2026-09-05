# 24. RRF 점수 스케일과 Cascading score_threshold 불일치 수정

- **작성일:** 2026-04-10
- **상태:** 즉시 조치 완료 / 후속 과제 있음
- **관련 파일:** `backend/src/search/hybrid.py`, `backend/src/search/cascading.py`, `backend/src/chatbot/service.py`

---

## 1. 증상

`/chat` 호출 시 모든 질문에 대해 아래와 같은 응답만 반환됨.

```json
{
  "answer": "해당 내용을 말씀에서 찾지 못했습니다.\n\n---\n_이 답변은 AI가 생성한 참고 자료이며, 신앙 지도자의 조언을 대체하지 않습니다._",
  "sources": []
}
```

재현 쿼리: `"타락이란 뭐라고 설명할수 있을까?"` / `chatbot_id=malssum_priority`.

`docs/02_domain`에 정의된 원리강론(타락론)은 학습 데이터에 포함되어 있어, 이 질문은 반드시 결과가 나와야 함.

## 2. 근본 원인 (Root Cause)

### 2-1. RRF fusion 점수와 score_threshold 스케일 불일치 (Primary)

`backend/src/search/hybrid.py:52-68` 는 Qdrant Query API의 `FusionQuery(fusion=Fusion.RRF)` 를 사용해 dense + sparse 결과를 Reciprocal Rank Fusion으로 합친다. RRF 점수는 각 리스트에서의 순위(rank)만을 기반으로 `Σ 1/(k + rank)` 형태로 계산되므로, **코사인 유사도(0~1 범위)와 달리 일반적으로 0.0x ~ 0.5 수준**에 분포한다.

그러나 `backend/src/chatbot/service.py:13-15` 의 기본값과 DB 저장값 모두 `score_threshold = 0.75` (코사인 유사도 감각) 로 설정되어 있어, `backend/src/search/cascading.py:46` 의 `r.score >= tier.score_threshold` 필터에서 **모든 결과가 항상 탈락**한다.

"타락" 쿼리의 실측 RRF 분포 (source=L 필터, top-10):

| rank | RRF score | 비고 |
|---:|---:|---|
| 0 | 0.523810 | 원리강론 — "타락(墮落)은 물론 인간 자신의 과오로…" (정답 청크) |
| 1 | 0.500000 | 원리강론 — 누시엘의 타락 |
| 2 | 0.333333 | |
| 3 | 0.333333 | |
| 4 | 0.250000 | |
| 5 | 0.200000 | |
| 6 | 0.166667 | |
| 7 | 0.142857 | |
| 8 | 0.125000 | |
| 9 | 0.111111 | |

최상위 정답조차 0.523 으로, `0.75` 임계값을 절대 통과할 수 없다.

### 2-2. 데이터 라벨(L/M) ↔ 챗봇 설정(A/B/C) 불일치 (Secondary)

현재 `malssum_poc` 컬렉션 11,922개 포인트의 `source` 분포:

| source | count | 의미(추정) |
|---|---:|---|
| A | 0 | — |
| B | 0 | — |
| C | 0 | — |
| L | 1,937 | 원리강론 |
| M | 9,985 | 훈독회 성훈 (참부모님 말씀) |

DB `chatbot_configs` 에 등록된 기본 챗봇들:

| chatbot_id | sources | 실제 매칭 문서 수 |
|---|---|---:|
| `all` | `["A","B","C"]` | **0** |
| `source_a_only` | `["A"]` | **0** |
| `source_b_only` | `["B"]` | **0** |
| `malssum_priority` | tier1 `["A","L"]`, tier2 `["M"]` | L=1937, M=9985 |

`malssum_priority` 를 제외한 3개 챗봇은 필터 기준 자체가 빈 집합이라 어떤 질문에도 0건이 나오는 상태.

### 2-3. Semantic Cache 오염 (부수적)

`backend/src/cache/service.py` 는 답변이 비어 있든 말든 모든 응답을 임베딩 기준으로 저장한다. 실패 기간 동안 "찾지 못했습니다" 응답이 캐시(유사도 0.93 이상)에 남아, 임계값을 고치더라도 동일 질문이 캐시 히트로 계속 빈 답변을 받을 수 있다.

## 3. 즉시 조치 (Applied)

1. **`malssum_priority` chatbot_config 의 `score_threshold` 를 `0.75 → 0.1` 로 조정**
   - tier1 (`["A","L"]`), tier2 (`["M"]`) 모두 적용
   - 실측 분포상 상위 10개가 모두 통과하며, 상위 정답 청크가 정상 반영됨
   - `min_results=20` 은 유지 (필요 시 후속 튜닝)
2. **`semantic_cache` 컬렉션 전체 초기화** — 실패 기간 중 쌓인 빈 응답 캐시 제거
3. **검증 쿼리 재실행** — `"타락이란 뭐라고 설명할수 있을까?"` 로 원리강론 출처가 포함된 실제 답변 반환 확인

## 4. 후속 과제 (Follow-up)

### 4-1. 데이터 라벨 체계 통일 (중요, docs/TODO.md 등록)

- `A/B/C/D` (설계 문서·기본 챗봇) vs `L/M` (실적재 데이터) 이원화를 해소해야 한다.
- 옵션 1: ingest 파이프라인에서 원본 → `A/B/C/D` 로 정규화 후 재적재
- 옵션 2: DB `chatbot_configs` 의 기본 챗봇(`all`, `source_a_only`, `source_b_only`) sources 를 `L/M` 기준으로 재작성
- 어느 쪽이 "설계 상의 진실(single source of truth)" 인지 팀 합의 필요 → `[확인 필요]`

### 4-2. RRF 점수 스케일 문서화 및 UI 가드

- `SearchTierEditor` 관리자 UI(프론트) 에 "RRF fusion 점수는 일반적으로 0.0~0.5 범위" 라는 힌트 문구 추가
- `SearchTier` 기본값 상수 (`backend/src/chatbot/service.py:13-15`) 에 주석으로 RRF 스케일 명시
- 신규 챗봇 생성 시 기본 `score_threshold` 를 `0.1` 로 낮추는 것 검토

### 4-3. Semantic Cache 에 빈 응답 저장 방지

- `process_chat()` / `process_chat_stream()` 에서 검색 결과 0건이거나 답변이 "찾지 못했습니다" 디스클레이머만 포함한 경우 캐시에 저장하지 않도록 가드 추가
- 현재는 실패 응답도 7일간 캐시에 남아 후속 오진단 유발 가능

## 5. 교훈

- 검색 파이프라인에서 "점수" 라는 단어를 사용할 때는 **어느 스케일의 점수인가** (cosine, dot, RRF, rerank logit 등) 를 반드시 명시해야 한다.
- Qdrant Query API 의 RRF fusion 을 사용하는 이상, `0.75` 같은 직관적 임계값은 **항상 모든 결과를 탈락시키는** 부작용을 낳는다.
- 관리자 UI 에서 임계값을 자유롭게 설정할 수 있는 구조라면, UI 레벨에서 가이드/검증을 제공해야 운영자가 같은 함정에 빠지지 않는다.
