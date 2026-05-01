# 2026-05-01 — Cascade Score 분포 측정 + cutoff 결정 (변경 없음)

## TL;DR

운영 USER 질의 50건으로 hybrid_search 분포를 측정한 결과 **현재 cutoff 0.1 이 최적, 변경 없음** 결정. 청사진의 "절대→상대 (top × 0.7)" 권고는 본 도메인 분포에서 ROI 미미 + 회귀 위험. 동시에 발견된 `0.75` dead default 두 곳은 정리 (`runtime_config.TierConfig.score_threshold`, `Settings.cascade_*` 3 필드).

본 ADR 은 [Phase 0 (#107)](https://github.com/woosung-dev/truewords-platform/pull/107) 의 분포 로깅 (`cascade_score_dist`, `weighted_score_dist`) 결과를 사용해 cutoff 정책을 데이터 기반으로 결정한 후속 작업이다.

---

## 1. 측정 방법

- **데이터 소스:** `session_messages` 테이블의 role=USER content (DB 누적 3,034건 중 무작위 50건, length 10~300자, GROUP BY content 로 unique)
- **검색 함수:** `hybrid_search(client, query, top_k=50, source_filter=None)` (Qdrant Dense + Sparse RRF, source 무필터)
- **수집 항목:** 각 쿼리 결과의 `score_top` / `score_p50` / `score_bottom` / `n_results` + 절대 cutoff (0.05/0.075/0.1/0.15) / 상대 cutoff (top × 0.5/0.6/0.7/0.8) 별 통과 건수
- **실행 환경:** local (PostgreSQL + Qdrant localhost), backend `.env` (실제 GEMINI_API_KEY)
- **스크립트:** 임시 측정 스크립트 (`/tmp/measure_cascade_dist.py` — repo 미커밋, 본 ADR 의 "재현" 섹션에 핵심 로직 보존)

## 2. 결과 (50 쿼리, 모두 성공)

### Score 분포

| 항목 | mean | median | p25 | p75 | min | max |
|---|---|---|---|---|---|---|
| score_top | 0.557 | 0.500 | 0.500 | 0.500 | 0.500 | 1.000 |
| score_p50 | 0.070 | 0.071 | 0.067 | 0.071 | 0.045 | 0.077 |
| score_bottom | 0.037 | 0.039 | 0.037 | 0.039 | 0.022 | 0.039 |
| n_results | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 | 50.0 |

→ `top_k=50` 가득 채워짐. score_top 분포는 매우 좁음 (50개 중 41개가 [0.500, 0.550] 범위).

### 절대 cutoff 별 통과 건수 (top_k=50 중)

| cutoff | mean_qualified | median | zero_count |
|---|---|---|---|
| 0.050 | 37.1 (74%) | 38 | 0 |
| 0.075 | 23.7 (47%) | 24 | 0 |
| **0.100 (현재 운영)** | **17.9 (36%)** | **18** | **0** |
| 0.150 | 10.0 (20%) | 10 | 0 |

### 상대 cutoff (top × ratio) 통과 건수

| ratio | mean_qualified | median | zero_count |
|---|---|---|---|
| 0.50 | 5.3 | 6 | 0 |
| 0.60 | 3.7 | 4 | 0 |
| **0.70 (청사진 권장)** | **2.0** | **2** | **0** |
| 0.80 | 2.0 | 2 | 0 |

### top score 히스토그램

```
[0.5000~0.5500]  41  ##########################################
[0.5500~0.6000]   3  ###
[0.6000~0.6500]   0
[0.6500~0.7000]   0
[0.7000~0.7500]   0
[0.7500~0.8000]   0
[0.8000~0.8500]   3  ###
[0.8500~0.9000]   0
[0.9000~0.9500]   0
[0.9500~1.0000]   3  ###
```

## 3. 분석

### 3.1 현재 cutoff 0.1 은 안정

- `zero_count=0` — 모든 쿼리에서 최소 1건 통과 → fallback 검색 트리거 X
- 평균 18건 통과 → 다음 단계 (rerank top-10) 에 충분한 후보 공급 (overshoot 1.8x)
- score_top 분포 좁아 (median=0.500) 거의 모든 쿼리에서 같은 cutoff 가 적용

### 3.2 청사진의 "절대→상대 (top × 0.7)" ROI 미미

- ratio=0.7 의 평균 통과 건수 2.0 — 현재 18 대비 **89% 감소**
- score_top 이 좁은 분포 (대부분 0.5) 라 상대 cutoff 0.35 (=0.5×0.7) 가 절대 cutoff 0.35 와 거의 같음 → 변동성 없음
- rerank 후보 부족 위험 (top-10 보장 어려움)
- **변경 정당화 불가능. 가설 기반 변경 금지 원칙 (Phase 0 plan §3) 에 따라 이번 PR 에서 제외**

### 3.3 다른 옵션 검토

- **cutoff 0.15 상향** — 평균 10건 통과로 rerank 부담 감소 가능. 단 ROI 작음 (overshoot 1.0x — 안전 마진 사라짐)
- **상대 + 절대 안전판 hybrid (`max(top × 0.5, 0.1)`)** — 분포 좁아 절대값 0.1 이 거의 항상 작동 → 효과 = 절대 0.1 만 적용한 것과 동일

## 4. 결정

### 4.1 cutoff 정책 — 현재 0.1 유지 (변경 없음)

데이터가 변경 정당화 못함. Phase 0 의 "분포 측정 → cutoff 결정" 결과: **변경 없음** 이 데이터 기반 결론.

### 4.2 dead default 정리

본 PR 에서 동시 진행:

1. **`runtime_config.TierConfig.score_threshold` 0.75 → 0.1**
   - 이전 0.75 는 `build_runtime_config` 가 `t.get("score_threshold", 0.1)` 로 항상 override 하는 dead default
   - 또한 RRF 점수대(0.0~0.5)를 초과해 실수로 직접 인스턴스화 시 검색 결과 0건 위험
   - 0.1 = `build_runtime_config` fallback 과 동기화

2. **`Settings.cascade_score_threshold` / `cascade_fallback_threshold` / `cascade_min_results` 3 필드 삭제**
   - `settings.cascade_*` 사용처 0건 (grep 검증)
   - `.env` / `.env.example` 에서도 미사용
   - 삭제로 코드 명확성 확보

3. **`test_runtime_config_models.test_tier_config_defaults` 갱신**
   - `assert t.score_threshold == 0.75` → `0.1` (default 변경 반영 + 주석으로 근거 보존)

### 4.3 청사진 권고 우선순위 재조정

본 데이터 기반으로 청사진의 다른 권고 우선순위 재평가:

| 청사진 권고 | 본 측정 결과 후 ROI | 우선순위 |
|---|---|---|
| Cascade 절대→상대 cutoff (top×0.7) | **미미 (회귀 위험)** | ❌ 폐기 |
| Cross-encoder Reranker 교체 (Gemini → BGE) | 미측정. 잠재 ROI 큼 | ★★★★★ Phase 1 |
| parallel_fusion (BM25+Dense Hybrid) | 이미 적용 중 (hybrid.py) | △ 기존 유지 |
| Contextual Retrieval (청크 prepend) | 인덱싱 비용 측정 선행 필요 | ★★★ |
| RetrievalGate / QueryRouting | 미측정 | ★★★ |

## 5. 재현

미래 재측정 시 핵심 로직:

```python
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy import text
from src.config import settings
from src.qdrant.raw_client import RawQdrantClient
from src.search.hybrid import hybrid_search

async def main():
    eng = create_async_engine(settings.database_url.get_secret_value())
    async with AsyncSession(eng) as s:
        r = await s.execute(text("""
            SELECT content FROM session_messages
            WHERE role::text='USER' AND length(content) BETWEEN 10 AND 300
            GROUP BY content ORDER BY random() LIMIT :n
        """), {"n": 50})
        queries = [row[0] for row in r]
    await eng.dispose()

    client = RawQdrantClient()
    for q in queries:
        results = await hybrid_search(client, q, top_k=50, source_filter=None)
        scores = [r.score for r in results]
        # ... 분포 통계 집계

asyncio.run(main())
```

PYTHONPATH=backend 로 실행. local PostgreSQL + Qdrant 필요.

## 6. 참고

- Phase 0 PR #107 (분포 로깅 + 평가 골격): https://github.com/woosung-dev/truewords-platform/pull/107
- 설정 전파 경로 ADR: `docs/dev-log/2026-05-01-cascade-threshold-paths.md`
- 청사진 차이 ADR: `docs/dev-log/2026-05-01-target-architecture-gap.md`
- 청사진 사본: `docs/04_architecture/target-architecture-blueprint-2026-05-01.html`
