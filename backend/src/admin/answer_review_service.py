"""P1-K — AnswerReview Service.

비즈니스 로직: enum 변환, 검수 큐 조회, 통계, negative few-shot 후보.
AsyncSession 직접 import 금지 — Repository 만 사용한다.
"""

from __future__ import annotations

import uuid

from src.admin.answer_review_repository import AnswerReviewRepository
from src.admin.answer_review_schemas import (
    AnswerReviewResponse,
    ReviewLabelCount,
    ReviewQueueItem,
    ReviewQueueResponse,
    ReviewStatsResponse,
)
from src.chat.models import AnswerReview, ReviewLabel


class AnswerReviewService:
    def __init__(self, repo: AnswerReviewRepository) -> None:
        self.repo = repo

    async def create_review(
        self,
        *,
        message_id: uuid.UUID,
        reviewer_user_id: uuid.UUID,
        label: str,
        notes: str | None,
    ) -> AnswerReviewResponse:
        """검수 라벨 생성. Pydantic Literal 통과 후라 enum 변환은 항상 안전."""
        label_enum = ReviewLabel(label)
        review = await self.repo.create(
            message_id=message_id,
            reviewer_user_id=reviewer_user_id,
            label=label_enum,
            notes=notes,
        )
        await self.repo.commit()
        return _to_response(review)

    async def get_queue(
        self,
        *,
        chatbot_id: uuid.UUID | None,
        limit: int,
    ) -> ReviewQueueResponse:
        rows = await self.repo.get_unreviewed_queue(
            chatbot_id=chatbot_id, limit=limit
        )
        items = [
            ReviewQueueItem(
                message_id=row["message_id"],
                session_id=row["session_id"],
                chatbot_id=row["chatbot_id"],
                question_text=row["question_text"],
                answer_text=row["answer_text"],
                answered_at=row["answered_at"],
                has_negative_feedback=row["has_negative_feedback"],
            )
            for row in rows
        ]
        return ReviewQueueResponse(items=items, total=len(items))

    async def get_stats(self, period_days: int) -> ReviewStatsResponse:
        data = await self.repo.get_stats(period_days)
        return ReviewStatsResponse(
            period_days=data["period_days"],
            total_reviewed=data["total_reviewed"],
            approved_count=data["approved_count"],
            rejected_count=data["rejected_count"],
            approval_rate=data["approval_rate"],
            distribution=[
                ReviewLabelCount(label=item["label"], count=item["count"])  # type: ignore[arg-type]
                for item in data["distribution"]
            ],
        )

    async def get_negative_examples(
        self, limit: int = 10
    ) -> list[AnswerReview]:
        """negative few-shot 학습 데이터 후보 placeholder.

        TODO(P1-K follow-up): 본 메서드 결과를 system prompt 의 negative example
        섹션에 주입하는 hook 을 별도 PR 로 추가. 현재는 query 만 가능하도록
        자리만 마련.
        """
        return await self.repo.list_negative_examples(limit=limit)


def _to_response(review: AnswerReview) -> AnswerReviewResponse:
    return AnswerReviewResponse(
        id=review.id,
        message_id=review.message_id,
        reviewer_user_id=review.reviewer_user_id,
        label=review.label.value,  # type: ignore[arg-type]
        notes=review.notes,
        created_at=review.created_at,
    )
