---
paths: ["backend/**/*"]
---

# Backend Rules (FastAPI + SQLModel)

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
from passlib.context import CryptContext
from jose import jwt

pwd_context = CryptContext(schemes=["bcrypt"])

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_access_token(data: dict) -> str:
    return jwt.encode(data, settings.admin_jwt_secret.get_secret_value(), algorithm="HS256")

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

- 모든 Gemini 호출은 `common/gemini.py`에 집중 관리
- 시스템 프롬프트는 `chat/prompt.py`에 정의. 인라인 작성 금지.

### 클라이언트 설정

```python
from google import genai
from src.config import settings

client = genai.Client(api_key=settings.gemini_api_key.get_secret_value())
```

### 모델 선택

```python
# 일반 답변 (속도 우선)
MODEL_FLASH = "gemini-2.5-flash"

# 심층 분석 (품질 우선)
MODEL_PRO = "gemini-2.5-pro"
```

### 스트리밍 생성

```python
async def stream_generate(prompt: str, model: str = MODEL_FLASH):
    response = client.models.generate_content_stream(
        model=model,
        contents=prompt,
    )
    for chunk in response:
        yield chunk.text
```

### JSON 모드

```python
response = client.models.generate_content(
    model=MODEL_FLASH,
    contents=prompt,
    config={
        "response_mime_type": "application/json",
    },
)
```

### Context Caching (정적 콘텐츠)

원리강론, 대사전 등 변경 빈도가 낮은 대용량 콘텐츠는 Context Caching 활용.

```python
from google.genai import types

cache = client.caches.create(
    model=MODEL_FLASH,
    contents=[large_static_content],
    config=types.CreateCachedContentConfig(
        display_name="wonri-gangron-cache",
        ttl="3600s",
    ),
)

# 캐시된 컨텍스트로 생성
response = client.models.generate_content(
    model=MODEL_FLASH,
    contents=user_question,
    config=types.GenerateContentConfig(
        cached_content=cache.name,
    ),
)
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

```python
from fastapi.responses import StreamingResponse
from common.gemini import client, MODEL_FLASH

@router.post("/ask")
async def ask(
    data: AskRequest,
    service: RAGService = Depends(get_rag_service),
):
    async def generate():
        async for chunk in service.stream_answer(data):
            yield f"data: {json.dumps({'text': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
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

3개의 독립 컬렉션 운영 (doc 02 아키텍처 참조):

```python
COLLECTIONS = {
    "malssum": "malssum_collection",      # 말씀 본문 (sparse+dense)
    "dictionary": "dictionary_collection",  # 용어사전 (dense only)
    "wonri": "wonri_collection",           # 원리강론 (sparse+dense)
    "cache": "semantic_cache",             # Semantic Cache
}
```

### Payload 스키마

```python
# 모든 청크에 필수 메타데이터
payload = {
    "text": "말씀 본문...",
    "source": "A",                  # 데이터 소스 식별자
    "book_type": "malssum",         # malssum | mother | wonri | dict
    "volume": 45,                   # 권
    "year": 1990,                   # 연도
    "chapter": "제3장",             # 장
    "parent_chunk_id": "chunk_001", # 계층적 청킹 부모 ID
}
```

### 하이브리드 검색 (sparse + dense)

```python
from qdrant_client.models import (
    FieldCondition, Filter, MatchValue,
    Prefetch, Query, FusionQuery, Fusion,
)

async def hybrid_search(
    query_dense: list[float],
    query_sparse: dict,
    book_type_filter: str | None = None,
    limit: int = 50,
) -> list:
    filter_conditions = None
    if book_type_filter:
        filter_conditions = Filter(
            must=[FieldCondition(key="book_type", match=MatchValue(value=book_type_filter))]
        )

    results = await qdrant.query_points(
        collection_name=COLLECTIONS["malssum"],
        prefetch=[
            Prefetch(query=query_sparse, using="sparse", limit=limit),
            Prefetch(query=query_dense, using="dense", limit=limit),
        ],
        query=FusionQuery(fusion=Fusion.RRF),  # Reciprocal Rank Fusion
        query_filter=filter_conditions,
        limit=limit,
    )
    return results.points
```

### 금지 사항
- 사전(dictionary)과 말씀(malssum) 데이터를 같은 컬렉션에 혼합 금지
- 임베딩 차원은 사용하는 모델에 맞게 설정

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

```
backend/src/
├── admin/              # Admin 인증 (JWT+bcrypt) + 대시보드 API + 분석
│   ├── auth.py             # JWT 생성/검증, bcrypt 해싱
│   ├── dependencies.py     # get_current_admin, CSRF 검증
│   ├── models.py           # AdminUser, AdminAuditLog
│   ├── repository.py
│   ├── service.py
│   ├── router.py           # /admin/auth/*, /admin/users
│   ├── analytics_*.py      # /admin/analytics/* (대시보드 통계)
│   └── data_router.py      # /admin/data-sources/* (파일 업로드, 배치)
├── chat/               # 채팅 도메인 (RAG 파이프라인 오케스트레이션)
│   ├── service.py          # 9단계 RAG 파이프라인 조율
│   ├── prompt.py           # 시스템 프롬프트 + 핵심 용어 정의
│   ├── generator.py        # 동기 답변 생성
│   ├── stream_generator.py # SSE 스트리밍 답변 생성
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
│   ├── chunker.py          # 문장 단위 청킹 (kss)
│   ├── extractor.py        # 텍스트 추출 (PDF/DOCX/TXT)
│   ├── ingestor.py         # Qdrant 적재 (RPD 관리, 체크포인트)
│   ├── batch_*.py          # Gemini Batch API 연동
│   └── progress.py         # 증분 진행 추적 (crash-safe)
├── cache/              # Semantic Cache (Qdrant 기반)
├── datasource/         # 데이터 소스 카테고리 관리 (A/B/L/D)
├── safety/             # 보안 레이어
│   ├── input_validator.py  # 프롬프트 인젝션 탐지 (47 패턴)
│   ├── rate_limiter.py     # IP 기반 슬라이딩 윈도우
│   ├── output_filter.py    # 면책 고지 + 민감 인명 필터
│   └── exceptions.py       # InputBlockedError, RateLimitExceededError
├── common/
│   ├── database.py         # PostgreSQL AsyncSession 팩토리
│   ├── gemini.py           # Gemini 클라이언트 (임베딩, 생성, 스트리밍)
│   ├── schemas.py          # ErrorResponse (통합 에러 포맷)
│   ├── exception_handlers.py # 전역 예외 핸들러 (503, 429, 400, 500)
│   └── middleware.py       # RequestIdMiddleware (X-Request-Id 추적)
├── config.py           # Pydantic Settings (환경변수, GEMINI_TIER 프리셋)
└── qdrant_client.py    # Qdrant 싱글톤 클라이언트 (async/sync)
```
