# 46. Qdrant 캐시 초기화 cold start 디버깅 — Lazy Init 채택

> 결정일: 2026-04-29
> 상태: 결정 완료, 구현 완료 (PR `fix/qdrant-cache-lazy-init`)
> 관련 ADR: `45-qdrant-self-hosting.md` (PR #73)
> 관련 PR: #75 (timeout 명시), #77 (retry backoff), #78 (진단 빌드)

## Context — 회귀 발견

PR #73 (Qdrant Cloud → 셀프 호스팅 VM + Cloudflare Tunnel cutover) 직후, Cloud Run
**cold start lifespan**의 `ensure_cache_collection()`이 매번 일관 실패:

```
ResponseHandlingException(ConnectTimeout(''))
```

증상:
- backend의 chat 요청(warm path)에선 동일 `AsyncQdrantClient` 싱글톤이 정상 동작.
- 외부 PC에서 `curl https://qdrant.woosung.dev/collections` 즉시 200.
- `cache_available=False`로 굳어 semantic cache 비활성, RAG 응답 영향 0이지만 비용 ↑.

## 조사 — 가설 단계적 기각

| PR | 가설 | 결과 |
|---|---|---|
| #75 | qdrant-client 기본 timeout(5s) 부족 | timeout=60 명시 → 여전히 실패 |
| #77 | cold start 일시적 — retry로 흡수 가능 | 3회 backoff(2/4/8s) 모두 실패. 매 시도 60s timeout 끝까지 대기 |
| #78 | 단계별 어디서 막히는지 진단 빌드 | **결정적 답** 확보 |

## 진단 결과 (PR #78, revision `truewords-backend-00117-kbx`, 2026-04-29 08:59)

lifespan 진입 직후 단계별 probe — **모든 외부 호출 정상**:

```
[DIAG] DNS getaddrinfo OK 0.044s → IPv6×2 + IPv4×2
[DIAG] IPv6 TCP+TLS connect 2606:4700:3030::* OK 0.074s
[DIAG] IPv6 TCP+TLS connect 2606:4700:3037::* OK 0.071s
[DIAG] IPv4 TCP+TLS connect 104.21.92.216  OK 0.072s
[DIAG] IPv4 TCP+TLS connect 172.67.198.219 OK 0.070s
[DIAG] HTTP/1.1 raw httpx GET /collections 200 in 0.309s   ← qdrant-client 우회
[DIAG] Google generate_204 204 in 0.118s                    ← Cloud Run egress 정상
```

같은 시점, 같은 인스턴스에서 **`AsyncQdrantClient.get_collections()` 만 60s ConnectTimeout**.

## 가설 기각 매트릭스

| 가설 | 진단으로 기각 |
|---|---|
| ~~IPv6 happy-eyeballs~~ | IPv6 connect 75ms로 정상 |
| ~~Cloud Run egress cold~~ | Google·Qdrant 모두 정상 |
| ~~DNS resolver cold~~ | 44ms |
| ~~Cloudflare Tunnel cold path~~ | raw HTTP/1.1 → 200 |
| ~~TLS/SNI handshake variance~~ | TCP+TLS 70~80ms |

## 확정 원인

**`qdrant-client` SDK가 사용하는 `httpx[http2]` 의 HTTP/2 코드 경로 + Cloudflare 조합
+ Cloud Run cold instance 한정 hang.**

핵심 차이:
- 같은 URL, 같은 시점, 같은 인스턴스
- `httpx.AsyncClient(http2=False)` GET → **HTTP 200**
- `AsyncQdrantClient.get_collections()` → **60s ConnectTimeout**

`qdrant-client>=1.12`은 `httpx[http2]` extra를 강제 의존(`uv.lock` line 3255 확인).
HTTP/2 ALPN 협상 + SETTINGS frame 교환 단계에서 cold instance + Cloudflare 조합 시
hang 발생. warm path에서는 connection 재사용으로 동일 문제 회피.

이 패턴은 GCP 공식 가이드의 우려와 일치:
> **"If a startup probe makes outbound HTTPS requests before the network is fully ready,
> it could cause hangs."**
> — [Cloud Run troubleshooting docs](https://docs.cloud.google.com/run/docs/troubleshooting)

> **"Use lazy initialization for infrequently used objects to defer the time cost
> and decrease cold start times."**
> — [3 Ways to optimize Cloud Run response times](https://cloud.google.com/blog/topics/developers-practitioners/3-ways-optimize-cloud-run-response-times)

## 결정 — Lazy Init 채택

**`ensure_cache_collection`을 lifespan에서 제거하고 첫 chat 요청 시점에 lazy 호출.**

### 구현 (이번 PR)

#### `backend/main.py`
- `_diagnose_cold_start_outbound` 헬퍼 (#78에서 추가) 제거
- `_ensure_cache_with_retry` 헬퍼 (#77에서 추가) 제거
- lifespan에서 `await ensure_cache_collection()` 호출 자체 제거
- `app.state.cache_available = None` (미시도 sentinel) 으로 초기화

#### `backend/src/chat/dependencies.py`
- `_cache_init_lock = asyncio.Lock()` 모듈 전역 추가
- `get_cache_service`에서 `cache_available is None` 시
  잠금 획득 후 ensure 시도, 결과(`True`/`False`)를 `app.state.cache_available`에 캐싱
- 두 번째 요청부터는 잠금 우회 (fast path)
- 실패 시 graceful degradation 분기는 기존 그대로 유지

### 변경되지 않는 것

- `backend/src/cache/setup.py` — `ensure_cache_collection` 본체 무변경
- `backend/src/qdrant_client.py` — PR #75의 timeout=60 그대로 (lazy init이라 영향 적지만 안전망 유지)
- `backend/src/cache/service.py` — Cache 서비스 사용처 무변경

## 영향

| 항목 | 변화 |
|---|---|
| cold start lifespan duration | -60s 이상 (실패한 retry 60s×3 제거) |
| cache_available=True 회복률 | 0% → 거의 100% (warm path에서 동작 검증 완료) |
| 첫 chat 요청 latency | +0.3~1s (1회만, lazy init 비용) |
| 둘째 이후 요청 | 영향 0 (state 캐싱) |
| 동시 요청 다발 | asyncio.Lock으로 ensure 1회만 실행 |
| LLM 비용 | cache hit 회복으로 동일 질문 반복 시 절약 |

## 리스크 / 롤백

| 리스크 | 대응 |
|---|---|
| lazy init 시점에도 동일 ConnectTimeout 가능성 | `state.cache_available=False` 캐싱 → 이전 동작과 동일 graceful degradation |
| 첫 chat 요청 실패 (사용자 실수 응답) | ensure_cache_collection은 try/except 격리 → 사용자 응답 정상 |
| asyncio.Lock 데드락 | `_cache_init_lock`이 모듈 전역, 단일 책임. 이중 acquire 경로 없음 |
| 롤백 | git revert. 캐시 비활성 상태로 복귀 (현재 prod와 동일) |

## 후속 — 만약 lazy init도 실패한다면

진단 결과 `httpx.AsyncClient(http2=False)`는 정상 동작 확인됐으므로, 최후 수단으로
qdrant-client 우회 + raw httpx 호출 직접 사용:

```python
# 가장 마지막 카드 (이번 PR에선 미적용)
async with httpx.AsyncClient(http2=False, timeout=30.0) as c:
    r = await c.get(f"{settings.qdrant_url}/collections", headers={"api-key": ...})
```

또는 qdrant-client GitHub에 HTTP/2 cold start hang 이슈 제출.

## 검증

- pytest 단위 (lazy init 동시성, graceful degradation): `tests/test_cache_lazy_init.py` 신규 (이 PR)
- 머지 후 자동 deploy → 새 cold start 로그에서 "캐시 컬렉션 초기화 실패" 부재 확인
- 첫 chat 요청 → "캐시 컬렉션 lazy init 성공 — cache_available=True" 로그 확인
- 동일 질문 2회 → 두 번째 응답 1~2초 (cache hit 확인)

## 학습

- **Cloud Run lifespan에서 외부 HTTPS 호출은 위험** — Google 공식 권장도 lazy init.
- **qdrant-client는 HTTP/2를 강제 사용** — 일부 인프라 조합에서 SDK 단독 hang 발생.
- **단계별 probe는 가설 분리에 매우 효과적** — DNS·TCP·TLS·HTTP·SDK 5단계로 분리하면
  결정적 단서 확보 가능. 향후 유사 디버깅에 동일 패턴 활용.
