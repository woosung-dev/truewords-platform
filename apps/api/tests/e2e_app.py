"""격리 E2E 전용 진입점. LLM만 fixture로 대체하고 실제 HTTP·인증·DB를 사용한다.

get_chat_service·get_ask_chat_service 를 바꾸므로 /chat/stream 과 훈독 /hoondok/ask/stream(로그인·하루 횟수·계정 기록은 실제 코드) 모두 fixture 답을 준다.

apps/api에서 `uv run uvicorn e2e_app:app --app-dir tests --port 18000`으로 실행한다.
운영 Docker에는 tests/가 포함되지 않으며 제품 코드에 테스트 플래그를 추가하지 않는다.
"""

import asyncio
import base64
import binascii
from copy import deepcopy
import json
from pathlib import Path
import sys
import uuid
from urllib.parse import urlparse

from fastapi import Depends, Request
from fastapi.responses import RedirectResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings
from app.main import app
from app.modules.chat.dependencies import get_chat_repository, get_chat_service
from app.modules.hoondok.dependencies import get_ask_chat_service
from app.modules.chat.models import AnswerCitation, MessageRole, SessionMessage
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import ChatRequest, ChatResponse
from app.modules.chat.service import ChatService
from app.modules.chatbot.dependencies import get_chatbot_service
from app.modules.chatbot.service import ChatbotService
from app.modules.search import hybrid
from app.modules.identity.dependencies import get_current_user, get_login_providers, verify_csrf
from app.modules.identity.models import User
from app.modules.identity.oauth_flow import redirect_uri as oauth_redirect_uri
from app.modules.identity.oidc import GOOGLE_ISSUER, GOOGLE_PROVIDER, ExternalIdentity, LoginProvider, OidcError


database_url = urlparse(settings.database_url.get_secret_value())
if (
    settings.environment != "development"
    or database_url.hostname not in {"localhost", "127.0.0.1"}
    or database_url.port != 15432
    or database_url.path != "/truewords_e2e"
    or settings.qdrant_url != "http://127.0.0.1:16333"
):
    raise RuntimeError("E2E harness requires the isolated local truewords_e2e database and Qdrant")

FIXTURE_PATH = Path(__file__).resolve().parents[3] / "contracts/fixtures/chat-stream.json"
EVENTS = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["normal"]


class FixtureChatService(ChatService):
    async def process_chat_stream(self, request: ChatRequest, user_id: uuid.UUID | None = None):
        context = await self.input_validation_stage.execute(ChatContext(request=request, user_id=user_id))
        context = await self.session_stage.execute(context)
        assert context.session is not None
        events = deepcopy(EVENTS)
        # 공통 계약 fixture는 보존하고 이 harness의 출처만 실제 합성 코퍼스에 연결한다.
        for event in events:
            if event["event"] == "sources":
                event["data"]["sources"][0]["chunk_id"] = str(
                    uuid.uuid5(uuid.NAMESPACE_URL, "hoondok-e2e:말씀선집 001권:0")
                )
        answer = "".join(event["data"]["text"] for event in events if event["event"] == "chunk")
        sources = next(event["data"] for event in events if event["event"] == "sources")
        # 실제 PersistStage 처럼 적용 모드와 인용을 남긴다 — 훈독 공개 신청(위기 답·근거 없음 차단)을 E2E 에서 지나야 한다.
        message = await self.chat_repo.create_message(
            SessionMessage(
                session_id=context.session.id,
                role=MessageRole.ASSISTANT,
                content=answer,
                pipeline_version=2,
                requested_answer_mode=request.answer_mode,
                resolved_answer_mode=sources["answer_mode"],
                persona_overridden=False,
            )
        )
        await self.chat_repo.create_citations(
            [
                AnswerCitation(
                    message_id=message.id,
                    source=source["source"],
                    volume=0,
                    volume_raw=source["volume"],
                    text_snippet=source["text"][:500],
                    relevance_score=source["score"],
                    rank_position=rank,
                )
                for rank, source in enumerate(sources["sources"])
            ]
        )
        await self.chat_repo.commit()
        for index, event in enumerate(events):
            if index:
                await asyncio.sleep(0.25)
            if event["event"] == "sources":
                event["data"]["session_id"] = str(context.session.id)
                event["data"]["message_id"] = str(message.id)
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

    async def process_chat(self, request: ChatRequest, user_id: uuid.UUID | None = None):
        answer = []
        sources = {}
        async for frame in self.process_chat_stream(request, user_id):
            event_line, payload = frame.strip().split("\ndata: ", 1)
            data = json.loads(payload)
            if event_line == "event: chunk":
                answer.append(data["text"])
            elif event_line == "event: sources":
                sources = data
        return ChatResponse(answer="".join(answer), **sources)


async def get_fixture_chat_service(
    chat_repo: ChatRepository = Depends(get_chat_repository),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
) -> ChatService:
    return FixtureChatService(chat_repo=chat_repo, chatbot_service=chatbot_service)


app.dependency_overrides[get_chat_service] = get_fixture_chat_service
app.dependency_overrides[get_ask_chat_service] = get_fixture_chat_service


async def fixture_dense_query(query: str) -> list[float]:
    """벡터만 결정론적으로 대체하고 실제 Qdrant 필터·정렬은 유지한다."""
    return [1.0, 0.0, 0.0, 0.0]


async def fixture_sparse_query(query: str) -> tuple[list[int], list[float]]:
    return ([1], [1.0])


hybrid.embed_dense_query = fixture_dense_query
hybrid.embed_sparse_async = fixture_sparse_query


@app.post("/__e2e/jeongseong/previous-day", include_in_schema=False)
async def seed_previous_jeongseong_day(
    user: User = Depends(get_current_user),
    _csrf=Depends(verify_csrf),
):
    """본인 fixture 이력만 하루 과거로 옮겨 실제 대기 없이 다음 말씀 선택을 검증한다."""
    from datetime import timedelta

    from sqlmodel import select

    from app.core.common.clock import today_kst
    from app.core.common.database import async_session_factory
    from app.modules.hoondok.models import JeongseongPeriod, JeongseongReading, MissionLog

    today = today_kst()
    yesterday = today - timedelta(days=1)
    async with async_session_factory() as session:
        result = await session.execute(
            select(JeongseongPeriod).where(JeongseongPeriod.user_id == user.id, JeongseongPeriod.status == "active")
        )
        period = result.scalar_one()
        period.started_on = yesterday
        result = await session.execute(
            select(JeongseongReading).where(
                JeongseongReading.period_id == period.id, JeongseongReading.reading_date == today
            )
        )
        for reading in result.scalars():
            reading.reading_date = yesterday
        result = await session.execute(
            select(MissionLog).where(MissionLog.user_id == user.id, MissionLog.mission_date == today)
        )
        for mission in result.scalars():
            mission.mission_date = yesterday
        await session.commit()
    return {"previous_date": yesterday.isoformat(), "today": today.isoformat()}


# --- 가짜 구글 로그인 제공자 (하네스 전용) -------------------------------------------------------------------
# 가입이 닫혀 신규 계정은 구글 OIDC 로만 생긴다. 실제 구글에 가지 않고 같은 서버 경로(start → 콜백 → 세션 쿠키)를 타도록
# get_login_providers 만 바꾼다. 이 모듈은 운영 앱(app.main)이 import 하지 않으므로 가짜는 하네스에만 존재한다.
#
# 사용자 지정: 테스트가 브라우저 컨텍스트에 `e2e_fake_google` 쿠키(base64url JSON {sub,email,name})를 심는다.
# authorization_url 은 웹 origin 의 `/api/backend/__e2e/fake-oidc/authorize` 라 쿠키가 웹 호스트에 붙고, 컨텍스트마다
# 따로라 병렬 실행에도 안전하다. authorize 가 그 신원을 code 에 담아 실제 콜백 경로로 302 하고, complete 가 code 를 푼다.
FAKE_IDENTITY_COOKIE = "e2e_fake_google"
FAKE_GOOGLE_CLIENT_ID = "e2e-fake-google-client"


def _b64url_decode_json(raw: str) -> dict:
    try:
        data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except (ValueError, binascii.Error):
        raise OidcError("fake identity malformed") from None
    if not isinstance(data, dict):
        raise OidcError("fake identity malformed")
    return data


class FakeOidcProvider:
    key = GOOGLE_PROVIDER

    def authorization_url(self, *, redirect_uri: str, state: str, nonce: str, code_challenge: str) -> str:
        from urllib.parse import urlencode

        base = settings.web_frontend_url.strip().rstrip("/")
        return f"{base}/api/backend/__e2e/fake-oidc/authorize?{urlencode({'state': state})}"

    async def complete(self, *, code: str, redirect_uri: str, code_verifier: str, nonce: str) -> ExternalIdentity:
        claims = _b64url_decode_json(code)
        sub, email = claims.get("sub"), claims.get("email")
        if not isinstance(sub, str) or not sub or not isinstance(email, str) or not email:
            raise OidcError("fake identity incomplete")
        name = claims.get("name")
        return ExternalIdentity(
            provider=GOOGLE_PROVIDER,
            issuer=GOOGLE_ISSUER,
            subject_scope="",
            subject=sub,
            client_id=FAKE_GOOGLE_CLIENT_ID,
            email=email.strip().lower(),
            email_verified=claims.get("email_verified", True) is True,
            email_authoritative=email.strip().lower().endswith("@gmail.com"),
            display_name=name if isinstance(name, str) else None,
        )


def _fake_login_providers() -> dict[str, LoginProvider]:
    return {GOOGLE_PROVIDER: FakeOidcProvider()}


app.dependency_overrides[get_login_providers] = _fake_login_providers


@app.get("/__e2e/fake-oidc/authorize", include_in_schema=False)
async def fake_oidc_authorize(request: Request, state: str = ""):
    """제공자 화면 대신, 쿠키로 지정된 신원을 code 에 담아 실제 콜백으로 돌려보낸다. 쿠키가 없으면 취소(error=access_denied)."""
    from urllib.parse import urlencode

    callback = oauth_redirect_uri(GOOGLE_PROVIDER)
    code = request.cookies.get(FAKE_IDENTITY_COOKIE)
    query = {"code": code, "state": state} if code else {"error": "access_denied", "state": state}
    response = RedirectResponse(f"{callback}?{urlencode(query)}", status_code=302)
    response.headers["Cache-Control"] = "no-store"
    return response
