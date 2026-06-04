import logging
from contextlib import asynccontextmanager

# 앱 로거가 INFO 레벨 출력하도록 기본 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import asyncio

import httpx

from src.admin.ingest_worker import shutdown_worker as shutdown_ingest_worker
from src.common.database import engine, init_db
from src.common.event_loop import set_main_loop as set_ingest_main_loop  # audit 2차 B-3 — data_router re-export chain 정리
from src.config import settings

logger = logging.getLogger(__name__)
from src.chat.router import router as chat_router
from src.chat.reactions_router import reactions_router
from src.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from src.admin.router import router as admin_router
from src.admin.analytics_router import router as analytics_router
from src.admin.data_router import router as admin_data_router
from src.datasource.router import router as datasource_router
from src.datasource.chunks_router import chunks_router
from src.common.exception_handlers import (
    embedding_failed_handler,
    input_blocked_handler,
    rate_limit_handler,
    search_failed_handler,
    unhandled_exception_handler,
)
from src.common.middleware import RequestIdMiddleware
from src.qdrant.raw_client import RawQdrantClient
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.search.exceptions import EmbeddingFailedError, SearchFailedError

# readiness 프로브 전용 짧은 timeout — liveness 와 달리 의존성 장애 시 빠르게
# 실패해야 uptime 모니터·Cloud Run readiness 가 즉시 감지한다.
_READYZ_TIMEOUT = httpx.Timeout(5.0, connect=3.0)


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

# CORS 미들웨어 (admin 프론트엔드 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.admin_frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "X-Requested-With"],
)

# 예외 핸들러 (중앙 집중 — src/common/exception_handlers.py)
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

# 관리자 라우터
app.include_router(admin_router)
app.include_router(chatbot_admin_router)
app.include_router(admin_data_router)
app.include_router(datasource_router)
app.include_router(chunks_router)
app.include_router(analytics_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    """운영 의존성(Qdrant) 실제 연결을 확인하는 readiness 프로브.

    /health(liveness)는 프로세스 생존만 보지만, /readyz 는 Qdrant 도달 +
    main 컬렉션 존재까지 확인한다. Qdrant 터널 장애(예: Cloudflare 530 /
    Error 1033)를 uptime 모니터·Cloud Run readiness 가 즉시 감지하도록
    503 을 반환한다. 내부 예외 상세는 응답에 노출하지 않고 서버 로그로만 남긴다
    (Cloudflare 에러 HTML 등 외부 노출 방지).
    상세: docs/dev-log/62-readiness-probe-and-cleanup-hardening.md
    """
    client = RawQdrantClient(timeout=_READYZ_TIMEOUT)
    try:
        exists = await client.collection_exists(settings.collection_name)
    except Exception as e:
        logger.warning("readyz: Qdrant 도달 실패 — %r", e)
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "qdrant": "unreachable"},
        )
    if not exists:
        logger.warning(
            "readyz: Qdrant 도달했으나 컬렉션 부재 — %s", settings.collection_name
        )
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "qdrant": "collection_missing"},
        )
    return {"status": "ready"}
