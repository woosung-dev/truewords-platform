# 47. Qdrant SDK HTTP/2 hang 영구 해결 — chat 핫패스 raw httpx 전환

> 결정일: 2026-04-30
> 상태: 결정 완료, 구현 완료, prod 검증 완료 (PR #84 머지 `d8a14c2`, PR #86 admin/pipeline 후속)
> 관련 ADR: `45-qdrant-self-hosting.md`, `46-qdrant-cache-cold-start-debug.md`
> 관련 PR: #78 (진단), #83 (cache 전환), **#84 (chat search 전환)**, #86 (admin + pipeline 잔여 정리)

## Context — PR #83 이후에도 잔존하던 문제

PR #83 에서 `SemanticCacheService` 의 모든 호출을 raw httpx(HTTP/1.1) 로 전환하여
cache 호출은 정상 복귀했으나, prod `/chat` 요청은 여전히 70s 타임아웃.

증상 (PR #83 머지 후 검증):
- `cache.check_cache()` (raw httpx) → 정상 응답 (~1s)
- pipeline 진입 → `SearchStage` → `cascading_search` → `hybrid_search` →
  `client.query_points(prefetch=[...], query=FusionQuery(RRF))` (qdrant-client SDK) → **60s ConnectTimeout**
- 결과: Vercel proxy 60s timeout → admin UI `ROUTER_EXTERNAL_TARGET_ERROR`

즉 cache 외에도 `backend/src/search/` 모듈 4개 파일(hybrid / cascading / fallback / weighted)
이 SDK 의 HTTP/2 hang 영향권에 있었다.

## 조사 — 옵션 평가 매트릭스

PR #78 진단으로 SDK HTTP/2 hang 확정 후, 영구 해결 방향 5가지를 평가:

| 옵션 | 작업량 | 회귀 위험 | 운영 영향 | 추천도 |
|---|---|---|---|---|
| **A. raw httpx 전환 (cache 패턴 확장)** | 핫패스 6.5h / 전체 28h | 중 (테스트로 완화) | 없음 | ★★★★★ |
| B. `prefer_grpc=True` (qdrant-client) | 1~2h 검증 | 미지수 | 6334 ingress 추가 | ★★★ |
| C. HTTP/2 monkey patch | 2~4h | 높음 (SDK 업데이트마다 재검증) | 없음 | ★★ |
| D. Serverless VPC Access | 4h + $12/월 | 낮음 | Cloudflare Tunnel 폐기, GCP 종속 ↑ | ★★★ |
| E. backend 도 VM 호스팅 | 16h+ | 매우 높음 | Cloud Run 폐기 | ★ |

옵션 B 검증 시도 중 cloudflared 가 token-mode (대시보드 관리) 로 운용 중이어서
ingress 추가에 Cloudflare API token / 수동 작업이 필요. 30분 timebox 내 결론 어려움 +
gRPC 도 HTTP/2 기반이라 동일 근본 원인에 다시 막힐 위험 존재. 옵션 A 직행.

## 결정 — 옵션 A: raw httpx 전환 + RawQdrantClient 헬퍼 모듈

채택 이유:
- PR #83 에서 prod 검증된 패턴 재사용
- 인프라 변경 0 → AWS 이관 친화성 유지
- SDK 의존도 점진적 제거 가능 (cache → search → admin → pipeline)
- 단위 테스트로 PR #80 사고 (mock-client → raw 변환 호환성 누락) 재발 방지

PR 분할 (5개 → 4개로 조정):
- **PR-A** `RawQdrantClient` 헬퍼 + 단위 테스트 (PR #84 1번째 커밋)
- **PR-B** search 핫패스 4파일 (hybrid + cascading + fallback + weighted) 일괄 전환 (PR #84 2번째 커밋)
- PR-D admin `datasource/qdrant_service.py` (별도 sprint)
- PR-E pipeline + startup 정리 (선택)

> PR-B 와 PR-C 합친 이유: `SearchStage` 가 fallback_search 에 동일 client 인스턴스를
> 넘기므로 부분 전환 시 타입 불일치. 4파일 일괄 변환이 가장 단순.

## 구현 — RawQdrantClient + filters 헬퍼 (PR #84)

### `backend/src/qdrant/raw_client.py`
- HTTP/1.1 강제 (`http2=False`)
- timeout: 15s 전체, 5s connect (PR #83 검증값)
- `QdrantPoint` dataclass — SDK `ScoredPoint` attribute access(`.score`, `.payload`) 호환
- 메서드: `query_points` / `query_batch_points` / `upsert` / `collection_exists`
- 테스트용 `transport` 인자 (httpx.MockTransport 주입 가능)

### `backend/src/qdrant/filters.py`
SDK 객체 → dict 헬퍼:
- `field_match` / `field_match_any` / `field_range` (FieldCondition 동등)
- `build_filter` (must / must_not / should)
- `sparse_vector` (SparseVector 동등)
- `prefetch` (Prefetch 동등)
- `fusion_rrf` / `fusion_dbsf` (FusionQuery 동등)

### `backend/src/qdrant_client.py`
- `get_raw_client()` 싱글톤 추가 — chat 핫패스 전용
- `get_async_client()` 잔존 — admin/pipeline 의 SDK 호출은 후속 작업

### 호출처 변경
- `src/search/hybrid.py` — Prefetch + FusionQuery + SparseVector + Filter 객체 → dict 헬퍼
- `src/search/cascading.py`, `src/search/weighted.py` — client 타입만 `RawQdrantClient`
- `src/search/fallback.py` — `query_points` 직접 호출 raw httpx 전환
- `src/chat/pipeline/stages/search.py` — `get_async_client` → `get_raw_client`

### 테스트
- `backend/tests/qdrant/` — 단위 테스트 36건 (httpx.MockTransport 기반)
- `backend/tests/test_search.py`, `test_fallback.py` — `mock_response.points` wrapper 제거,
  `list[QdrantPoint]` 직접 반환 인터페이스로 단순화
- backend 전체: **545 passed, 4 skipped, 1 xfailed** (회귀 0)

## 검증 — Prod 응답 시간 (2026-04-30, revision `truewords-backend-00127-pgh`)

| 시나리오 | HTTP | 응답 시간 |
|---|---|---|
| 1차 (cold + 신규 쿼리) | 200 | **19.48s** |
| 2차 (warm + 동일 쿼리, cache hit) | 200 | **2.69s** |
| 3차 (warm + 신규 쿼리, full pipeline) | 200 | **14.55s** |
| 이전 (PR #83 머지 후) | — | 70s ConnectTimeout |

Admin UI 시나리오 (https://truewords-platform.vercel.app/) — 답변 + 출처 3건 정상 표시.

## 영향 — 후속 작업

### 핫패스 (chat 응답)
✅ PR #84 로 영구 해결. SDK 의 HTTP/2 hang 이 chat 경로에서 완전 제거됨.

### 웜패스 (admin / pipeline) — PR #86 으로 일괄 정리
✅ 본 PR 의 후속 PR #86 으로 backend/src 의 모든 SDK 호출을 raw httpx 로 전환.

PR-D (admin datasource):
- `RawQdrantClient` 에 `scroll` / `facet` / `set_payload` / `delete` / `count` 메서드 +
  `FacetHit` dataclass 추가
- `datasource/qdrant_service.py` 전 8곳 변환, `__init__` 시그니처 단순화

PR-E (pipeline + admin 잔여 + startup):
- `pipeline/ingestor.py` — sync httpx 로 `_sync_upsert` / `_sync_delete_by_filter` 헬퍼
- `pipeline/batch_service.py` — async raw upsert
- `admin/data_router.py` — 재업로드 reset delete + `Filter`/`FieldCondition` import 제거
- `admin/analytics_router.py` — 대시보드 count async raw 전환
- `qdrant_client.py` — `ensure_main_collection` (raw httpx) 추가, `create_collection` /
  `create_payload_indexes` 는 backend/scripts 호환을 위해 deprecated 표기로 잔존

### backend/scripts (마이그레이션 도구)
지속 SDK 사용. chat 핫패스 외 일회성 호출이며 SDK hang 발생 시 `--prefer-grpc` 또는
인프라 변경으로 우회 가능. 관리 작업에서 막힐 때 추가 변환.

### 새로운 SDK 호출 추가 시 가이드
- chat 핫패스 → 반드시 `get_raw_client()` 사용. SDK 직접 호출 금지.
- admin / pipeline → 잠시 SDK 잔존 가능하나 신규 코드는 `RawQdrantClient` 권장.
- 새 메서드 필요 시 `RawQdrantClient` 에 추가 + httpx.MockTransport 단위 테스트 필수
  (PR #80 mock-client 호환성 누락 사고 재발 방지).

## 참고

- PR #84 (chat 핫패스): https://github.com/woosung-dev/truewords-platform/pull/84
  - 머지 커밋: `d8a14c2`, Cloud Run revision: `truewords-backend-00127-pgh`
  - 변경량: +1,012 LoC, 9 파일
- PR #85 (ADR #47): https://github.com/woosung-dev/truewords-platform/pull/85 (`7dacb19`)
- PR #86 (admin + pipeline 후속): https://github.com/woosung-dev/truewords-platform/pull/86
  - 변경량: +634 LoC (PR-D 406 + PR-E 228), 14 파일
  - backend 553 passed, 회귀 0
