import logging
import socket
import ssl
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse

# 앱 로거가 INFO 레벨 출력하도록 기본 설정
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import asyncio

import httpx

from src.admin.data_router import set_main_loop as set_ingest_main_loop
from src.cache.setup import ensure_cache_collection
from src.common.database import init_db
from src.config import settings

logger = logging.getLogger(__name__)
from src.chat.router import router as chat_router
from src.chatbot.router import router as chatbot_router, admin_router as chatbot_admin_router
from src.admin.router import router as admin_router
from src.admin.analytics_router import router as analytics_router
from src.admin.data_router import router as admin_data_router
from src.datasource.router import router as datasource_router
from src.common.exception_handlers import (
    embedding_failed_handler,
    input_blocked_handler,
    rate_limit_handler,
    search_failed_handler,
    unhandled_exception_handler,
)
from src.common.middleware import RequestIdMiddleware
from src.safety.exceptions import InputBlockedError, RateLimitExceededError
from src.search.exceptions import EmbeddingFailedError, SearchFailedError


async def _diagnose_cold_start_outbound() -> None:
    """[일회성 진단] cold start 시점의 outbound 네트워크 단계별 상태 로깅.

    PR #73(Qdrant Cloud → Cloudflare Tunnel cutover) 후 lifespan
    ensure_cache_collection이 매 cold start ConnectTimeout. 진단 결과로
    가설(IPv6 happy-eyeballs / Cloud Run egress cold / HTTP/2 ALPN / DNS) 분기.

    안전: 모든 호출은 짧은 timeout + try/except → lifespan 차단 X.
    이 함수는 진단 끝나면 제거 예정.
    """
    parsed = urlparse(settings.qdrant_url)
    host = parsed.hostname or "qdrant.woosung.dev"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    api_key = settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else ""

    logger.info("[DIAG] === cold start outbound 진단 시작 host=%s port=%d ===", host, port)

    # 1) DNS 해석 (IPv4·IPv6 결과·순서)
    t0 = time.monotonic()
    try:
        addrs = await asyncio.get_running_loop().getaddrinfo(
            host, port, type=socket.SOCK_STREAM
        )
        elapsed = time.monotonic() - t0
        family_name = {socket.AF_INET: "IPv4", socket.AF_INET6: "IPv6"}
        seen = []
        for entry in addrs:
            family = entry[0]
            sockaddr = entry[4]
            seen.append(f"{family_name.get(family, str(family))}:{sockaddr[0]}")
        logger.info("[DIAG] DNS getaddrinfo OK in %.3fs → %s", elapsed, seen)
    except Exception as e:
        logger.warning("[DIAG] DNS getaddrinfo FAIL %.3fs: %r",
                       time.monotonic() - t0, e)
        addrs = []

    # 2) 각 주소별 raw TCP+TLS connect probe (5초 timeout)
    ssl_ctx = ssl.create_default_context()
    for entry in addrs:
        family = entry[0]
        sockaddr = entry[4]
        family_label = "IPv4" if family == socket.AF_INET else "IPv6"
        ip = sockaddr[0]
        t0 = time.monotonic()
        try:
            conn = await asyncio.wait_for(
                asyncio.open_connection(host=ip, port=port, ssl=ssl_ctx,
                                        server_hostname=host, family=family),
                timeout=5.0,
            )
            elapsed = time.monotonic() - t0
            logger.info("[DIAG] %s TCP+TLS connect %s OK in %.3fs",
                        family_label, ip, elapsed)
            writer = conn[1]
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
        except asyncio.TimeoutError:
            logger.warning("[DIAG] %s TCP+TLS connect %s TIMEOUT after %.3fs",
                           family_label, ip, time.monotonic() - t0)
        except Exception as e:
            logger.warning("[DIAG] %s TCP+TLS connect %s FAIL %.3fs: %r",
                           family_label, ip, time.monotonic() - t0, e)

    # 3) HTTP/1.1 강제 httpx로 GET /collections (qdrant-client 우회)
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(
            http2=False,
            timeout=httpx.Timeout(10.0, connect=5.0),
        ) as c:
            r = await c.get(f"{settings.qdrant_url}/collections",
                            headers={"api-key": api_key})
        elapsed = time.monotonic() - t0
        logger.info("[DIAG] HTTP/1.1 raw GET /collections %d in %.3fs",
                    r.status_code, elapsed)
    except Exception as e:
        logger.warning("[DIAG] HTTP/1.1 raw GET FAIL %.3fs: %r",
                       time.monotonic() - t0, e)

    # 4) 외부 통제 호출 (Google generate_204) — Cloud Run egress 자체 cold 여부
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
        ) as c:
            r = await c.get("https://www.google.com/generate_204")
        logger.info("[DIAG] Google generate_204 %d in %.3fs",
                    r.status_code, time.monotonic() - t0)
    except Exception as e:
        logger.warning("[DIAG] Google generate_204 FAIL %.3fs: %r",
                       time.monotonic() - t0, e)

    logger.info("[DIAG] === cold start outbound 진단 종료 ===")


async def _ensure_cache_with_retry(max_attempts: int = 3) -> None:
    """Cold start 직후 일시적 ConnectTimeout 흡수용 retry (exponential backoff).

    Cloud Run cold start 직후 첫 외부 connection이 DNS warmup·happy-eyeballs 경합으로
    ConnectTimeout 나는 사례가 관찰됨 (timeout 늘려도 동일). 1~2회 backoff 후 재시도하면
    connection이 안정화되어 통과한다.
    """
    delay = 2.0
    for attempt in range(max_attempts):
        try:
            await ensure_cache_collection()
            return
        except Exception:
            if attempt + 1 == max_attempts:
                raise
            logger.warning(
                "ensure_cache_collection 시도 %d/%d 실패 — %.1fs 후 재시도",
                attempt + 1, max_attempts, delay,
            )
            await asyncio.sleep(delay)
            delay *= 2


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB + 캐시 컬렉션 초기화. 실패해도 앱은 시작."""
    # 워커 스레드가 DB 호출을 위임할 수 있도록 메인 event loop 참조 저장.
    # AsyncEngine connection pool은 단일 loop에 바인딩되므로 필수.
    set_ingest_main_loop(asyncio.get_running_loop())

    # [일회성] cold start 진단 — 결과 분석 후 본 블록 제거 예정
    try:
        await _diagnose_cold_start_outbound()
    except Exception as e:
        logger.warning("[DIAG] 진단 자체 실패: %r", e)

    try:
        await init_db()
    except Exception as e:
        logger.warning("init_db 실패 (프로덕션에서는 Alembic 사용): %s", e)
    try:
        await _ensure_cache_with_retry()
        app.state.cache_available = True
    except Exception as e:
        # 동일 이슈 재발 시 빠른 진단을 위해 traceback 동시 출력
        logger.warning(
            "캐시 컬렉션 초기화 실패 — graceful degradation으로 동작: %r",
            e,
            exc_info=True,
        )
        app.state.cache_available = False

    yield


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
app.include_router(chatbot_router)

# 관리자 라우터
app.include_router(admin_router)
app.include_router(chatbot_admin_router)
app.include_router(admin_data_router)
app.include_router(datasource_router)
app.include_router(analytics_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
