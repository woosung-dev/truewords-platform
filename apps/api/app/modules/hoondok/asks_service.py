"""훈독 AI 질문 (DEC-PWA-025 2차) — 로그인 필수, 계정에만 보관, 하루 횟수.

- 답은 기존 ChatService 스트림 파이프라인(RAG·safety·출력 필터)에 훈독 user_id 로 위임한다. 이 모듈은 앞뒤만 감싼다:
  소유 확인 → 횟수 차감 → 첫 이벤트까지 미리 돌려 보기(실패면 차감 취소 + HTTP 오류) → sources 이벤트를 계정에 기록.
- 세션 소유는 research_sessions.user_id 다. 이어 묻기는 이 계정의 대화(hoondok_ask_threads)만 받는다 — 시연 챗 세션·남의 세션은 403.
- 비공개 = 내 계정에서만. 목록·상세·삭제는 본인 것만, 남의 것과 없는 것은 구분 없이 404.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from datetime import date, datetime, time, timedelta

from fastapi import HTTPException, status
from pydantic import ValidationError

from app.core.common.clock import KST, today_kst, utcnow
from app.modules.chat.exceptions import SessionOwnershipError
from app.modules.chat.models import MessageRole, SessionMessage
from app.modules.chat.schemas import ChatRequest, Source
from app.modules.chat.service import ChatService
from app.modules.hoondok.asks_repository import AskRepository
from app.modules.hoondok.asks_schemas import (
    AskQuota,
    AskRequest,
    MyAskDetail,
    MyAskListResponse,
    MyAskSummary,
    MyAskTurn,
)
from app.modules.hoondok.exceptions import AskDailyLimitError
from app.modules.hoondok.models import AskThread, AskTurn, PublicQuestion
from app.modules.safety.exceptions import InputBlockedError
from app.modules.safety.input_validator import validate_input

logger = logging.getLogger(__name__)

# 훈독 질문이 쓰는 봇 슬러그. 웹이 /chat/stream 에 보내던 값과 같다(전체 검색 A·B·C — 운영에서 근거가 확인된 봇).
HOONDOK_ASK_CHATBOT_ID = "all"
ANSWER_MODES = ("standard", "theological", "pastoral", "beginner", "kids")
NOT_FOUND = "대화를 찾을 수 없어요"


def next_reset(now: datetime) -> datetime:
    """다음 KST 자정(+09:00)."""
    return datetime.combine(today_kst(now) + timedelta(days=1), time.min, tzinfo=KST)


def _mode(value: str | None) -> str:
    return value if value in ANSWER_MODES else "standard"


def _sources(raw: list) -> list[Source]:
    sources = []
    for item in raw or []:
        try:
            sources.append(Source.model_validate(item))
        except ValidationError:
            continue
    return sources


def _questions_before_answers(messages: list[SessionMessage]) -> dict[uuid.UUID, str]:
    """답 id → 그 답 직전의 사용자 질문. messages 는 시간순."""
    last_question = ""
    pairs: dict[uuid.UUID, str] = {}
    for message in messages:
        if message.role == MessageRole.USER:
            last_question = message.content
        else:
            pairs[message.id] = last_question
    return pairs


class AskService:
    def __init__(
        self,
        repo: AskRepository,
        chat: ChatService | None,
        *,
        daily_limit: int,
        now: Callable[[], datetime] = utcnow,
    ) -> None:
        self.repo = repo
        self.chat = chat
        self.daily_limit = daily_limit
        self.now = now

    # --- 하루 횟수 -------------------------------------------------------------------

    async def quota(self, user_id: uuid.UUID) -> AskQuota:
        now = self.now()
        used = await self.repo.used_on(user_id, today_kst(now))
        return AskQuota(
            limit=self.daily_limit,
            used=used,
            remaining=max(0, self.daily_limit - used),
            resets_at=next_reset(now),
        )

    # --- 질문 ------------------------------------------------------------------------

    async def start(self, user_id: uuid.UUID, data: AskRequest) -> AsyncIterator[str]:
        """검사·차감 뒤 SSE 프레임 이터레이터를 돌려준다. 여기서 나는 예외는 응답 헤더 전이라 HTTP 오류가 된다.

        첫 프레임까지 미리 당겨 입력 검증·세션·임베딩·검색 실패(400·403·503 등)를 빈 200 스트림이 아닌 오류 응답으로
        바꾸고, 그 경우 차감을 되돌린다. 첫 답 조각이 나간 뒤의 실패는 답을 만들기 시작한 것이라 되돌리지 않는다.
        """
        assert self.chat is not None, "질문 경로에는 ChatService 가 필요합니다"
        if data.session_id is not None:
            thread = await self.repo.get_thread(data.session_id)
            if thread is None or thread.user_id != user_id:
                # 시연 챗 세션·남의 대화·없는 id 를 구분하지 않는다(존재 여부 비노출). 차감 전이라 횟수도 줄지 않는다.
                raise SessionOwnershipError(data.session_id)

        # 빈 질문·1000자 초과·차단 패턴은 차감 전에 거절한다. 차감 뒤에 거르면(되돌리기 전 잠깐) 마지막 1회를 차지해
        # 같은 순간 보낸 정상 질문이 429 를 받는다. 파이프라인의 입력 검증 단계와 같은 함수·같은 오류다.
        validation = await validate_input(data.query)
        if not validation.passed:
            raise InputBlockedError("허용되지 않는 입력 패턴이 감지되었습니다.")

        # 권리가 닫힌 권(원장에 없는 권 포함)의 본문이 답·근거로 나가지 않도록 검색 자체를 허용 volume 으로 좁힌다.
        volumes = await self.repo.searchable_volumes()

        now = self.now()
        day = today_kst(now)
        if not await self.repo.try_consume(user_id, day, self.daily_limit):
            used = await self.repo.used_on(user_id, day)
            raise AskDailyLimitError(self.daily_limit, used, next_reset(now))

        request = ChatRequest(
            query=data.query,
            chatbot_id=HOONDOK_ASK_CHATBOT_ID,
            session_id=data.session_id,
            answer_mode=data.answer_mode,
        )
        frames = self.chat.process_chat_stream(request, user_id, volume_filter=volumes)
        try:
            first = await anext(frames)
        except StopAsyncIteration:
            await self.repo.refund(user_id, day)
            raise RuntimeError("채팅 스트림이 이벤트 없이 끝났습니다") from None
        except Exception:
            await self.repo.refund(user_id, day)
            raise
        return self._relay(user_id, day, first, frames)

    async def _relay(
        self, user_id: uuid.UUID, day: date, first: str, frames: AsyncIterator[str]
    ) -> AsyncIterator[str]:
        """프레임을 그대로 흘리면서 sources 이벤트를 계정에 기록한다.

        기록을 sources 를 내보내기 **전**에 해 둬야, 클라이언트가 받은 session_id 로 바로 이어 물어도 소유 확인을 지난다.
        """
        frame = first
        try:
            while True:
                if frame.startswith("event: sources\n"):
                    await self._record(user_id, day, frame)
                yield frame
                try:
                    frame = await anext(frames)
                except StopAsyncIteration:
                    return
        finally:
            # 클라이언트가 끊으면 채팅 스트림도 닫아 STREAM_ABORTED 관찰 경로를 그대로 탄다.
            await frames.aclose()  # type: ignore[attr-defined]

    async def _record(self, user_id: uuid.UUID, day: date, frame: str) -> None:
        try:
            data = json.loads(frame.split("\ndata: ", 1)[1])
            await self.repo.record_turn(
                AskTurn(
                    message_id=uuid.UUID(data["message_id"]),
                    session_id=uuid.UUID(data["session_id"]),
                    user_id=user_id,
                    answer_mode=_mode(data.get("answer_mode")),
                    sources=data.get("sources") or [],
                    suggested_followups=[t for t in data.get("suggested_followups") or [] if isinstance(t, str)],
                )
            )
        except Exception as error:
            # 답은 이미 만들어졌다 — 기록 실패로 답 전달을 끊지 않는다. 다만 이 답은 계정 목록에 남지 않고 이어 묻기도
            # 소유 확인(403)에 막히므로, 쓴 횟수는 되돌린다.
            # 로그에는 예외 종류만 남긴다 — SQLAlchemy 오류 문구에는 바인딩 값(관련 질문·근거 본문)이 들어갈 수 있다.
            logger.error("hoondok ask turn 기록 실패: %s", type(error).__name__)
            try:
                # refund 가 먼저 롤백한다
                await self.repo.refund(user_id, day)
            except Exception as refund_error:
                logger.error("hoondok ask 횟수 되돌리기 실패: %s", type(refund_error).__name__)
                await self.repo.rollback()

    # --- 계정 보관 -------------------------------------------------------------------

    async def _mine(self, user_id: uuid.UUID, session_id: uuid.UUID) -> AskThread:
        thread = await self.repo.get_thread(session_id)
        if thread is None or thread.user_id != user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        return thread

    @staticmethod
    def _public_by_message(rows: list[PublicQuestion]) -> dict[uuid.UUID, PublicQuestion]:
        return {row.message_id: row for row in rows}

    async def list_mine(self, user_id: uuid.UUID, limit: int) -> MyAskListResponse:
        rows = await self.repo.list_threads(user_id, limit)
        session_ids = [thread.session_id for thread, _, _ in rows]
        first_turn: dict[uuid.UUID, AskTurn] = {}
        for turn in await self.repo.list_turns(session_ids):
            first_turn.setdefault(turn.session_id, turn)
        questions = await self.repo.list_first_questions(session_ids)
        public = self._public_by_message(
            await self.repo.list_public_questions(user_id, [t.message_id for t in first_turn.values()])
        )
        items = []
        for thread, last_at, turn_count in rows:
            turn = first_turn[thread.session_id]
            row = public.get(turn.message_id)
            items.append(
                MyAskSummary(
                    id=thread.session_id,
                    question=questions.get(thread.session_id, ""),
                    answer_mode=_mode(turn.answer_mode),  # type: ignore[arg-type]
                    turn_count=turn_count,
                    saved=thread.saved,
                    public_id=row.id if row else None,
                    public_status=row.status if row else None,  # type: ignore[arg-type]
                    created_at=thread.created_at,
                    last_at=last_at,  # type: ignore[arg-type]
                )
            )
        return MyAskListResponse(items=items)

    async def get_mine(self, user_id: uuid.UUID, session_id: uuid.UUID) -> MyAskDetail:
        thread = await self._mine(user_id, session_id)
        turns = await self.repo.list_turns([session_id])
        messages = await self.repo.list_messages([session_id])
        answers = {m.id: m for m in messages if m.role == MessageRole.ASSISTANT}
        questions = _questions_before_answers(messages)
        public = self._public_by_message(
            await self.repo.list_public_questions(user_id, [t.message_id for t in turns])
        )
        items = []
        for turn in turns:
            answer = answers.get(turn.message_id)
            if answer is None:
                continue
            row = public.get(turn.message_id)
            items.append(
                MyAskTurn(
                    message_id=turn.message_id,
                    question=questions.get(turn.message_id, ""),
                    answer_md=answer.content,
                    answer_mode=_mode(turn.answer_mode),  # type: ignore[arg-type]
                    sources=_sources(turn.sources),
                    suggested_followups=list(turn.suggested_followups or []),
                    public_id=row.id if row else None,
                    public_status=row.status if row else None,  # type: ignore[arg-type]
                    created_at=answer.created_at,
                )
            )
        return MyAskDetail(id=thread.session_id, saved=thread.saved, created_at=thread.created_at, turns=items)

    async def set_saved(self, user_id: uuid.UUID, session_id: uuid.UUID, saved: bool) -> MyAskDetail:
        thread = await self._mine(user_id, session_id)
        await self.repo.set_saved(thread, saved)
        return await self.get_mine(user_id, session_id)

    async def delete_mine(self, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
        """대화와 그 질문·답·근거 기록을 지운다.

        공개 신청 복사본(hoondok_public_questions)은 지우지 않는다 — 신청은 사용자가 따로 고른 익명 복사본이고, 검수를
        거쳐 추천 질문으로 나간 것을 대화 정리만으로 조용히 내리지 않으려는 결정이다. 내리려면 DELETE /hoondok/me/questions/{id}.
        """
        await self._mine(user_id, session_id)
        await self.repo.delete_thread(session_id)
