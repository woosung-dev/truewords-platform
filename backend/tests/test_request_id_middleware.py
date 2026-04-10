"""RequestIdMiddleware 단위 테스트."""

import re

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from src.common.middleware import RequestIdMiddleware


def _make_test_app() -> FastAPI:
    """미들웨어만 붙인 최소 테스트 앱."""
    app = FastAPI()
    app.add_middleware(RequestIdMiddleware)

    @app.get("/echo")
    async def echo(request: Request) -> dict:
        return {"request_id": request.state.request_id}

    return app


def test_middleware_generates_uuid_when_no_header():
    """X-Request-Id 헤더가 없으면 UUID v4 자동 생성."""
    client = TestClient(_make_test_app())
    response = client.get("/echo")
    assert response.status_code == 200

    body = response.json()
    rid = body["request_id"]
    # UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    uuid_pattern = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
    )
    assert uuid_pattern.match(rid), f"Not a UUID v4: {rid}"


def test_middleware_uses_header_if_provided():
    """X-Request-Id 헤더가 있으면 그걸 그대로 사용."""
    client = TestClient(_make_test_app())
    custom_rid = "custom-trace-123"
    response = client.get("/echo", headers={"X-Request-Id": custom_rid})
    assert response.status_code == 200
    assert response.json()["request_id"] == custom_rid


def test_middleware_echoes_request_id_in_response_header():
    """응답 헤더에도 X-Request-Id 포함."""
    client = TestClient(_make_test_app())
    response = client.get("/echo")
    assert "X-Request-Id" in response.headers
    assert response.headers["X-Request-Id"] == response.json()["request_id"]


def test_middleware_sets_request_state():
    """request.state.request_id에 값이 저장됨 (echo 엔드포인트가 읽을 수 있음)."""
    client = TestClient(_make_test_app())
    response = client.get("/echo")
    # echo가 request.state.request_id를 읽어서 반환했으면 성공
    assert "request_id" in response.json()
    assert len(response.json()["request_id"]) > 0
