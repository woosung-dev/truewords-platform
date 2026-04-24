# 부수 S1 — Gemini 클라이언트 팩토리 단일화 (§13.1)

- **작성일**: 2026-04-25
- **상태**: 완료 (팩토리 + 3 모듈 일원화, 전체 테스트 352 PASS)
- **관련 파일**:
  - `backend/src/common/gemini_client.py` (신규)
  - `backend/src/common/gemini.py` (M)
  - `backend/src/pipeline/embedder.py` (M)
  - `backend/src/pipeline/batch_embedder.py` (M)
  - `backend/tests/test_gemini_client_factory.py` (신규)
  - 플랜 §13.1 S1

## 왜

SDK 실측(dev-log 25, `google-genai==1.68.0`) 이후 **§19.1 S1 스코프를 "retry 제어 변경"이 아닌 "클라이언트 초기화 단일화"로 축소**. 3곳의 `genai.Client(...)` 초기화가 분산되어 retry 정책이 파일별로 달랐음:

| 파일 | 이전 초기화 | retry 정책 |
|------|-------------|-----------|
| `common/gemini.py` L10 | `genai.Client(api_key=...)` | SDK 기본 (429 포함 5회) |
| `pipeline/embedder.py` L24-35 | `HttpRetryOptions(attempts=3, http_status_codes=[408,5xx])` | 429 제외 |
| `pipeline/batch_embedder.py` L13 | `genai.Client(api_key=...)` | SDK 기본 |

문제: 중복 코드 + 모킹 포인트 3개 + 새 클라이언트 변형 추가 시 일관성 유지 실패 위험.

## 구현

### 신규 팩토리 `backend/src/common/gemini_client.py`

```python
@lru_cache(maxsize=2)
def get_client(*, retry_429: bool = True) -> genai.Client:
    http_options = None if retry_429 else _build_restricted_http_options()
    return genai.Client(
        api_key=settings.gemini_api_key.get_secret_value(),
        http_options=http_options,
    )

def _build_restricted_http_options() -> types.HttpOptions:
    return types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            attempts=3, initial_delay=1.0, max_delay=10.0,
            http_status_codes=[408, 500, 502, 503, 504],  # 429 제외
        )
    )

def clear_cache() -> None:
    get_client.cache_clear()
```

### 사용처 교체

| 파일 | 변경 후 |
|------|---------|
| `common/gemini.py` | `_client = get_client()` — retry_429=True |
| `pipeline/embedder.py` | `_client = get_client(retry_429=False)` |
| `pipeline/batch_embedder.py` | `_client = get_client()` — retry_429=True |

`_client` 변수명 유지 → 기존 `_client.aio.models.*` / `_client.batches.*` / `_client.models.*` 호출 패턴 그대로. 기존 mock 경로(`src.pipeline.embedder._client` 등) 호환 → **회귀 없음**.

### retry 정책 확정 (v4.1 N4 addendum 반영)

- SDK 1.68 `HttpRetryOptions` 필드명 `attempts` (not `max_attempts`) — dev-log 25 실측.
- embedder 의 "429 제외 + 5xx/408 만 3회 재시도" 패턴이 canonical. `retry_429=False` flag 로 재현.
- Batch API 는 기본 retry (429 포함) — Batch 엔드포인트는 RPM 압박이 낮고 장기 작업이라 SDK 자동 재시도가 유익.

## 테스트 결과

### 팩토리 단위 테스트 (7 PASS)

- `test_default_creates_client` — retry_429=True 기본 동작
- `test_restricted_mode_creates_client` — retry_429=False 동작
- `test_same_flag_returns_cached_instance` — `@lru_cache` 검증
- `test_different_flags_return_different_instances` — 두 인스턴스 분리
- `test_cache_cleared_creates_new_instance` — clear_cache() 동작
- `test_retry_options_fields` — attempts/initial_delay/max_delay/http_status_codes
- `test_429_is_excluded` — 핵심 invariant (429 ∉ status_codes)

### 기존 테스트 비회귀

- `test_embedder.py` 4 PASS
- `test_batch_embedder.py` 2 PASS
- `test_gemini_stream.py` 4 PASS

### 전체 suite (`uv run pytest`)

**352 passed + 1 xfailed + 190 warnings** (28.99s). 팩토리 교체로 인한 회귀 0건.

## 효과

- 모킹 포인트 1곳으로 일원화 가능 (향후 테스트 리팩토링 시 `src.common.gemini_client.get_client` 패치).
- 새 클라이언트 변형 추가 시 팩토리만 확장 (다른 모듈 건드리지 않음).
- retry 정책 변경 시 `_build_restricted_http_options` 한 함수만 수정.

## 후속 (이번 세션 범위 밖)

- 플랜 §13.1 에 언급된 `EmbeddingProvider` / `LLMProvider` **Protocol 도입**은 **R1/R2 본 리팩토링** 맥락. 현재는 전역 `_client` 모듈 싱글턴 + 함수 API 형태. Protocol + FastAPI Depends 주입 전환은 생성자 주입 아키텍처 도입과 함께 진행.
- 기존 테스트 mock 경로를 `_client` → `gemini_client.get_client` 로 이전하는 정리는 작동 중에 영향 없으므로 후순위.

## 다음 단계

- 부수 S3 프론트 챗봇 폼 중복 제거 (§13.3) — 이번 세션 마지막 작업.
