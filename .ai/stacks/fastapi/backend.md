---
paths: ["backend/**/*"]
---

# Backend Rules (FastAPI + SQLModel)

> audit 2차 (2026-05-15) Sub-PR E 후속 보완. SENSITIVE_PATTERNS 로드맵 + cache
> schema propagation rule 명문화. 상세 §11.

---

## 1. Tech Stack

| 항목           | 기술                                          |
| -------------- | --------------------------------------------- |
| Framework      | FastAPI (100% Async)                          |
| ORM            | SQLModel + SQLAlchemy 2.0 (`asyncpg`)         |
| Validation     | Pydantic V2 + `pydantic-settings`             |
| Package Manager| `uv`                                          |
| Database       | PostgreSQL (운영 데이터 전용: 사용자, 로그, 설정) |
| Auth           | Custom JWT (python-jose + bcrypt, HttpOnly Cookie) |
| AI             | Google Gemini 2.5 Flash/Pro (`google-genai` SDK) |
| Vector DB      | Qdrant (`qdrant-client`, 하이브리드 검색)     |
| Embedding      | Gemini text-embedding (1536 dims)             |
| 배포           | GCP Cloud Run + Docker                        |

---

## 2. 핵심 제약 사항 (Strict Rules)

### Pydantic V2 필수 패턴

- `BaseSettings`는 반드시 `pydantic_settings`에서 임포트 (pydantic 내부 금지)
- `.dict()` 대신 `.model_dump()`, `.model_dump_json()`
- `@root_validator` 대신 `@model_validator(mode="after")`

### 100% 비동기 SQLModel

- `session.exec()` 절대 금지
- `await session.execute(select(...))` 후 `.scalars().all()` 또는 `.scalar_one_or_none()`
- N+1 방지: `options(selectinload(...))`

### SecretStr

- API 키, DB 패스워드 등 → `SecretStr` 타입
- 사용 시 `.get_secret_value()`

### Admin JWT 인증

Admin 대시보드 인증은 HttpOnly Cookie 기반 JWT를 사용한다. (Clerk 미사용)

```python
# admin/auth.py
import bcrypt
from jose import JWTError, jwt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.admin_jwt_expire_minutes)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.admin_jwt_secret.get_secret_value(), algorithm=settings.admin_jwt_algorithm)

# admin/dependencies.py — HttpOnly Cookie에서 JWT 추출
async def get_current_admin(request: Request) -> AdminUser:
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401)
    payload = decode_access_token(token)
    ...
```

---

## 3. Architecture (도메인 모듈러 — Router / Service / Repository)

**핵심: AsyncSession은 Repository만 보유한다.**

```
[domain]/
├── router.py        # HTTP 전용 (얇게 유지)
├── service.py       # 비즈니스 로직 (AsyncSession 보유 금지)
├── repository.py    # DB 접근 전담 (AsyncSession 유일 보유자)
├── schemas.py       # Pydantic V2 입출력
├── models.py        # SQLModel 테이블
├── dependencies.py  # Depends() 조립 (repo → service)
└── exceptions.py    # 도메인 예외
```

### 레이어 규칙

- **Router** — HTTP 수신, 스키마 검증, service 호출만. DB 접근/비즈니스 로직 금지.
- **Service** — 비즈니스 로직 + 트랜잭션 경계. AsyncSession import 절대 금지. Repository만 생성자 주입.
- **Repository** — AsyncSession 유일 보유. DB 접근만. commit()은 service 요청으로만.
- **Dependencies** — Depends() 조립의 유일한 위치. service.py/repository.py에 Depends import 금지.

### Stage 패턴 (도메인 sub-package, 선택적 5계층)

복잡한 오케스트레이션 (예: chat RAG 9~13단계 파이프라인) 은 도메인 안에 Stage
sub-package 를 둘 수 있다. 본 형식은 audit (2026-05-15) 에서 명문화됐다.

```
chat/
├── service.py            # Stage 체인 오케스트레이터 (Stage 생성자 주입)
├── pipeline/
│   ├── context.py        # Stage 간 공유 mutable 컨텍스트 (dataclass)
│   ├── state.py          # PipelineState FSM (logging-only)
│   ├── stage.py          # Stage Protocol
│   └── stages/
│       ├── <name>.py     # 각 Stage 클래스 — execute(ctx) -> ctx 단일 메서드
│       └── ...
```

- Stage 는 자체적으로 Repository / 외부 client 를 주입받을 수 있다.
- Service 는 Stage 인스턴스 생성 + 순서 조율 + 트랜잭션 경계만 담당.
- mini-persist 등 cache-hit early return 류 짧은 경로는 Service 의 helper 로
  캡슐화 (Stage 분리 부담을 피하면서 inline 중복 제거).

### 필수 코드 패턴

```python
# router.py
@router.post("/items", response_model=ItemResponse, status_code=201)
async def create_item(
    data: CreateItemRequest,
    service: ItemService = Depends(get_item_service),
) -> ItemResponse:
    return await service.create_item(data)

# service.py — AsyncSession import 금지
class ItemService:
    def __init__(self, repo: ItemRepository) -> None:
        self.repo = repo

    async def create_item(self, data: CreateItemRequest) -> ItemResponse:
        item = Item.model_validate(data)
        saved = await self.repo.save(item)
        await self.repo.commit()
        return ItemResponse.model_validate(saved)

# repository.py
class ItemRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def save(self, item: Item) -> Item:
        self.session.add(item)
        await self.session.flush()
        return item

    async def commit(self) -> None:
        await self.session.commit()

# dependencies.py
async def get_item_repository(
    session: AsyncSession = Depends(get_async_session),
) -> ItemRepository:
    return ItemRepository(session)

async def get_item_service(
    repo: ItemRepository = Depends(get_item_repository),
) -> ItemService:
    return ItemService(repo)
```

### 크로스 레포지토리 트랜잭션

여러 Repository가 하나의 트랜잭션으로 묶여야 할 때, **동일 session**을 공유한다.
개별 Repository에서 commit하지 않고, **조율하는 Service에서 한 번만 commit**한다.

```python
# dependencies.py — 동일 session을 여러 repo에 주입
async def get_order_service(
    session: AsyncSession = Depends(get_async_session),
) -> OrderService:
    return OrderService(
        order_repo=OrderRepository(session),
        payment_repo=PaymentRepository(session),  # 동일 session
    )

# service.py — 마지막에 한 번만 commit
class OrderService:
    def __init__(self, order_repo: OrderRepository, payment_repo: PaymentRepository):
        self.order_repo = order_repo
        self.payment_repo = payment_repo

    async def create_order_with_payment(self, data: CreateOrderRequest):
        order = await self.order_repo.save(Order(...))
        payment = await self.payment_repo.save(Payment(...))
        await self.order_repo.commit()  # 한 번만 — 같은 session이므로 둘 다 커밋됨
        return order
```

**원칙:** 여러 repo를 묶는 service는 `dependencies.py`에서 동일 session으로 조립.

---

## 4. Gemini API 패턴

- 모든 Gemini 호출은 `common/gemini*` 모듈을 통해 일원화한다.
  - `common/gemini.py` — high-level API (embed_dense_*, generate_text, generate_text_stream).
  - `common/gemini_client.py` — `genai.Client` 팩토리 (`@lru_cache` 싱글톤,
    retry policy `retry_429=True/False` 분기). pipeline/embedder 가 다른 retry
    정책의 변형 클라이언트를 필요로 해서 분리됐다 (audit 2026-05-15 명문화).
- 시스템 프롬프트는 `chat/prompt.py`에 정의. 인라인 작성 금지.

### 클라이언트 설정

```python
from google import genai
from src.config import settings

client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())
```

### 모델 선택

```python
# 텍스트 생성 (답변, 스트리밍, 리랭킹, 쿼리 재작성)
MODEL_GENERATE = "gemini-3.1-flash-lite"

# 임베딩
MODEL_EMBEDDING = "gemini-embedding-001"
```

### 텍스트 생성 / 스트리밍

```python
# common/gemini.py — 비동기 aio 클라이언트 사용
async def generate_text(prompt: str, system_instruction: str = "", model: str = MODEL_FLASH) -> str:
    config = types.GenerateContentConfig()
    if system_instruction:
        config = types.GenerateContentConfig(system_instruction=system_instruction)
    response = await _client.aio.models.generate_content(model=model, contents=prompt, config=config)
    return response.text

async def generate_text_stream(prompt: str, system_instruction: str = "", model: str = MODEL_FLASH) -> AsyncGenerator[str, None]:
    async for chunk in _client.aio.models.generate_content_stream(model=model, contents=prompt, config=config):
        if chunk.text:
            yield chunk.text
```

---

## 5. 파일 업로드 처리

현재 파일 업로드는 `NamedTemporaryFile`로 임시 저장 후 BackgroundTask로 처리한다.
외부 스토리지(R2, S3 등)는 현재 미사용.

```python
# admin/data_router.py — 파일 업로드 + 백그라운드 처리
@router.post("/admin/data-sources/upload", status_code=202)
async def upload_document(
    file: UploadFile,
    background_tasks: BackgroundTasks,
):
    # 임시 파일 저장 → 백그라운드 텍스트 추출 + 청킹 + 임베딩 + Qdrant 적재
    ...
```

---

## 6. SSE 스트리밍 응답

3가지 이벤트 타입으로 구성: `chunk` (텍스트 조각), `sources` (출처 + 세션 ID), `done` (면책 고지).

```python
# chat/router.py
@router.post("/chat/stream")
async def chat_stream(request: ChatRequest, service: ChatService = Depends(get_chat_service)):
    return StreamingResponse(
        service.process_chat_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# chat/service.py — 3가지 SSE 이벤트 yield
async def process_chat_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
    # 검색 + Re-ranking (스트림 시작 전 블로킹)
    ...
    # LLM 스트리밍 응답 → chunk 이벤트
    async for text in generate_text_stream(prompt, system_prompt):
        yield f"event: chunk\ndata: {json.dumps({'text': text}, ensure_ascii=False)}\n\n"

    # 출처 + 메타데이터 → sources 이벤트
    yield f"event: sources\ndata: {json.dumps({'sources': sources_data, 'session_id': str(session.id), 'message_id': str(msg.id)}, ensure_ascii=False)}\n\n"

    # 면책 고지 → done 이벤트
    yield f"event: done\ndata: {json.dumps({'disclaimer': DISCLAIMER}, ensure_ascii=False)}\n\n"
```

---

## 7. Qdrant 벡터 검색

### 클라이언트 설정

```python
# src/qdrant_client.py — 싱글톤 클라이언트 (src/ 루트에 위치)
from qdrant_client import AsyncQdrantClient
from src.config import settings

_async_client: AsyncQdrantClient | None = None

def get_async_client() -> AsyncQdrantClient:
    global _async_client
    if _async_client is None:
        _async_client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None,
        )
    return _async_client
```

### 컬렉션 구조

현재 2개 컬렉션 운영:

```python
# config.py 기준
settings.collection_name = "malssum_poc"        # 말씀 본문 (sparse + dense)
settings.cache_collection_name = "semantic_cache" # Semantic Cache (dense only)
```

> **참고:** 아키텍처 문서(doc 02)에는 dictionary_collection, wonri_collection도 계획되어 있으나,
> 현재 구현은 단일 malssum 컬렉션 + 카테고리(source) 필터링 방식.

### Payload 스키마

```python
# pipeline/ingestor.py — 실제 적재 포맷
payload = {
    "text": "말씀 본문...",
    "volume": "001권",              # 권 이름 (문자열)
    "chunk_index": 0,               # 청크 순서 번호
    "source": ["A"],                # 데이터 소스 식별자 (리스트)
    "title": "제목",                # 추출된 제목
    "date": "1956년 10월 3일",      # 추출된 날짜
}
```

### 하이브리드 검색 (sparse + dense)

```python
# search/hybrid.py
from qdrant_client.models import (
    FieldCondition, Filter, MatchAny,
    Prefetch, FusionQuery, Fusion,
)

async def hybrid_search(
    qdrant: AsyncQdrantClient,
    query_dense: list[float],
    query_sparse: SparseVector,
    source_filter: list[str] | None = None,  # ["A", "B"] 소스 필터
    top_k: int = 50,
) -> list[SearchResult]:
    filter_conditions = None
    if source_filter:
        filter_conditions = Filter(
            must=[FieldCondition(key="source", match=MatchAny(any=source_filter))]
        )

    results = await qdrant.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=query_sparse, using="sparse", limit=top_k),
            Prefetch(query=query_dense, using="dense", limit=top_k),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        query_filter=filter_conditions,
        limit=top_k,
    )
    return [SearchResult(...) for point in results.points]
```

### 금지 사항
- 임베딩 차원은 1536 고정 (gemini-embedding-001 기준)
- Qdrant 호출은 반드시 `get_async_client()` 싱글톤 사용

---

## 8. 비동기 장기 작업 패턴

수초 이상 걸리는 작업(AI 처리, 파일 변환 등)은 HTTP 응답을 블로킹하지 않는다.

### FastAPI BackgroundTasks (단순 작업)

```python
from fastapi import BackgroundTasks

@router.post("/process", status_code=202)
async def start_processing(
    data: ProcessRequest,
    background_tasks: BackgroundTasks,
    service: ProcessService = Depends(get_process_service),
):
    task_id = await service.create_task(data)
    background_tasks.add_task(service.run_pipeline, task_id)
    return {"task_id": task_id, "status": "processing"}
```

### 상태 폴링 (클라이언트)

```python
@router.get("/process/{task_id}/status")
async def get_status(
    task_id: str,
    service: ProcessService = Depends(get_process_service),
):
    return await service.get_task_status(task_id)
```

**원칙:**
- 장기 작업은 `202 Accepted` + `task_id` 반환
- 클라이언트는 polling 또는 WebSocket으로 상태 확인
- DB에 `status` 컬럼으로 진행 상태 관리 (`processing | completed | failed`)

---

## 9. DB 마이그레이션 (Alembic)

```bash
# 마이그레이션 생성
alembic revision --autogenerate -m "add action_items table"

# 마이그레이션 적용
alembic upgrade head

# 롤백
alembic downgrade -1
```

### 규칙

- `models.py` 변경 시 **반드시** Alembic 마이그레이션 생성
- 마이그레이션 파일은 커밋에 포함 (자동 생성 후 검토)
- 프로덕션 배포 전 `alembic upgrade head` 자동 실행 (Docker entrypoint)
- 데이터 삭제/컬럼 삭제는 **2단계 배포**: (1) 코드에서 사용 중단 → (2) 다음 배포에서 삭제

---

## 10. 백엔드 폴더 구조

audit (2026-05-15) 갱신 — 1 도메인 다중 router 패턴 (admin / chat / datasource)
허용 명문화. `pipeline/batch_*.py` + `progress.py` 제거 (PR #95 이후 실재 없음).
`qdrant/` 패키지로 통합 (`qdrant_client.py` 는 deprecation shim 잔존).

```
backend/src/
├── admin/              # Admin 인증 (JWT+bcrypt) + 대시보드 API + 분석
│   ├── auth.py             # JWT 생성/검증, bcrypt 해싱
│   ├── dependencies.py     # get_current_admin, CSRF 검증, 도메인 서비스 조립
│   ├── models.py           # AdminUser, AdminAuditLog
│   ├── repository.py
│   ├── service.py          # 인증 + 감사 로그 비즈니스
│   ├── analytics_repository.py / analytics_service.py / analytics_router.py
│   │                       # /admin/analytics/* (대시보드 통계 — 다중 router 패턴)
│   ├── router.py           # /admin/auth/*, /admin/users
│   ├── data_router.py      # /admin/data-sources/* HTTP endpoint
│   ├── ingest_service.py   # 파일 처리 본체 (extract/chunk/embed/ingest)
│   └── ingest_worker.py    # Queue + worker thread + main loop 참조
├── chat/               # 채팅 도메인 (RAG 파이프라인 오케스트레이션)
│   ├── service.py          # Stage 체인 오케스트레이터 (mini-persist helper 포함)
│   ├── prompt.py           # 시스템 프롬프트 + 핵심 용어 정의
│   ├── generator.py        # 동기 답변 생성
│   ├── stream_generator.py # SSE 스트리밍 답변 생성
│   ├── pipeline/           # Stage sub-package (context / state / stage / stages)
│   ├── reactions_*.py      # 답변 반응 sub-feature (router/service/repo/schemas)
│   └── router.py           # /chat, /chat/stream, /chat/feedback
├── chatbot/            # 챗봇 버전 관리 (A|B 조합 필터)
├── search/             # 검색 엔진 (하이브리드, 캐스케이딩, 리랭킹)
│   ├── hybrid.py           # Dense + Sparse RRF 융합
│   ├── cascading.py        # 다중 티어 순차 검색
│   ├── reranker.py         # Gemini LLM 리랭킹
│   ├── query_rewriter.py   # 종교 용어 기반 쿼리 재작성
│   └── fallback.py         # 2단계 폴백 (완화 검색 + LLM 제안)
├── pipeline/           # 데이터 파이프라인 (임베딩, 청킹, 적재)
│   ├── embedder.py         # Dense/Sparse 임베딩 생성
│   ├── chunker.py          # Recursive 청킹 (운영) + legacy chunkers
│   ├── extractor.py        # 텍스트 추출 (PDF/DOCX/TXT)
│   ├── ingestor.py         # Qdrant 적재 (RPD 관리, 체크포인트)
│   ├── ingestion_*.py      # IngestionJob model/repo/service (즉시 모드 적재 작업)
│   └── metadata.py         # extract_metadata + book_series 분류
├── cache/              # Semantic Cache (Qdrant 기반)
├── datasource/         # 데이터 소스 카테고리 관리 + Qdrant 직접 조작
│   ├── router.py / chunks_router.py
│   ├── service.py / qdrant_service.py
│   ├── repository.py / dependencies.py / schemas.py
│   └── chunk_merge.py
├── safety/             # 보안 레이어
│   ├── input_validator.py  # 프롬프트 인젝션 탐지
│   ├── rate_limiter.py     # IP 기반 슬라이딩 윈도우
│   ├── output_filter.py    # 면책 고지 + 민감 인명 필터 + StreamingSanitizer
│   ├── middleware.py       # check_rate_limit Depends
│   └── exceptions.py       # InputBlockedError, RateLimitExceededError
├── qdrant/             # Qdrant 통합 모듈 (audit P0-7 갱신)
│   ├── factory.py          # 클라이언트 팩토리 (raw httpx + SDK 호환)
│   ├── startup.py          # ensure_main_collection (raw httpx idempotent)
│   ├── raw_client.py       # RawQdrantClient (HTTP/1.1 SDK 우회)
│   └── filters.py          # Filter / Prefetch / FusionQuery dict 헬퍼
├── qdrant_client.py    # [DEPRECATED shim] backend/scripts + tests 호환
├── common/
│   ├── database.py         # PostgreSQL AsyncSession 팩토리
│   ├── gemini.py           # Gemini high-level API
│   ├── gemini_client.py    # `genai.Client` 팩토리 (retry 분기)
│   ├── ingestion_facade.py # chat 도메인용 cross-domain ingestion thin wrapper
│   ├── schemas.py          # ErrorResponse (통합 에러 포맷)
│   ├── exception_handlers.py # 전역 예외 핸들러 (503, 429, 400, 500)
│   └── middleware.py       # RequestIdMiddleware (X-Request-Id 추적)
└── config.py           # Pydantic Settings (환경변수, GEMINI_TIER 프리셋)
```

### 1 도메인 다중 router 패턴

기본은 도메인당 `router.py` 1개. 다만 다음 두 경우엔 sub-feature 별 분리를 허용한다.

1. **admin 의 운영 영역 분리** — `admin/analytics_router.py`, `admin/data_router.py`
   등. 인증/사용자 관리와 분석/적재의 책임이 명확히 다름.
2. **chat sub-feature** — `chat/reactions_router.py` 처럼 별도 prefix + 별도 DB
   테이블 + hot/cold path 가 분리된 경우.

이때 sub-feature 마다 매칭되는 `*_service.py`, `*_repository.py`, `*_schemas.py`
도 분리한다. dependencies 는 `admin/dependencies.py` / `chat/dependencies.py`
1곳에 모아둔다.

---

## 11. 보안 / Safety 운영 규칙 (audit 2차 S6 신설)

### 11.1 SENSITIVE_PATTERNS 로드맵

`backend/src/safety/output_filter.py:SENSITIVE_PATTERNS` 는 응답 PII 차단의 단일
정의. audit 2차 S-6 (2026-05-15) 시점 5종 + 도메인 인명 보류:

| 영역 | 패턴 | 상태 | 정합화 단계 |
|------|------|------|-------------|
| 한국 주민등록번호 | `\d{6}-[1-4]\d{6}` | ✅ PoC | 1차 audit P0-1 |
| 한국 휴대전화 | `01[016789][-\s]?\d{3,4}[-\s]?\d{4}` | ✅ PoC | 1차 audit P0-1 |
| 카드번호 | `\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}` | ✅ PoC | 1차 audit P0-1 |
| 이메일 | `[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}` | ✅ PoC | **2차 audit S-6** |
| 한국 주소 | 시/도 + 시/군/구 + 동/읍/면 동시 | ✅ PoC (보수적) | **2차 audit S-6** |
| 종교 도메인 인명/사건 | `(보류)` | ⏳ trigger | 도메인 전문가 자문 |
| 신용/금융 식별자 (계좌·SSN) | `(보류)` | ⏳ trigger | PoC → 실 운영 전환 시점 |

### 11.2 추가 시 결정 점검

신규 패턴 추가 시 다음 3 가지 결정 명시:

1. **false positive 위험** — 운영 본문에서 등장 빈도 측정. 0.1% 초과면 보수적
   변형 또는 컨텍스트 조건 (이메일·주소 case 와 동일 분리).
2. **결정 로그 갱신** — `docs/dev-log/<num>-second-audit-auto-decisions.md` 또는
   동급 audit log row 에 추가. drift (결정 로그 vs 실 구현) 방지.
3. **회귀 테스트** — `tests/test_output_filter.py::TestFilterSensitiveNames` 에 차단
   case + false positive 보존 case 둘 다 추가.

### 11.3 Cache schema propagation rule

`chat/schemas.Source` 응답 schema 와 `PersistStage.execute` 의
`sources_for_cache` dict 는 동기화되어야 한다 — neglection 시 cache hit 응답이
신규 필드 누락 (PR #71 P0-B chunk_id 누락 사례).

- Source 에 신규 필드 추가 시 두 선택지 중 하나 명시:
  - cache propagation: `sources_for_cache` dict 에 동일 키 추가
  - 화이트리스트 등록: `tests/test_cache_schema_propagation.CACHE_EXCLUDED_FIELDS`
    에 추가 + cache 분리 의도를 docstring 코멘트로 보존
- 회귀 guard test (`test_cache_schema_propagation.py`) 는 두 화이트리스트 정합성
  자동 검증. drift 시 CI fail.

### 11.4 Rate limiter / 멀티 worker 정책

`safety/rate_limiter.RateLimiter` 는 in-memory 카운터 → 단일 워커 가정. Cloud Run
scale-out (또는 uvicorn `--workers>1`) 시점 다음 옵션:

1. **Redis cluster** (권장) — INCR + EXPIRE 패턴, strict.
2. **Cloud Memorystore** — token bucket / leaky bucket.
3. **Cloud Armor** — infra 단 rate limiting (HTTPS Load Balancer).

본 클래스의 process-local 가정에 의존하는 호출자 (`safety/middleware
.check_rate_limit`) 는 그대로 유지. 교체 시 `get_rate_limiter()` factory 만 swap.
