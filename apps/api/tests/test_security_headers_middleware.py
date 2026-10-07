"""SecurityHeadersMiddleware 단위 테스트."""

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient

from app.core.common.middleware import SecurityHeadersMiddleware


def _make_test_app(hsts: bool) -> FastAPI:
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware, hsts=hsts)

    @app.get("/json")
    async def json_route() -> dict:
        return {"ok": True}

    @app.get("/stream")
    async def stream_route() -> StreamingResponse:
        async def events():
            yield "data: hi\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")

    return app


def test_json_and_stream_responses_get_security_headers():
    client = TestClient(_make_test_app(hsts=False))
    for path in ("/json", "/stream"):
        response = client.get(path)
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Content-Security-Policy"] == "default-src 'none'; frame-ancestors 'none'"
        assert "Strict-Transport-Security" not in response.headers


def test_hsts_only_when_enabled():
    response = TestClient(_make_test_app(hsts=True)).get("/json")
    assert response.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
