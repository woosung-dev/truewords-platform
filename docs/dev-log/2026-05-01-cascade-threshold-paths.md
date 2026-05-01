# 2026-05-01 — Cascade `score_threshold` 설정 전파 경로 조사

## TL;DR

코드에 `0.75` 와 `0.1` 두 개의 default 가 흩어져 있지만, **실제 운영에서 cascading/weighted 검색의 cutoff 로 적용되는 값은 항상 `0.1`**. `0.75` 는 사용되지 않는 **dead default** 다.

청사진 (`docs/04_architecture/target-architecture-blueprint-2026-05-01.html`) 이 적신호로 표시한 "score_threshold 0.60" 버그도, 본 ADR 작성 직전 `plan.md` 가 가정한 "절대값 0.75 → 상대값 top × 0.7 전환" 도 **둘 다 잘못된 전제**. 실제 cutoff 가 무엇인지 코드 trace 로 확인한 결과만이 정확하다.

---

## 1. 코드에 정의된 `score_threshold` 위치

| # | 위치 | default | 적용 가능성 |
|---|---|---|---|
| 1 | `backend/src/chatbot/runtime_config.py:18` `TierConfig` | **0.75** | ❌ **Dead default** — build_runtime_config 에서 항상 override |
| 2 | `backend/src/config.py:45` `cascade_score_threshold` | **0.75** | ❌ **Dead default** — `settings.cascade_*` 사용 코드 0건 |
| 3 | `backend/src/chatbot/runtime_config.py:28` `WeightedSourceConfig` | 0.1 | △ Dead default (DB JSONB 경로에서 override) |
| 4 | `backend/src/chatbot/schemas.py:21` `SearchTierSchema.score_threshold` | **0.1** | ✅ Admin UI 에서 챗봇 생성 시 default |
| 5 | `backend/src/chatbot/schemas.py:29` `WeightedSourceSchema.score_threshold` | 0.1 | ✅ Admin UI 에서 챗봇 생성 시 default |
| 6 | `backend/src/chatbot/service.py:85` `build_runtime_config` `t.get("score_threshold", 0.1)` | **0.1** | ✅ DB JSONB 미설정 시 default |
| 7 | `backend/src/search/cascading.py:33` `SearchTier` (dataclass) | **0.1** | ✅ cascading_search 직접 호출 시 default |
| 8 | `backend/src/search/weighted.py:27` `WeightedSource` (dataclass) | 0.1 | ✅ weighted_search 직접 호출 시 default |

→ **운영 chatbot 의 검색 경로에서 실제 적용되는 cutoff = 0.1**

## 2. 검색 cutoff 적용 호출 그래프

```
Admin UI / 챗봇 생성
    ↓ SearchTierSchema (default 0.1)
    ↓
DB INSERT chatbot_config.search_tiers (JSONB)
    ↓
챗봇 호출 → ChatbotService.build_runtime_config
    ↓ raw dict에서 t.get("score_threshold", 0.1)
    ↓ ⚠️ TierConfig(score_threshold=0.75) 의 default 는 절대 사용되지 않음
    ↓
ChatbotRuntimeConfig.search.tiers: list[TierConfig]
    ↓
(상위 layer가 SearchTier dataclass로 변환하여 cascading_search 호출)
    ↓
cascading.py:106  qualified = [r for r in results if r.score >= tier.score_threshold]
    ↓
실제 적용되는 값: 0.1 ← !!
```

`config.py:45` 의 `settings.cascade_score_threshold = 0.75` 는 **현재 코드 어디에서도 import 되지 않음** (검색 결과 0건). 환경변수 `CASCADE_SCORE_THRESHOLD` 로 주입해도 어떤 동작도 바뀌지 않는다.

## 3. RRF 점수대 vs cutoff 정합성

`backend/src/search/hybrid.py` 는 Qdrant `FusionQuery(fusion=Fusion.RRF)` 사용. RRF score 의 일반 범위:

> RRF fusion 점수는 Σ1/(k+rank) 형태로 일반적으로 0.0~0.5 범위 (k=60 가정)

→ cutoff `0.1` 은 RRF 분포 안에서 합리적 (상위 ~10건 정도 통과).
→ cutoff `0.75` 는 RRF 점수대를 초과 (절대 충족 불가능). 만약 `TierConfig.score_threshold = 0.75` 가 실제로 적용되면 검색 결과가 항상 0건이 된다.

## 4. 영향 분석 — 0.75 가 실수로 실제 적용될 risk

`build_runtime_config` 가 `t.get("score_threshold", 0.1)` 로 default 를 강제하므로 안전. 하지만:

- `TierConfig` 를 직접 인스턴스화하는 코드가 있다면 `0.75` 가 실제 적용된다 → 검색 0건 버그
- 향후 누군가 `t.get("score_threshold", 0.1)` 의 default 를 지우거나 `t.get("score_threshold")` 로 바꾸면 `TierConfig` 의 0.75 가 살아난다

## 5. 정리 권고 (별도 PR 후보)

1. `TierConfig.score_threshold = 0.75` → `0.1` 로 default 정정 (dead default 동기화)
2. `Settings.cascade_score_threshold` / `cascade_fallback_threshold` / `cascade_min_results` 미사용 필드 제거 또는 실제 사용처 추가
3. RRF 점수대 가이드 docstring 추가 (cascading.py:33 에는 이미 있음)

본 ADR 은 위 정리 작업을 **본 PR 에서 수행하지 않음** (분포 로깅 + 측정이 우선). 별도 PR 에서 진행.

## 6. 본 PR 의 cutoff 정책

본 PR 은 **분포 로깅만** 추가. cutoff 공식 변경은 분포 데이터 확보 후 별도 PR.

```python
# cascading.py — search_tier 호출 직후 (변경 없음, 측정만)
if results:
    scores = [r.score for r in results]
    logger.info(
        "cascade_score_dist",
        extra={
            "tier_idx": tier_idx,
            "tier_sources": tier.sources,
            "tier_threshold": tier.score_threshold,
            "top": scores[0],
            "p50": scores[len(scores) // 2],
            "bottom": scores[-1],
            "n_results": len(results),
            "n_qualified": sum(1 for s in scores if s >= tier.score_threshold),
        },
    )
```

분포 데이터 확보 후 다음 옵션 중 선택:
- 옵션 A: cutoff 정책 변경 없음 (0.1 유지)
- 옵션 B: 상대값 only `cutoff = top * α` (α 데이터 기반 결정)
- 옵션 C: 상대 + 절대 안전판 `cutoff = max(top * α, abs_floor)` (abs_floor 는 분포 P25 등)

## 7. 참고 자료

- `docs/04_architecture/target-architecture-blueprint-2026-05-01.html` — 외부 청사진 사본
- `docs/dev-log/24-rrf-score-threshold-fix.md` (2026-04-11) — 이전 RRF score threshold 작업 ADR (문맥 참고)
- `docs/dev-log/2026-05-01-target-architecture-gap.md` — 청사진과 실제 코드 차이 표
- Codex consult mode 검토 결과 (session `019de19a-04ff-7571-8132-0dca4f8d4046`)
