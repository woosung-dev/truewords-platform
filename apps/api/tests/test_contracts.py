"""오프라인 생성·플랫폼 공통 SSE 계약 회귀 검사."""

import json
import os
from pathlib import Path
import subprocess
import sys

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.modules.chat.router import chat_stream
from app.modules.chat.schemas import ChatRequest
from app.modules.chat.stream_schemas import STREAM_EVENT_MODELS


REPO_ROOT = Path(__file__).resolve().parents[3]
EXPORT_SCRIPT = REPO_ROOT / "apps/api/scripts/export_openapi.py"


def test_export_is_deterministic_without_runtime_environment(tmp_path):
    """운영 환경변수와 잘못된 .env가 있어도 읽지 않고 두 번 동일 생성한다."""
    (tmp_path / ".env").write_text("ENVIRONMENT=production\nCOOKIE_SECURE=false\n", encoding="utf-8")
    environment = {
        **os.environ,
        "ENVIRONMENT": "production",
        "GEMINI_API_KEY": "",
        "ADMIN_JWT_SECRET": "change-me-in-production",
        "DATABASE_URL": "this-is-not-a-database-url",
    }
    output = tmp_path / "openapi.json"
    for flags in ([], ["--check"]):
        subprocess.run(
            [sys.executable, str(EXPORT_SCRIPT), "--output", str(output), *flags],
            cwd=tmp_path,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
    assert output.read_bytes() == (REPO_ROOT / "contracts/openapi.json").read_bytes()


def test_openapi_documents_actual_sse_events():
    schema = app.openapi()
    operation = schema["paths"]["/chat/stream"]["post"]
    assert set(operation["responses"]["200"]["content"]) == {"text/event-stream"}
    assert operation["x-sse-events"] == {
        name: {"$ref": f"#/components/schemas/{model.__name__}"}
        for name, model in STREAM_EVENT_MODELS.items()
    }


@pytest.mark.asyncio
async def test_stream_prevents_proxy_compression_and_buffering():
    class FixtureService:
        async def process_chat_stream(self, request, user_id):
            yield "event: done\ndata: {}\n\n"

    response = await chat_stream(
        ChatRequest(query="테스트 질문", chatbot_id="all"), FixtureService(), None
    )
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.headers["cache-control"] == "no-cache, no-transform"
    assert response.headers["x-accel-buffering"] == "no"
    assert "content-encoding" not in response.headers


def test_shared_sse_fixtures_match_server_models():
    fixtures = json.loads((REPO_ROOT / "contracts/fixtures/chat-stream.json").read_text())
    for name, events in fixtures.items():
        for event in events:
            STREAM_EVENT_MODELS[event["event"]].model_validate(event["data"])
        assert (events[-1]["event"] == "done") is (name != "interrupted")


@pytest.mark.parametrize("origin", ["http://localhost:3000", "http://localhost:3001"])
def test_cors_allows_both_explicit_frontend_origins(origin):
    client = TestClient(app)
    response = client.options(
        "/admin/auth/login",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert response.headers["access-control-allow-credentials"] == "true"


def test_cors_does_not_allow_an_unconfigured_origin():
    client = TestClient(app)
    response = client.options(
        "/admin/auth/login",
        headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers
