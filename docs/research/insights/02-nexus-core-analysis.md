# 22. Nexus Core 코드베이스 분석 및 적용 검토

> **작성일:** 2026-04-09
> **목적:** 팀원의 개발 결과물(Nexus Core — 멀티 페르소나 AI 챗봇 플랫폼)에서 TrueWords에 적용할 수 있는 아키텍처 패턴, 코드 품질 기법 참고
> **소스 위치:** `/Users/woosung/project/agy-project/nexus-core/`

---

## 프로젝트 개요

- **서비스:** Nexus Core — 멀티 페르소나 AI 챗봇 마켓플레이스
- **스택:** FastAPI + PostgreSQL + pgvector + OpenAI/Gemini + Cloudflare R2
- **규모:** ~4,561 LOC, 모듈화된 레이어드 아키텍처
- **구조:** `models/` + `crud/` + `services/` + `api/` 전통적 레이어드
- **인증:** JWKS 기반 JWT 검증 (Clerk 통합, JIT Provisioning)
- **RAG:** Provider File Search API 의존 (OpenAI/Gemini 관리형)

---

## 아키텍처 비교

### 디렉토리 구조

```
[Nexus Core — 전통적 레이어드]         [TrueWords — Feature-First]
app/                                  src/
├── models/      ← 모든 도메인 ORM     ├── chat/       ← 도메인별 독립
│   ├── user.py                       │   ├── router.py
│   ├── bot.py                        │   ├── service.py
│   ├── chat.py                       │   ├── repository.py
│   └── faq.py                        │   ├── models.py
├── crud/        ← 모든 도메인 CRUD    │   ├── schemas.py
│   ├── crud_bot.py                   │   └── dependencies.py
│   ├── crud_chat.py                  ├── admin/      ← 도메인별 독립
│   └── crud_user.py                  │   ├── router.py
├── schemas/     ← 모든 도메인 스키마   │   ├── service.py
├── services/    ← 비즈니스 로직        │   └── ...
└── api/v1/      ← 라우터              ├── pipeline/   ← 도메인별 독립
                                      └── safety/     ← 도메인별 독립
```

**판정:** TrueWords의 Feature-First가 확장성 면에서 우수. 다만 Nexus Core의 패턴 중 일부는 도입 가치가 높음.

---

## 패턴 1: 통합 예외 계층 + 글로벌 핸들러 ⭐⭐⭐⭐⭐

> **도입 우선순위: 최상 — FE 에러 처리 통일, 디버깅 효율 향상**

### 예외 계층 구조

```python
# app/core/exceptions.py
class NexusException(Exception):
    """모든 커스텀 예외의 최상위 클래스"""
    def __init__(
        self,
        error_code: str,       # 프론트엔드 분기용 코드
        message: str,          # 사용자 표시 메시지
        status_code: int = 500,
        details: Any | None = None,  # 디버깅용 상세 정보
    ):
        self.error_code = error_code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(self.message)


class NotFoundError(NexusException):
    def __init__(self, message="해당 리소스를 찾을 수 없습니다.", details=None):
        super().__init__(
            error_code="RESOURCE_NOT_FOUND",
            message=message,
            status_code=404,
            details=details,
        )

class BotNotFoundError(NotFoundError):
    """도메인 특화 — 메시지 고정, raise 한 줄로 끝"""
    def __init__(self, details=None):
        super().__init__(message="해당 봇을 찾을 수 없습니다.", details=details)

class ValidationError(NexusException):
    def __init__(self, message="잘못된 요청입니다.", details=None):
        super().__init__(error_code="VALIDATION_ERROR", message=message, status_code=400, details=details)

class AuthenticationError(NexusException):
    def __init__(self, message="인증되지 않은 사용자입니다.", details=None):
        super().__init__(error_code="UNAUTHORIZED", message=message, status_code=401, details=details)

class ConfigurationError(NexusException):
    def __init__(self, message="서버 설정이 올바르지 않습니다.", details=None):
        super().__init__(error_code="CONFIG_ERROR", message=message, status_code=500, details=details)
```

### 통합 에러 응답 스키마

```python
# app/schemas/common.py
class ErrorResponse(BaseModel):
    success: bool = Field(default=False)
    error_code: str       # "RESOURCE_NOT_FOUND", "VALIDATION_ERROR" 등
    message: str          # 사용자 표시 메시지 (한국어)
    details: Optional[Any] = None  # 디버깅용 추가 정보
```

### 글로벌 핸들러 (main.py에 등록)

```python
# 4개의 핸들러로 모든 예외를 포착

@app.exception_handler(NexusException)
async def nexus_exception_handler(request, exc):
    """커스텀 도메인 예외 → 통합 포맷"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error_code=exc.error_code,
            message=exc.message,
            details=exc.details,
        ).model_dump(),
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    """Pydantic 검증 실패 → 통합 포맷"""
    return JSONResponse(
        status_code=422,
        content=ErrorResponse(
            error_code="VALIDATION_ERROR",
            message="요청 데이터가 올바르지 않습니다.",
            details=exc.errors(),
        ).model_dump(),
    )

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request, exc):
    """FastAPI/Starlette HTTP 예외 → 통합 포맷"""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(error_code="HTTP_ERROR", message=str(exc.detail)).model_dump(),
    )

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """예상치 못한 예외 → 500 통합 포맷 (상세 로깅)"""
    logger.error(f"Unhandled Exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error_code="INTERNAL_SERVER_ERROR",
            message="서버 내부 오류가 발생했습니다.",
        ).model_dump(),
    )
```

### TrueWords 적용 방안

현재 TrueWords는 `InputBlockedError`, `RateLimitExceededError` 등 safety 전용 예외만 있고, 통합 에러 포맷이 없음.

```
적용 위치: src/common/exceptions.py (신규) + main.py (핸들러 등록)
효과: 프론트엔드에서 error_code로 분기, message로 토스트 표시, details로 디버깅
```

---

## 패턴 2: ABC + Factory (멀티 프로바이더 추상화) ⭐⭐⭐⭐

> **도입 우선순위: 중기 — 향후 LLM 모델 다변화 대비**

### 디렉토리 구조

```
services/
├── llm/
│   ├── base.py       # ABC 인터페이스 (generate, generate_stream)
│   ├── gemini.py     # Gemini 구현체
│   ├── openai.py     # OpenAI 구현체 (에러 → 도메인 예외 변환)
│   └── factory.py    # 모델명 → 구현체 디스패치
├── rag/
│   ├── base.py       # ABC 인터페이스 (6개 메서드)
│   ├── gemini.py     # Gemini RAG
│   ├── openai_rag.py # OpenAI RAG
│   └── factory.py    # 프로바이더 → 구현체 디스패치
└── storage/
    ├── base.py       # ABC 인터페이스 (upload, delete, get_url)
    ├── r2.py         # Cloudflare R2
    └── factory.py    # 환경변수 → 구현체 (@lru_cache 싱글톤)
```

### LLM ABC 인터페이스

```python
# services/llm/base.py
class LLMService(ABC):
    @abstractmethod
    async def generate(
        self, prompt: str, system_prompt: str = "",
        temperature: float = 0.7, max_tokens: int = 2048,
    ) -> str:
        """단일 응답 생성"""
        ...

    @abstractmethod
    async def generate_stream(
        self, prompt: str, system_prompt: str = "",
        temperature: float = 0.7, max_tokens: int = 2048,
    ) -> AsyncGenerator[str, None]:
        """스트리밍 응답 생성 (SSE용)"""
        ...
```

### Factory — 모델명으로 디스패치

```python
# services/llm/factory.py
def get_llm_service(model_name: str) -> LLMService:
    if model_name.startswith("gpt"):
        return OpenAIService(model_name=model_name)
    return GeminiService(model_name=model_name)
```

### 구현체의 에러 변환 패턴 (핵심)

```python
# services/llm/openai.py — SDK 에러를 도메인 예외로 변환
try:
    response = await self._client.chat.completions.create(...)
    return response.choices[0].message.content or ""
except openai.NotFoundError:
    raise ValidationError(f"존재하지 않는 LLM 모델명입니다: {self._model_name}")
except openai.AuthenticationError:
    raise NexusException(error_code="LLM_AUTH_FAILED", message="LLM 서비스 인증에 실패했습니다.")
except Exception:
    raise NexusException(error_code="LLM_PROVIDER_ERROR", message="LLM 서비스 호출 중 오류가 발생했습니다.")
```

→ 호출하는 쪽에서 프로바이더별 에러를 알 필요 없음. **모든 에러가 도메인 예외**로 통일됨.

### Storage Factory — @lru_cache 싱글톤

```python
# services/storage/factory.py
@lru_cache
def get_storage_service() -> FileStorageService:
    provider = get_settings().STORAGE_PROVIDER.lower()
    match provider:
        case "r2":
            return R2FileStorage()
        case _:
            raise ValueError(f"Unknown STORAGE_PROVIDER: '{provider}'")
```

### TrueWords 적용 방안

현재 Gemini 전용이라 당장 필요 없지만, 향후 모델 비교/전환 시 유용. `src/common/llm/` 디렉토리에 동일 구조 적용 가능.

---

## 패턴 3: JWKS 인증 + JIT Provisioning ⭐⭐⭐⭐

> **도입 우선순위: 참고 — 현재 자체 JWT로 충분하나, 향후 외부 인증 통합 시 필수**

```python
# app/api/deps.py
jwks_client = PyJWKClient(settings.AUTH_JWKS_URL, cache_keys=True)

async def get_current_user(credentials, session) -> User:
    token = credentials.credentials

    # 공개 키로 JWT 검증 (시크릿 키 불필요 — 보안성 ↑)
    signing_key = jwks_client.get_signing_key_from_jwt(token)
    payload = jwt.decode(token, signing_key.key, algorithms=["ES256", "RS256", "HS256"])

    # JIT Provisioning: 첫 로그인 시 자동 사용자 생성
    user = await crud_user.get_or_create_by_clerk_id(
        session=session,
        clerk_user_id=payload.get("sub"),
        email=payload.get("email"),
        provider=payload.get("provider", "unknown"),
        avatar_url=payload.get("avatar_url"),
    )
    return user
```

**핵심 3가지:**

1. **시크릿 키 불필요** — 공개 키만 사용하여 JWT 검증
2. **플랫폼 교체 용이** — `AUTH_JWKS_URL` 환경변수 하나만 변경하면 Clerk → Auth0 전환
3. **JIT Provisioning** — 첫 로그인 시 자동 사용자 생성 (사전 등록 불필요)

---

## 패턴 4: SSE 스트리밍 3단계 프로토콜 ⭐⭐⭐⭐

> **도입 우선순위: 높음 — TrueWords 채팅 스트리밍에 즉시 참고 가능**

```python
# services/chat_service.py — 3단계 SSE 프로토콜
async def _generate_llm_stream(self, llm_service, request, bot, chat_session):
    full_response_content = ""
    try:
        # 1단계: 메타데이터 (session_id → 클라이언트가 즉시 URL 업데이트 가능)
        yield f'data: {json.dumps({"session_id": chat_session.id})}\n\n'

        # 2단계: 콘텐츠 청크
        async for chunk in llm_service.generate_stream(
            prompt=request.message, system_prompt=bot.system_prompt,
        ):
            full_response_content += chunk
            yield f'data: {json.dumps({"content": chunk})}\n\n'

        # 3단계: 종료 신호
        yield "data: [DONE]\n\n"

        # 완료 후 1회 DB 커밋 (스트리밍 중 DB 접근 최소화)
        await crud_chat.create_message(
            session=self.session, session_id=chat_session.id,
            role=MessageRole.ASSISTANT, content=full_response_content,
        )
        await self.session.commit()

    except Exception as e:
        # 에러도 SSE 포맷으로 전달 → 클라이언트 파싱 로직 통일
        yield f'data: {json.dumps({"error": str(e)})}\n\n'
        # 오류 시 불완전한 메시지는 저장하지 않음 (롤백)
```

**StreamingResponse 헤더:**

```python
return StreamingResponse(
    self._generate_llm_stream(...),
    media_type="text/event-stream",
    headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",  # Nginx 프록시 버퍼링 비활성화
    },
)
```

**핵심:**
- `session_id`를 첫 청크로 보내서 클라이언트가 즉시 URL 업데이트 가능
- 전체 응답 누적 → 1회 커밋 (스트리밍 중 DB 접근 최소화)
- 에러도 SSE 포맷으로 → 클라이언트 파싱 로직 통일

---

## 패턴 5: Docstring 체계 ⭐⭐⭐⭐

> **도입 우선순위: 높음 — 협업/온보딩 효율 향상**

### 모듈-레벨 Docstring

```python
# services/llm/base.py (모든 모듈에 적용)
"""
LLM 서비스 추상 인터페이스.
모델 교체(Gemini ↔ OpenAI)가 비즈니스 로직 변경 없이 가능하도록 설계.
"""
```

### 함수-레벨 Docstring (Args/Returns/Raises 구조화)

```python
# services/bot_service.py
async def upload_bot_image(...) -> str:
    """
    봇 대표 이미지 업로드 서비스.

    1. 봇 존재 확인
    2. 파일 크기 · 타입 검증
    3. 스토리지(R2) 업로드
    4. DB bot.image_url 갱신 후 commit

    Returns:
        업로드된 이미지의 Public URL

    Raises:
        BotNotFoundError: 봇이 존재하지 않을 때
        ValidationError: 파일 크기·타입 오류
    """
```

### 인라인 주석 — "왜"를 설명

```python
# services/faq_service.py
# FAQ 존재 여부 TTL 캐시 — bot_id -> (count, 만료_timestamp)
# DB round-trip을 줄이기 위해 60초 동안 캐시 (FAQ가 자주 바뀌지 않기 때문에 타당)
_FAQ_COUNT_CACHE: dict[int, tuple[int, float]] = {}
```

---

## 패턴 6: Soft Delete + Dual Query ⭐⭐⭐

> **도입 우선순위: 선택적 — 데이터 감사/복원 필요 시**

```python
# crud/crud_bot.py

# 관리자용 — 삭제된 봇도 조회 (관리/복원용)
async def get_bot(session, bot_id) -> Bot | None:
    result = await session.execute(select(Bot).where(Bot.id == bot_id))
    return result.scalar_one_or_none()

# 클라이언트용 — 활성 봇만 조회
async def get_active_bot(session, bot_id) -> Bot | None:
    result = await session.execute(
        select(Bot).where(Bot.id == bot_id, Bot.is_active == True)
    )
    return result.scalar_one_or_none()

# 소프트 삭제 — 데이터 보존, 복원 가능
async def soft_delete_bot(session, bot) -> Bot:
    bot.is_active = False
    session.add(bot)
    await session.flush()
    return bot
```

**패턴:** 동일 엔티티에 대해 관리자/클라이언트 쿼리를 명확히 분리.

---

## 패턴 7: Config Computed Field ⭐⭐⭐

> **도입 우선순위: 낮음 — TrueWords는 이미 `@model_validator`로 유사 기능 구현**

```python
# core/config.py
class Settings(BaseSettings):
    CORS_ORIGINS: str = "http://localhost:3000"

    @computed_field
    @property
    def cors_origins_list(self) -> list[str]:
        """환경변수 문자열 → 파이썬 리스트 자동 변환"""
        raw = self.CORS_ORIGINS.strip()
        if raw.startswith("["):
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
```

→ 환경변수 하나로 `"http://a.com,http://b.com"` 또는 `'["http://a.com"]'` 두 형식 모두 지원.

---

## 패턴 8: FAQ 시맨틱 라우팅 (비용 절약) ⭐⭐⭐⭐

> **도입 우선순위: 참고 — TrueWords의 Semantic Cache와 유사하나 접근이 다름**

```
사용자 질문 → FAQ 매칭 확인 → 매칭 성공 시 LLM 호출 없이 즉시 응답 (비용 0원)
                              → 매칭 실패 시 RAG/LLM 폴백
```

```python
# services/faq_service.py — 3단계 방어로 불필요한 API 호출 최소화
async def search_faq_override(session, bot_id, query_text):
    # 0. TTL 캐시 확인 (FAQ 없는 봇은 임베딩 API 호출 자체를 안 함)
    cached = _FAQ_COUNT_CACHE.get(bot_id)
    if cached and now - cached[1] < 60.0:
        if cached[0] == 0:
            return None  # FAQ 없음 → 임베딩 생성 건너뜀

    # 1. FAQ 존재할 때만 임베딩 생성
    query_vector = await get_embedding(query_text)

    # 2. pgvector 코사인 유사도 검색 (1 - cosine_distance)
    # 3. threshold 이상이면 FAQ 응답, 미달이면 None → LLM 폴백

    # 실패해도 채팅 중단 없음 (graceful fallback)
    except Exception:
        logger.error("FAQ Override 검색 오류")
        return None
```

### TrueWords와의 차이점

| 항목 | Nexus Core (FAQ Override) | TrueWords (Semantic Cache) |
|------|--------------------------|---------------------------|
| 저장소 | pgvector (PostgreSQL 내장) | Qdrant 전용 컬렉션 |
| 대상 | 관리자가 등록한 FAQ 쌍 | 이전 질문-답변 자동 캐시 |
| 목적 | 정해진 답변 강제 (환각 방지) | 동일/유사 질문 재사용 (비용 절감) |
| 임계값 | FAQ별 개별 threshold | 전역 threshold (0.93) |

→ **두 접근은 상호보완적.** TrueWords에 FAQ Override 계층을 추가하면 `FAQ → Cache → RAG → LLM` 4단계 파이프라인이 됨.

---

## 종합 비교 매트릭스

| 평가 항목 | Nexus Core | TrueWords | 승자 |
|----------|:---------:|:---------:|:----:|
| 아키텍처 구조 | ⭐⭐⭐⭐ (전통 레이어드) | ⭐⭐⭐⭐⭐ (Feature-First) | **TrueWords** |
| 에러 처리 체계 | ⭐⭐⭐⭐⭐ (통합 계층+핸들러) | ⭐⭐⭐ (부분적) | **Nexus Core** |
| 코드 문서화 | ⭐⭐⭐⭐⭐ (모듈+함수 docstring) | ⭐⭐⭐⭐ (주석 위주) | **Nexus Core** |
| 멀티 프로바이더 | ⭐⭐⭐⭐⭐ (ABC+Factory) | ⭐⭐ (Gemini 전용) | **Nexus Core** |
| RAG 파이프라인 | ⭐⭐ (Provider API 의존) | ⭐⭐⭐⭐⭐ (자체 구축) | **TrueWords** |
| 보안/가드레일 | ⭐⭐ (없음) | ⭐⭐⭐⭐⭐ (전용 모듈) | **TrueWords** |
| 테스트 커버리지 | ⭐ (테스트 없음) | ⭐⭐⭐⭐ (32+ 파일) | **TrueWords** |
| 설정 관리 | ⭐⭐⭐⭐ (computed_field) | ⭐⭐⭐⭐⭐ (tier 프리셋+검증) | **TrueWords** |
| SSE 스트리밍 | ⭐⭐⭐⭐⭐ (3단계 프로토콜) | ⭐⭐⭐⭐ (기본 구현) | **Nexus Core** |
| 인증 설계 | ⭐⭐⭐⭐⭐ (JWKS+JIT) | ⭐⭐⭐⭐ (자체 JWT) | **Nexus Core** |

---

## TrueWords 적용 로드맵

### 즉시 적용 (높은 가치, 낮은 난이도)

| 패턴 | 적용 위치 | 예상 효과 |
|------|----------|----------|
| 통합 예외 계층 | `src/common/exceptions.py` (신규) | FE 에러 처리 통일 |
| 글로벌 핸들러 | `main.py` 핸들러 등록 | 예외 누락 방지 |
| ErrorResponse 스키마 | `src/common/schemas.py` | API 응답 일관성 |
| Docstring 체계화 | 전체 서비스 레이어 | 협업/온보딩 효율 ↑ |

### 중기 적용 (높은 가치, 중간 난이도)

| 패턴 | 적용 위치 | 예상 효과 |
|------|----------|----------|
| SSE 메타데이터 프로토콜 | `src/chat/stream_generator.py` | 스트리밍 UX 개선 |
| ABC + Factory (LLM) | `src/common/llm/` (신규) | 모델 교체 유연성 |
| Soft Delete 일관 적용 | 모든 모델 | 데이터 감사/복원 |

### 장기 참고 (상황에 따라)

| 패턴 | 조건 | 메모 |
|------|------|------|
| JWKS 인증 | 외부 인증 서비스 도입 시 | 현재 자체 JWT로 충분 |
| FAQ Override 계층 | 용어사전 데이터 확보 시 | Semantic Cache와 상호보완 |
| Config computed_field | 설정 복잡도 증가 시 | 현재 @model_validator로 충분 |

---

## 반면교사 (Nexus Core의 약점)

| 항목 | 문제점 | TrueWords 현재 상태 |
|------|-------|-------------------|
| 테스트 없음 | 품질 보장 불가 | 32+ 테스트 파일 ✅ |
| Admin 권한 검증 미흡 | 네임스페이스만으로 보호 | RBAC + CSRF 보호 ✅ |
| pgvector 스케일 한계 | 대규모 벡터 검색 병목 | Qdrant 전용 벡터DB ✅ |
| RAG 블랙박스 | Provider File Search 의존 | 자체 파이프라인 (튜닝 가능) ✅ |
| Rate Limiting 없음 | DDoS 취약 | 전용 safety 모듈 ✅ |

---

## 핵심 파일 참조

| 파일 (nexus-core/backend/) | 내용 | 패턴 |
|---------------------------|------|------|
| `app/core/exceptions.py` | 예외 계층 (5개 클래스) | 패턴 1 |
| `app/main.py` (L65-113) | 글로벌 핸들러 4개 | 패턴 1 |
| `app/schemas/common.py` | ErrorResponse 스키마 | 패턴 1 |
| `app/services/llm/base.py` | LLM ABC (2개 추상 메서드) | 패턴 2 |
| `app/services/llm/factory.py` | 모델명 디스패치 | 패턴 2 |
| `app/services/llm/openai.py` | SDK 에러 → 도메인 예외 변환 | 패턴 2 |
| `app/services/storage/factory.py` | @lru_cache 싱글톤 | 패턴 2 |
| `app/api/deps.py` | JWKS + JIT Provisioning | 패턴 3 |
| `app/services/chat_service.py` (L177-207) | SSE 3단계 프로토콜 | 패턴 4 |
| `app/services/bot_service.py` | Docstring Args/Returns/Raises | 패턴 5 |
| `app/crud/crud_bot.py` | Soft Delete + Dual Query | 패턴 6 |
| `app/core/config.py` (L63-75) | @computed_field CORS 파싱 | 패턴 7 |
| `app/services/faq_service.py` | FAQ 시맨틱 라우팅 | 패턴 8 |
