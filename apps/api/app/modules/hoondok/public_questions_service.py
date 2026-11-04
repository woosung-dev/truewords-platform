"""공개 질문 (DEC-PWA-025) — 기본 비공개, 사용자가 고른 것만 협회 검수 뒤 익명 공개.

- 신청은 훈독 로그인 필수. 질문·답·근거는 message_id 로 서버 기록을 복사한다(클라이언트 본문 불신).
- 마음 돌봄(pastoral)·위기 신호 답, 근거 인용이 없는 답, 이어 물은 답(세션 첫 답이 아님)은 공개하지 않는다(409).
- 본인이 같은 답을 다시 신청하면 기존 신청을 그대로 돌려준다(응답 유실 복구).
- 공개 범위는 status=published 뿐. 본인 삭제는 행을 지워 관리자도 되살릴 수 없게 한다.
- 신청자는 답이 달린 채팅 세션의 소유자(research_sessions.user_id = 훈독 user id)여야 한다. 아니면 없는 답과 같은 404 —
  훈독 AI 질문은 POST /hoondok/ask/stream 으로만 계정 세션에 묶인다(DEC-PWA-025 2차).
"""

import re
import secrets
import uuid

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import utcnow
from app.modules.admin.service import AdminService
from app.modules.chat.models import MessageRole
from app.modules.hoondok.models import PublicQuestion
from app.modules.hoondok.public_questions_repository import PublicQuestionRepository
from app.modules.hoondok.public_questions_schemas import (
    MyPublicQuestionItem,
    MyPublicQuestionListResponse,
    PublicQuestionAdminItem,
    PublicQuestionAdminListResponse,
    PublicQuestionDetail,
    PublicQuestionListResponse,
    PublicQuestionReview,
    PublicQuestionSource,
    PublicQuestionSummary,
)

PUBLIC_STATUS = "published"
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
    )


def _published_at(row: PublicQuestion):
    # published 행은 검수 때 reviewed_at 이 항상 채워진다. 직접 넣은 데이터 대비로 신청 시각을 쓴다.
    return row.reviewed_at or row.created_at


class PublicQuestionService:
    def __init__(self, repo: PublicQuestionRepository) -> None:
        self.repo = repo

    # --- 본인 ---------------------------------------------------------------------

    async def submit(self, user_id: uuid.UUID, message_id: uuid.UUID) -> MyPublicQuestionItem:
        answer = await self.repo.get_message(message_id)
        if answer is None or answer.role != MessageRole.ASSISTANT:
            raise HTTPException(status.HTTP_404_NOT_FOUND, ANSWER_NOT_FOUND)
        if await self.repo.get_session_owner(answer.session_id) != user_id:
            # 남의 답·익명 세션·시연 챗 답 — 존재 여부를 드러내지 않도록 없는 답과 같은 404.
            raise HTTPException(status.HTTP_404_NOT_FOUND, ANSWER_NOT_FOUND)
        existing = await self.repo.get_by_message(message_id)
        if existing is not None:
            # 본인 재신청(응답 유실 뒤 다시 신청)은 기존 신청을 돌려줘 기기가 publicId 를 되찾게 한다.
            if existing.user_id == user_id:
                return _mine(existing)
            raise HTTPException(status.HTTP_409_CONFLICT, DUPLICATE)
        # 모드가 없는 답(메타 안내·캐시 적중·옛 기록)은 위기 판정 근거가 없어 공개하지 않는다.
        if (
            answer.resolved_answer_mode is None
            or answer.resolved_answer_mode == "pastoral"
            or answer.persona_overridden
            or answer.crisis_trigger
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, NOT_SHAREABLE)
        # 위기 판정은 턴마다 그 질문만 본다. 앞 턴의 사연을 이어받은 답이 새지 않게 세션 첫 답만 받는다.
        if await self.repo.has_answer_before(answer):
            raise HTTPException(status.HTTP_409_CONFLICT, NOT_FIRST_ANSWER)
        question = await self.repo.get_question_before(answer)
        if question is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "질문을 찾을 수 없어요")
        citations = await self.repo.list_citations(message_id, SOURCE_LIMIT)
        if not citations:
            raise HTTPException(status.HTTP_409_CONFLICT, NO_EVIDENCE)
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
            raise HTTPException(status.HTTP_409_CONFLICT, DUPLICATE) from None
        return _mine(saved)

    async def list_mine(self, user_id: uuid.UUID) -> MyPublicQuestionListResponse:
        return MyPublicQuestionListResponse(items=[_mine(r) for r in await self.repo.list_for_user(user_id)])

    async def delete_mine(self, user_id: uuid.UUID, question_id: str) -> None:
        """본인 것만 지운다. 남의 것·없는 것은 구분 없이 404."""
        row = await self.repo.get(question_id)
        if row is None or row.user_id != user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        await self.repo.delete(row)

    # --- 공개 -----------------------------------------------------------------------

    async def _published(self, question_id: str) -> PublicQuestion:
        row = await self.repo.get(question_id)
        if row is None or row.status != PUBLIC_STATUS:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        return row

    async def list_public(self, q: str | None, cursor: str | None, limit: int) -> PublicQuestionListResponse:
        after = None
        if cursor:
            after = await self.repo.get(cursor)
            if after is None or after.status != PUBLIC_STATUS:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "목록 위치(cursor)가 올바르지 않아요")
        keyword = (q or "").strip() or None
        rows = await self.repo.list_published(keyword, after, limit + 1)
        has_more = len(rows) > limit
        rows = rows[:limit]
        return PublicQuestionListResponse(
            items=[
                PublicQuestionSummary(
                    id=r.id,
                    question=r.question,
                    preview=make_preview(r.answer_md),
                    answer_mode=r.answer_mode,  # type: ignore[arg-type]
                    published_at=_published_at(r),
                )
                for r in rows
            ],
            next_cursor=rows[-1].id if has_more else None,
        )

    async def get_public(self, question_id: str) -> PublicQuestionDetail:
        row = await self._published(question_id)
        return PublicQuestionDetail(
            id=row.id,
            question=row.question,
            answer_md=row.answer_md,
            sources=_sources(row),
            answer_mode=row.answer_mode,  # type: ignore[arg-type]
            published_at=_published_at(row),
        )


class PublicQuestionAdminService:
    """검수 — 대기열 조회와 공개·숨김."""

    def __init__(self, repo: PublicQuestionRepository) -> None:
        self.repo = repo

    async def list(self, status_filter: str | None, page: int, page_size: int) -> PublicQuestionAdminListResponse:
        rows, total = await self.repo.page(status_filter, (page - 1) * page_size, page_size)
        return PublicQuestionAdminListResponse(
            items=[_admin(r) for r in rows], total=total, page=page, page_size=page_size
        )

    async def review_with_audit(
        self, question_id: str, data: PublicQuestionReview, audit: AdminService, actor_id: uuid.UUID
    ) -> PublicQuestionAdminItem:
        row = await self.repo.get(question_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)
        row.status = data.status
        row.reviewed_at = utcnow()
        saved = await self.repo.save(row, commit=False)
        # target_id 는 UUID 컬럼이라 slug 대신 원본 message_id 를 남기고, slug 는 changes 에 둔다.
        await audit.log_audit(
            admin_user_id=actor_id,
            action="public_question.review",
            target_table="hoondok_public_questions",
            target_id=saved.message_id,
            changes={"id": saved.id, "status": data.status},
        )
        return _admin(saved)
