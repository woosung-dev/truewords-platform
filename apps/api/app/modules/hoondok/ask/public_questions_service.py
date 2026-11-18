"""공개 질문 (DEC-PWA-025) — 기본 비공개, 사용자가 고른 것만 협회 검수 뒤 익명 공개.

- 신청은 훈독 로그인 필수. 질문·답·근거는 message_id 로 서버 기록을 복사한다(클라이언트 본문 불신).
- 마음 돌봄(pastoral)·위기 신호 답, 근거 인용이 없는 답, 이어 물은 답(세션 첫 답이 아님)은 공개하지 않는다(409).
- 본인이 같은 답을 다시 신청하면 기존 신청을 그대로 돌려준다(응답 유실 복구).
- 공개 범위는 status=published 뿐. 본인 삭제는 행을 지워 관리자도 되살릴 수 없게 한다.
- 공개 목록은 고정(관리자 지정, 최대 MAX_PINNED) → 인기도(조회 수 + 3 × 질문 수) → 최근 공개순. 페이지는 offset 을 담은 불투명 cursor 로 잇는다.
  조회는 (질문, 조회자, KST 날짜)당 1회만 세고, 질문 수는 공개 질문을 보고 새로 물어 답을 받은 계정당 1회다.
- 신청자는 답이 달린 채팅 세션의 소유자(research_sessions.user_id = 훈독 user id)여야 한다. 아니면 없는 답과 같은 404 —
  훈독 AI 질문은 POST /hoondok/ask/stream 으로만 계정 세션에 묶인다(DEC-PWA-025 2차).
"""

import re
import secrets
import uuid
from collections.abc import Callable
from datetime import date

from sqlalchemy.exc import IntegrityError

from app.core.errors import ConflictError, InvalidError, NotFoundError
from app.core.common.clock import today_kst, utcnow
from app.modules.admin.service import AdminService
from app.modules.chat.models import MessageRole
from app.modules.hoondok.models import PublicQuestion
from app.modules.hoondok.ask.public_questions_repository import (
    POPULARITY_ASK_WEIGHT,
    AdminSort,
    PublicQuestionRepository,
    viewer_key,
)
from app.modules.hoondok.ask.public_questions_schemas import (
    MyPublicQuestionItem,
    MyPublicQuestionListResponse,
    PublicQuestionAdminItem,
    PublicQuestionAdminListResponse,
    PublicQuestionBookmarkListResponse,
    PublicQuestionDetail,
    PublicQuestionListResponse,
    PublicQuestionPinsReorder,
    PublicQuestionPinsResponse,
    PublicQuestionReview,
    PublicQuestionSource,
    PublicQuestionSummary,
)

PUBLIC_STATUS = "published"
MAX_PINNED = 10
INVALID_CURSOR = "목록 위치(cursor)가 올바르지 않아요"
PIN_NEEDS_PUBLISHED = "공개 중인 질문만 고정할 수 있어요"
PIN_LIMIT = f"고정 질문은 최대 {MAX_PINNED}개예요"
PIN_SET_MISMATCH = "고정된 질문 전체를 한 번씩만 보내야 해요"
MAX_CURSOR_LENGTH = 9
MAX_CURSOR_OFFSET = 100_000
SOURCE_LIMIT = 3
PREVIEW_LENGTH = 120
NOT_FOUND = "질문을 찾을 수 없어요"
ANSWER_NOT_FOUND = "답을 찾을 수 없어요"
DUPLICATE = "이미 공개를 신청한 답이에요"
NOT_SHAREABLE = "마음 돌봄이 필요한 답은 공개할 수 없어요"
NO_EVIDENCE = "근거 말씀이 없는 답은 공개할 수 없어요"
NOT_FIRST_ANSWER = "이어 물은 답은 공개할 수 없어요"
_MARKDOWN_MARKS = re.compile(r"[#*_>`~\[\]|]")
_SPACES = re.compile(r"\s+")


def new_slug() -> str:
    """12자 URL-safe slug(72비트). 순번·UUID 를 내보내지 않아 목록 밖 질문을 추측하기 어렵다."""
    return secrets.token_urlsafe(9)


def make_preview(answer_md: str) -> str:
    plain = _SPACES.sub(" ", _MARKDOWN_MARKS.sub("", answer_md)).strip()
    return plain if len(plain) <= PREVIEW_LENGTH else plain[:PREVIEW_LENGTH].rstrip() + "…"


def _sources(row: PublicQuestion) -> list[PublicQuestionSource]:
    return [PublicQuestionSource.model_validate(s) for s in row.sources or []]


def _mine(row: PublicQuestion) -> MyPublicQuestionItem:
    return MyPublicQuestionItem.model_validate(row, from_attributes=True)


def _admin(row: PublicQuestion) -> PublicQuestionAdminItem:
    return PublicQuestionAdminItem(
        id=row.id,
        question=row.question,
        answer_md=row.answer_md,
        sources=_sources(row),
        answer_mode=row.answer_mode,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
        view_count=row.view_count,
        ask_count=row.ask_count,
        score=row.view_count + POPULARITY_ASK_WEIGHT * row.ask_count,
        pin_order=row.pin_order,
    )


def _parse_cursor(cursor: str | None) -> int:
    """불투명 cursor(현재는 offset 문자열) → offset. 비어 있으면 0, 숫자가 아니거나 음수면 422."""
    if not cursor:
        return 0
    if len(cursor) > MAX_CURSOR_LENGTH or not cursor.isascii() or not cursor.isdigit():
        raise InvalidError(INVALID_CURSOR)
    offset = int(cursor)
    if offset > MAX_CURSOR_OFFSET:  # DB 정수 범위를 넘는 offset 이 500 을 내지 않게
        raise InvalidError(INVALID_CURSOR)
    return offset


def _published_at(row: PublicQuestion):
    # published 행은 검수 때 reviewed_at 이 항상 채워진다. 직접 넣은 데이터 대비로 신청 시각을 쓴다.
    return row.reviewed_at or row.created_at


class PublicQuestionService:
    def __init__(
        self, repo: PublicQuestionRepository, *, today_fn: Callable[[], date] = today_kst
    ) -> None:
        self.repo = repo
        self.today_fn = today_fn

    # --- 본인 ---------------------------------------------------------------------

    async def submit(self, user_id: uuid.UUID, message_id: uuid.UUID) -> MyPublicQuestionItem:
        answer = await self.repo.get_message(message_id)
        if answer is None or answer.role != MessageRole.ASSISTANT:
            raise NotFoundError(ANSWER_NOT_FOUND)
        if await self.repo.get_session_owner(answer.session_id) != user_id:
            # 남의 답·익명 세션·시연 챗 답 — 존재 여부를 드러내지 않도록 없는 답과 같은 404.
            raise NotFoundError(ANSWER_NOT_FOUND)
        existing = await self.repo.get_by_message(message_id)
        if existing is not None:
            # 본인 재신청(응답 유실 뒤 다시 신청)은 기존 신청을 돌려줘 기기가 publicId 를 되찾게 한다.
            if existing.user_id == user_id:
                return _mine(existing)
            raise ConflictError(DUPLICATE)
        # 모드가 없는 답(메타 안내·캐시 적중·옛 기록)은 위기 판정 근거가 없어 공개하지 않는다.
        if (
            answer.resolved_answer_mode is None
            or answer.resolved_answer_mode == "pastoral"
            or answer.persona_overridden
            or answer.crisis_trigger
        ):
            raise ConflictError(NOT_SHAREABLE)
        # 위기 판정은 턴마다 그 질문만 본다. 앞 턴의 사연을 이어받은 답이 새지 않게 세션 첫 답만 받는다.
        if await self.repo.has_answer_before(answer):
            raise ConflictError(NOT_FIRST_ANSWER)
        question = await self.repo.get_question_before(answer)
        if question is None:
            raise NotFoundError("질문을 찾을 수 없어요")
        citations = await self.repo.list_citations(message_id, SOURCE_LIMIT)
        if not citations:
            raise ConflictError(NO_EVIDENCE)
        row = PublicQuestion(
            id=new_slug(),
            user_id=user_id,
            message_id=message_id,
            question=question.content,
            answer_md=answer.content,
            sources=[
                {"source": c.source, "volume": c.volume_raw or str(c.volume), "text": c.text_snippet}
                for c in citations
            ],
            answer_mode=answer.resolved_answer_mode,
            status="pending",
        )
        try:
            saved = await self.repo.save(row)
        except IntegrityError:
            # 같은 답의 동시 신청 — message_id unique 가 잡았다. 본인끼리 겹친 것(답 직후 자동 신청 + 버튼)이면
            # 먼저 들어간 신청을 돌려줘 위의 본인 재신청과 같게 끝낸다.
            winner = await self.repo.get_by_message(message_id)
            if winner is not None and winner.user_id == user_id:
                return _mine(winner)
            raise ConflictError(DUPLICATE) from None
        return _mine(saved)

    async def list_mine(self, user_id: uuid.UUID) -> MyPublicQuestionListResponse:
        return MyPublicQuestionListResponse(items=[_mine(r) for r in await self.repo.list_for_user(user_id)])

    async def delete_mine(self, user_id: uuid.UUID, question_id: str) -> None:
        """본인 것만 지운다. 남의 것·없는 것은 구분 없이 404."""
        row = await self.repo.get(question_id)
        if row is None or row.user_id != user_id:
            raise NotFoundError(NOT_FOUND)
        await self.repo.delete(row)

    # --- 공개 -----------------------------------------------------------------------

    async def _published(self, question_id: str) -> PublicQuestion:
        row = await self.repo.get(question_id)
        if row is None or row.status != PUBLIC_STATUS:
            raise NotFoundError(NOT_FOUND)
        return row

    @staticmethod
    def _summary(r: PublicQuestion, bookmarked: bool) -> PublicQuestionSummary:
        return PublicQuestionSummary(
            id=r.id,
            question=r.question,
            preview=make_preview(r.answer_md),
            answer_mode=r.answer_mode,  # type: ignore[arg-type]
            published_at=_published_at(r),
            pinned=r.pin_order is not None,
            view_count=r.view_count,
            bookmarked=bookmarked,
        )

    async def list_public(
        self, q: str | None, cursor: str | None, limit: int, user_id: uuid.UUID | None = None
    ) -> PublicQuestionListResponse:
        """cursor 는 불투명 문자열(offset). 숫자가 아니면 422 — 예전 keyset cursor(질문 id)도 422 다."""
        offset = _parse_cursor(cursor)
        keyword = (q or "").strip() or None
        rows = await self.repo.list_published(keyword, offset, limit + 1)
        has_more = len(rows) > limit
        rows = rows[:limit]
        mine = await self.repo.bookmarked_ids(user_id, [r.id for r in rows]) if user_id else set()
        return PublicQuestionListResponse(
            items=[self._summary(r, r.id in mine) for r in rows],
            next_cursor=str(offset + limit) if has_more else None,
        )

    async def record_view(self, question_id: str, user_id: uuid.UUID | None, client_ip: str) -> None:
        """공개 질문 조회 1회. 로그인 계정이 우선, 익명은 클라이언트 IP 기준(둘 다 HMAC 키). published 가 아니면 404.

        조회자 식별은 서버가 정한다 — 클라이언트가 보내는 값으로 조회 수를 부풀릴 수 없다.
        """
        await self._published(question_id)
        key = viewer_key("u", user_id) if user_id is not None else viewer_key("ip", client_ip)
        await self.repo.record_view(question_id, key, self.today_fn())

    async def put_bookmark(self, user_id: uuid.UUID, question_id: str) -> None:
        """멱등. published 가 아니면 404."""
        await self._published(question_id)
        await self.repo.add_bookmark(question_id, user_id)

    async def delete_bookmark(self, user_id: uuid.UUID, question_id: str) -> None:
        """멱등. 공개가 내려간 질문의 남은 북마크도 지울 수 있게 상태·존재를 확인하지 않는다."""
        await self.repo.remove_bookmark(question_id, user_id)

    async def list_bookmarks(self, user_id: uuid.UUID, limit: int) -> PublicQuestionBookmarkListResponse:
        rows = await self.repo.list_bookmarked(user_id, limit)
        return PublicQuestionBookmarkListResponse(items=[self._summary(r, True) for r in rows])

    async def get_public(self, question_id: str, user_id: uuid.UUID | None = None) -> PublicQuestionDetail:
        row = await self._published(question_id)
        bookmarked = user_id is not None and row.id in await self.repo.bookmarked_ids(user_id, [row.id])
        return PublicQuestionDetail(
            id=row.id,
            question=row.question,
            answer_md=row.answer_md,
            sources=_sources(row),
            answer_mode=row.answer_mode,  # type: ignore[arg-type]
            published_at=_published_at(row),
            bookmarked=bookmarked,
        )


class PublicQuestionAdminService:
    """검수 — 대기열 조회와 공개·숨김."""

    def __init__(self, repo: PublicQuestionRepository) -> None:
        self.repo = repo

    async def list(
        self, status_filter: str | None, q: str | None, sort: AdminSort, page: int, page_size: int
    ) -> PublicQuestionAdminListResponse:
        keyword = (q or "").strip() or None
        rows, total = await self.repo.page(status_filter, keyword, sort, (page - 1) * page_size, page_size)
        return PublicQuestionAdminListResponse(
            items=[_admin(r) for r in rows], total=total, page=page, page_size=page_size
        )

    async def list_pins(self) -> PublicQuestionPinsResponse:
        return PublicQuestionPinsResponse(items=[_admin(r) for r in await self.repo.list_pins()])

    async def review_with_audit(
        self, question_id: str, data: PublicQuestionReview, audit: AdminService, actor_id: uuid.UUID
    ) -> PublicQuestionAdminItem:
        """상태 전환(먼저) → 고정 변경. 숨김은 고정을 푼다. 고정은 최종 상태가 published 일 때만, 최대 MAX_PINNED."""
        # 고정 집합을 세고 다시 매기기 전에 고정 행·대상 행을 잠가(Postgres) 동시 변경이 같은 번호·초과 고정을 만들지 못하게 한다.
        await self.repo.list_pins(lock=True)
        row = await self.repo.get_for_update(question_id)
        if row is None:
            raise NotFoundError(NOT_FOUND)
        status_changed = data.status is not None and data.status != row.status
        final_status = data.status or row.status
        pins: list[PublicQuestion] = []
        if data.pinned:
            if final_status != PUBLIC_STATUS:
                raise ConflictError(PIN_NEEDS_PUBLISHED)
            pins = await self.repo.list_pins()
            if row.pin_order is None and len(pins) >= MAX_PINNED:
                raise ConflictError(PIN_LIMIT)

        changes: dict = {"id": row.id}
        if status_changed:
            # 같은 상태를 다시 보내면(재공개 등) 검수 시각·감사 기록을 건드리지 않는다.
            row.status = data.status  # type: ignore[assignment]
            row.reviewed_at = utcnow()
            changes["status"] = data.status
        unpin = row.pin_order is not None and (data.pinned is False or final_status != PUBLIC_STATUS)
        if unpin:
            row.pin_order = None
            changes["pinned"] = False
        elif data.pinned and row.pin_order is None:
            row.pin_order = max((p.pin_order or 0 for p in pins), default=-1) + 1
            changes["pinned"] = True
        saved = await self.repo.save(row, commit=False)
        if unpin:
            # 남은 고정을 0..n-1 로 이어 붙인다.
            await self.repo.renumber_pins()
        # target_id 는 UUID 컬럼이라 slug 대신 원본 message_id 를 남기고, slug 는 changes 에 둔다.
        await audit.log_audit(
            admin_user_id=actor_id,
            action="public_question.review",
            target_table="hoondok_public_questions",
            target_id=saved.message_id,
            changes=changes,
        )
        return _admin(saved)

    async def reorder_pins(
        self, data: PublicQuestionPinsReorder, audit: AdminService, actor_id: uuid.UUID
    ) -> PublicQuestionPinsResponse:
        """고정 순서 바꾸기 — ids 는 현재 고정 집합과 정확히 같아야 한다(중복·누락·추가 422)."""
        pins = {p.id: p for p in await self.repo.list_pins(lock=True)}
        if len(set(data.ids)) != len(data.ids) or set(data.ids) != set(pins):
            raise InvalidError(PIN_SET_MISMATCH)
        for index, question_id in enumerate(data.ids):
            pins[question_id].pin_order = index
            await self.repo.save(pins[question_id], commit=False)
        if data.ids:
            # 한 번의 변경이라 감사 기록도 한 건 — 대상은 맨 위 질문의 message_id, 전체 순서는 changes 에 둔다.
            await audit.log_audit(
                admin_user_id=actor_id,
                action="public_question.reorder_pins",
                target_table="hoondok_public_questions",
                target_id=pins[data.ids[0]].message_id,
                changes={"ids": list(data.ids)},
            )
        return await self.list_pins()
