import logging
from contextlib import asynccontextmanager

# 앱 로거가 INFO 레벨 출력하도록 기본 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from pydantic.json_schema import models_json_schema

import asyncio

from app.modules.admin.ingest_worker import shutdown_worker as shutdown_ingest_worker
from app.core.common.database import engine, init_db
from app.core.common.event_loop import set_main_loop as set_ingest_main_loop  # audit 2차 B-3 — data_router re-export chain 정리
from app.core.config import settings

logger = logging.getLogger(__name__)
from app.modules.chat.router import router as chat_router
from app.modules.chat.stream_schemas import STREAM_EVENT_MODELS
from app.modules.chat.reactions_router import reactions_router
from app.modules.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from app.modules.admin.dependencies import require_admin_gate
from app.modules.admin.router import router as admin_router
from app.modules.admin.analytics_router import router as analytics_router
from app.modules.admin.data_router import router as admin_data_router
from app.modules.datasource.router import router as datasource_router
from app.modules.datasource.chunks_router import chunks_router
from app.core.common.exception_handlers import (
    embedding_failed_handler,
    input_blocked_handler,
    rate_limit_handler,
    search_failed_handler,
    unhandled_exception_handler,
)
from app.core.common.middleware import RequestIdMiddleware
from app.modules.safety.exceptions import InputBlockedError, RateLimitExceededError
from app.modules.search.exceptions import EmbeddingFailedError, SearchFailedError


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB만 초기화. 캐시 컬렉션은 첫 요청 시 lazy init.

    NOTE: 캐시 컬렉션 ensure를 lifespan에서 호출하지 않는 이유 —
    Cloud Run cold start 직후 lifespan 시점에 qdrant-client(httpx[http2])가
    Cloudflare Tunnel에 connect할 때 일관 ConnectTimeout이 발생함.
    동일 클라이언트가 warm path(첫 chat 요청 이후)에선 정상 동작.
    Google Cloud 공식도 startup eager init보다 lazy 패턴을 권장.
    상세: docs/dev-log/46-qdrant-cache-cold-start-debug.md
    """
    # 워커 스레드가 DB 호출을 위임할 수 있도록 메인 event loop 참조 저장.
    # AsyncEngine connection pool은 단일 loop에 바인딩되므로 필수.
    set_ingest_main_loop(asyncio.get_running_loop())

    try:
        await init_db()
    except Exception as e:
        logger.warning("init_db 실패 (프로덕션에서는 Alembic 사용): %s", e)

    # 캐시 가용성 플래그는 lazy 평가 (None = 미시도, True/False = 시도 결과)
    app.state.cache_available = None

    yield

    # audit 2차 R-3 + R-4 (2026-05-15): graceful shutdown.
    # Cloud Run SIGTERM → lifespan 종료. R-3 in-flight ingest worker 회수 (sentinel
    # + thread join), R-4 asyncpg connection pool 정리 (engine.dispose).
    try:
        shutdown_ingest_worker(timeout=30.0)
    except Exception:
        logger.exception("shutdown_ingest_worker 실패")
    try:
        await engine.dispose()
        logger.info("AsyncEngine connection pool 정리 완료")
    except Exception:
        logger.exception("engine.dispose 실패")


app = FastAPI(
    title="TrueWords RAG Platform",
    version="0.2.0",
    lifespan=lifespan,
)

# 요청 추적 ID 미들웨어
# CORS보다 먼저 추가되어 INNERMOST로 실행됨 (CORS가 OUTERMOST로 runs first)
# CORS preflight 거부에는 request_id가 없지만, 실제 handler 경로(exception handler 포함)에는 정상 동작함
app.add_middleware(RequestIdMiddleware)

# CORS 미들웨어 (명시된 사용자 웹·관리자 origin만 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys([settings.admin_frontend_url, settings.web_frontend_url])),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Requested-With"],
)

# 예외 핸들러 (중앙 집중 — app/core/common/exception_handlers.py)
app.add_exception_handler(InputBlockedError, input_blocked_handler)  # type: ignore[arg-type]
app.add_exception_handler(RateLimitExceededError, rate_limit_handler)  # type: ignore[arg-type]
app.add_exception_handler(SearchFailedError, search_failed_handler)  # type: ignore[arg-type]
app.add_exception_handler(EmbeddingFailedError, embedding_failed_handler)  # type: ignore[arg-type]

# Catch-all — 반드시 마지막에 등록 (구체 예외 핸들러가 먼저 매칭되도록)
app.add_exception_handler(Exception, unhandled_exception_handler)  # type: ignore[arg-type]

# 공개 라우터
app.include_router(chat_router)
app.include_router(reactions_router)
app.include_router(chatbot_router)

# ponytail: 레드팀 시연 한시 게이트 — dependencies.require_admin_gate 참조. 시연 후 회수.
_ADMIN_GATE = [Depends(require_admin_gate)]

# 관리자 라우터
app.include_router(admin_router)  # /admin/auth/* 는 모든 로그인 계정에 열림 — 게이트는 router.py 개별 route
app.include_router(chatbot_admin_router, dependencies=_ADMIN_GATE)
app.include_router(admin_data_router, dependencies=_ADMIN_GATE)
app.include_router(datasource_router, dependencies=_ADMIN_GATE)
app.include_router(chunks_router)  # 공개 유지 — 채팅 원문보기 모달 (자체 chatbot ACL)
app.include_router(analytics_router, dependencies=_ADMIN_GATE)


@app.get("/health")
async def health():
    return {"status": "ok"}


def custom_openapi():
    """REST 자동 계약에 실제 SSE 이벤트 데이터 모델을 문서화한다."""
    if app.openapi_schema is None:
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
        _, stream_schema = models_json_schema(
            [(model, "serialization") for model in STREAM_EVENT_MODELS.values()],
            ref_template="#/components/schemas/{model}",
        )
        # Source/FeaturedMalssum은 REST에도 있다. 기존 REST 정의를 유지한다.
        for name, definition in stream_schema["$defs"].items():
            schema["components"]["schemas"].setdefault(name, definition)
        operation = schema["paths"]["/chat/stream"]["post"]
        operation["responses"]["200"]["content"] = {
            "text/event-stream": {"schema": {"type": "string"}}
        }
        operation["x-sse-events"] = {
            event: {"$ref": f"#/components/schemas/{model.__name__}"}
            for event, model in STREAM_EVENT_MODELS.items()
        }
        app.openapi_schema = schema
    return app.openapi_schema


app.openapi = custom_openapi
