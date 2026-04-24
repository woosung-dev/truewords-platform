# SDK 실측 — google-genai HttpRetryOptions + qdrant-client payload_schema

- **작성일**: 2026-04-24
- **상태**: 실측 완료 (Δ 6건 발견 — 방향 변경 아님, 정밀화)
- **관련 파일**: `backend/src/pipeline/embedder.py`, `backend/src/qdrant_client.py`, 플랜 §19.1 S1, §21.7 B2

## 왜

R1/R2/R3 아키텍처 리팩토링(플랜 `sleepy-sleeping-summit.md`)의 선행 체크리스트 5개 중 **#1 SDK 실측**. §19.1 S1(Gemini 클라이언트 단일화)과 §21.7 B2(Qdrant payload_index idempotency)의 설계를 SDK 실제 스키마에 맞춰 확정하기 위해 수행. 브랜치: `refactor/runtime-config-prep`.

실측 명령은 모두 REPL/heredoc 1회성으로 실행 — 커밋에 포함하지 않음. 결과 스니펫만 이 문서에 인용.

---

## 1. google-genai 실측 결과

### 1.1 버전
- 선언: `backend/pyproject.toml` L9 — `google-genai>=0.8.0`
- 실제 설치: **1.68.0** (`backend/.venv/...`)
- 의미: 실측을 위해 참조한 "0.8.x" 가정은 선언 하한에 불과. 실제는 major 버전 상위로, 스키마도 1.x 계열 기준으로 봐야 함.

### 1.2 `HttpRetryOptions` 공식 스키마 (v1.68)
Pydantic V2 모델. `model_config`가 extra 금지(`Extra forbidden`)이므로 알 수 없는 필드 전달 시 즉시 ValidationError.

| 필드명 (Python) | 타입 | 기본값 | 필수 |
|-----------------|------|--------|------|
| `attempts` | `Optional[int]` | `None` | N |
| `initial_delay` | `Optional[float]` | `None` | N |
| `max_delay` | `Optional[float]` | `None` | N |
| `exp_base` | `Optional[float]` | `None` | N |
| `jitter` | `Optional[float]` | `None` | N |
| `http_status_codes` | `Optional[list[int]]` | `None` | N |

생성자 시그니처는 `camelCase` 별칭 사용 (`initialDelay`, `maxDelay`, `expBase`, `httpStatusCodes`) — Pydantic alias. Python 측에서는 snake_case로 접근.

### 1.3 `HttpOptions.retry_options` 필드 타입
```
retry_options: Optional[google.genai.types.HttpRetryOptions] = None
```
- 객체(`HttpRetryOptions(...)`) 또는 dict 모두 허용 (Pydantic이 dict → model 자동 변환).
- **단 dict 키는 Python 필드명(`attempts`)이어야 함.** `max_attempts` 같은 오필드는 거부.

### 1.4 시도 결과 매트릭스

| # | 입력 | 결과 |
|---|------|------|
| 1 | `HttpRetryOptions(attempts=3, initial_delay=1.0, max_delay=10.0, http_status_codes=[408,500,502,503,504])` | **OK** — 현재 `embedder.py` 구문 그대로 유효 |
| 2 | `HttpRetryOptions(max_attempts=0)` | **ValidationError** — `max_attempts` 필드 없음 (`extra_forbidden`) |
| 3 | `HttpRetryOptions(attempts=0)` | **OK** — 재시도 완전 비활성 시 사용 가능 |
| 4 | `HttpOptions(retry_options={"max_attempts": 0})` | **ValidationError** — 같은 이유로 거부 |
| 5 | `HttpOptions(retry_options={"attempts": 0})` | **OK** — dict 방식도 가능하지만 키는 `attempts` |
| 6 | `HttpOptions(retry_options=HttpRetryOptions(attempts=3, ...))` | **OK** — 현재 `embedder.py` 초기화 구조 그대로 유효 |

### 1.5 현재 `embedder.py` 설정 재평가
`backend/src/pipeline/embedder.py` L24–35의 아래 구문은 **SDK 1.68에서 유효하며 의도대로 작동**:
```python
_retry_options = types.HttpRetryOptions(
    attempts=3,
    initial_delay=1.0,
    max_delay=10.0,
    http_status_codes=[408, 500, 502, 503, 504],
)
_client = genai.Client(
    api_key=...,
    http_options=types.HttpOptions(retry_options=_retry_options),
)
```
- 429를 목록에서 제외 → SDK 내부 재시도는 5xx·408만 수행. ingestor.py의 직접 제어 유효.
- **§19.1 S1 설계 시 "retry 제어 방식 변경"은 필요 없음**. 동일 패턴을 단일화된 클라이언트 팩토리로 모으기만 하면 됨.

### 1.6 미확인 항목
- 실제 429/5xx 네트워크 응답에서 SDK 내부 tenacity가 설정대로 재시도하는지의 **엔드투엔드 재현**은 본 실측 범위 아님 (네트워크 mock 구성 필요). 설정은 유효하지만 SDK 구현 신뢰는 Step §19.1 S1 구현 시점에 통합 테스트로 재확인 권장.

---

## 2. qdrant-client 실측 결과

### 2.1 버전
- 선언: `backend/pyproject.toml` L8 — `qdrant-client[fastembed]>=1.12.0`
- 실제 설치: **1.17.1**
- 로컬 Qdrant: `qdrant/qdrant:latest` 컨테이너 (`backend-qdrant-1`), 포트 6333/6334, 본 실측에서 새로 기동.

### 2.2 `CollectionInfo.payload_schema` 구조
- 타입: **`dict[str, PayloadIndexInfo]`** — 즉시 키 접근 가능. `.config.params.*` 같은 중첩 경로가 아님.
- `PayloadIndexInfo` 필드: `data_type`, `params`, `points`.

예시:
```
payload_schema = {
    'idx_test': PayloadIndexInfo(data_type=<PayloadSchemaType.INTEGER: 'integer'>, params=None, points=0),
    'src_test': PayloadIndexInfo(data_type=<PayloadSchemaType.KEYWORD: 'keyword'>, params=None, points=0),
}
```

### 2.3 `data_type`의 파이썬 타입
- **`PayloadSchemaType` enum** (문자열 아님).
- `type(entry.data_type).__name__ == 'PayloadSchemaType'`, `isinstance(entry.data_type, PayloadSchemaType) == True`.
- 값 비교: `entry.data_type == PayloadSchemaType.KEYWORD` → True.
- `str(entry.data_type)` → `'keyword'` (enum value).
- 운영 코드에서는 **enum 비교 또는 `.value` 추출을 사용**. 문자열 직접 비교(`== "keyword"`)는 **False** — 주의.

### 2.4 `create_payload_index` idempotency
서버 1회 실측, 두 가지 경우:

| 시나리오 | 결과 |
|----------|------|
| 같은 필드 + 같은 schema (KEYWORD → KEYWORD) | 에러 없음, `UpdateStatus.COMPLETED` 반환 |
| 같은 필드 + **다른 schema** (KEYWORD → INTEGER) | 에러 없음, `UpdateStatus.COMPLETED` 반환 |

→ Qdrant 서버 레벨에서 이미 idempotent. 단 **schema 덮어쓰기도 조용히 허용**되므로 코드가 의도치 않게 다른 schema로 호출하면 detection이 어렵다.

---

## 3. v4.1 설계와의 Δ

| # | 출처 | Δ 내용 | 영향 섹션 | 심각도 |
|---|------|--------|-----------|--------|
| Δ1 | 플랜 / 지시서 가정 | "SDK 0.8.x" → 실제 **1.68.0** (major 차이) | §19.1 S1 | 정보 |
| Δ2 | 지시서 `max_attempts` | **필드 없음** — 공식은 `attempts`. ValidationError. | §19.1 S1 | 중간 — 설계 문서 오타 수정 대상 |
| Δ3 | 지시서 dict 방식 `{"max_attempts":0}` | 거부됨. 올바른 형태는 `{"attempts":0}` 또는 `HttpRetryOptions(attempts=0)` | §19.1 S1 | 중간 |
| Δ4 | "B2 idempotency 체크" 설계 | `payload_schema`는 `dict[str, PayloadIndexInfo]` 직접 접근. `.config.params.*` 경로 아님 | §21.7 B2 | 정보 |
| Δ5 | "B2 idempotency 체크" 설계 | `data_type`은 **PayloadSchemaType enum** — 문자열 비교 금지 | §21.7 B2 | 중간 — 체크 로직 구현 시 enum 비교 필수 |
| Δ6 | "B2 idempotency 체크" 설계의 **필요성** | Qdrant 서버가 이미 idempotent. 단순 "이미 존재하면 skip" 로직은 **불필요**. 다만 schema drift 방지를 원하면 사전 조회로 명시 체크가 여전히 유의미 | §21.7 B2 | 큼 — 설계 목적 재정의 |

**해석**: 6건 중 설계 방향을 뒤집는 항목은 없음. Δ2/Δ3은 지시서 오타 정정, Δ1/Δ4/Δ5는 구현 디테일 교정, **Δ6만 설계 목적 재조정** — 즉 "idempotency 담보"가 아니라 "schema drift 탐지"로 B2의 목적을 재명시하면 됨.

**현재 `embedder.py` 구문은 SDK와 완전 호환** — §19.1 S1의 스코프는 "retry 설정 변경"이 아닌 "여러 곳에 흩어진 클라이언트 초기화를 팩토리로 단일화"로 축소 가능.

---

## 4. 다음 단계

1. **사용자 판단 요청** — 플랜 원칙 "3개 이상 Δ → 즉시 중단" 발동 상태. 위 6건이 방향 변경이 아닌 정밀화이므로 **플랜 §19.1 S1 / §21.7 B2 문구 소폭 수정 후 선행 #2(Staging 분리)로 진행** 제안.
2. **플랜 파일 업데이트 범위 (별도 세션 / 사용자 승인 후)**:
   - §19.1 S1 — 현재 `embedder.py` 패턴을 canonical로 채택, 필드명 `attempts`로 고정, 버전 "0.8.x" 표기 → "`>=0.8.0`, 실측 기준 1.68.0"
   - §21.7 B2 — "idempotency 체크" → "**schema drift 탐지**"로 목적 재정의. 구현은 `info.payload_schema[field].data_type == PayloadSchemaType.X` enum 비교.
3. **남은 선행 작업 4개**: #2 Staging 분리 → #3 Qdrant 1,000건 dry-run → #4 Alembic advisory lock PoC → #5 품질 게이트 기준선. 별도 세션.

---

## 부록 A — 실측 재현 스니펫 (commit 제외)

Gemini 실측:
```bash
cd backend && uv run python - <<'PY'
from google.genai import types
import inspect
print(types.HttpRetryOptions.model_fields)
print(inspect.signature(types.HttpRetryOptions))
print(types.HttpOptions.model_fields["retry_options"])
# 시도: attempts=3 / max_attempts=0 / attempts=0 / dict 2종 / wrapper 1종
PY
```

Qdrant 실측:
```bash
docker compose -f backend/docker-compose.yml up -d qdrant
uv run python - <<'PY'
import asyncio
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import VectorParams, Distance, PayloadSchemaType

async def main():
    c = AsyncQdrantClient(url="http://localhost:6333")
    coll = "_sdk_survey_probe"
    try: await c.delete_collection(coll)
    except: pass
    await c.create_collection(coll, vectors_config={"dense": VectorParams(size=4, distance=Distance.COSINE)})
    await c.create_payload_index(coll, "src_test", field_schema=PayloadSchemaType.KEYWORD)
    info = await c.get_collection(coll)
    print(type(info.payload_schema).__name__, info.payload_schema)
    entry = info.payload_schema["src_test"]
    print(type(entry.data_type).__name__, entry.data_type, entry.data_type == PayloadSchemaType.KEYWORD)
    # 재호출 idempotency
    await c.create_payload_index(coll, "src_test", field_schema=PayloadSchemaType.KEYWORD)  # OK
    await c.create_payload_index(coll, "src_test", field_schema=PayloadSchemaType.INTEGER)  # OK (덮어쓰기 허용)
    await c.delete_collection(coll)
    await c.close()

asyncio.run(main())
PY
```
