"""격리 E2E 전용 진입점. LLM만 fixture로 대체하고 실제 HTTP·인증·DB를 사용한다.

apps/api에서 `uv run uvicorn e2e_app:app --app-dir tests --port 18000`으로 실행한다.
운영 Docker에는 tests/가 포함되지 않으며 제품 코드에 테스트 플래그를 추가하지 않는다.
"""

import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sys
import uuid
from urllib.parse import urlparse

from fastapi import Depends

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings
from app.main import app
from app.modules.chat.dependencies import get_chat_repository, get_chat_service
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.repository import ChatRepository
from app.modules.chat.schemas import ChatRequest, ChatResponse
from app.modules.chat.service import ChatService
from app.modules.chatbot.dependencies import get_chatbot_service
from app.modules.chatbot.service import ChatbotService
from app.modules.search import hybrid
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User


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
        message = await self._persist_assistant_message_only(context.session.id, answer)
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
