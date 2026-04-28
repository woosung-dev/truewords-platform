"""P1-K — AnswerReview repository.

운영자 검수 라벨의 영속화 + 미검수 큐 + 라벨 통계 SQL 집계.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.chat.models import AnswerReview, ReviewLabel


_REJECTED_LABELS = (
    ReviewLabel.THEOLOGICAL_ERROR,
    ReviewLabel.CITATION_ERROR,
    ReviewLabel.TONE_ERROR,
    ReviewLabel.OFF_DOMAIN,
)


class AnswerReviewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        message_id: uuid.UUID,
        reviewer_user_id: uuid.UUID,
        label: ReviewLabel,
        notes: str | None = None,
    ) -> AnswerReview:
        """AnswerReview row 생성. 호출자가 commit 책임."""
        review = AnswerReview(
            message_id=message_id,
            reviewer_user_id=reviewer_user_id,
            label=label,
            notes=notes,
        )
        self.session.add(review)
        await self.session.flush()
        return review

    async def get_by_message_id(
        self, message_id: uuid.UUID
    ) -> list[AnswerReview]:
        """메시지의 모든 검수 라벨 (의견 차이 추적용)."""
        stmt = select(AnswerReview).where(AnswerReview.message_id == message_id)
        res = await self.session.exec(stmt)  # type: ignore[call-overload]
        return list(res.all())

    async def get_unreviewed_queue(
        self,
        *,
        chatbot_id: uuid.UUID | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """미검수 assistant 메시지 큐.

        - 부정 피드백 받은 메시지를 우선, 그 다음 최신순.
        - 이미 AnswerReview row 가 있는 메시지는 제외.
        """
        params: dict = {"limit": limit}
        chatbot_filter = ""
        if chatbot_id is not None:
            chatbot_filter = "AND rs.chatbot_config_id = :chatbot_id"
            params["chatbot_id"] = chatbot_id

        # role enum 은 PostgreSQL 에서 'ASSISTANT' 로 저장됨 (대문자).
        # AnalyticsRepository.get_query_details 와 동일 패턴.
        sql = f"""
            SELECT
                sm.id AS message_id,
                sm.session_id AS session_id,
                rs.chatbot_config_id AS chatbot_id,
                sm.content AS answer_text,
                sm.created_at AS answered_at,
                EXISTS (
                    SELECT 1 FROM answer_feedback af
                    WHERE af.message_id = sm.id
                      AND af.feedback_type != 'HELPFUL'
                ) AS has_negative_feedback,
                (
                    SELECT user_sm.content
                    FROM session_messages user_sm
                    WHERE user_sm.session_id = sm.session_id
                      AND user_sm.role = 'USER'
                      AND user_sm.created_at < sm.created_at
                    ORDER BY user_sm.created_at DESC
                    LIMIT 1
                ) AS question_text
            FROM session_messages sm
            JOIN research_sessions rs ON rs.id = sm.session_id
            WHERE sm.role = 'ASSISTANT'
              {chatbot_filter}
              AND NOT EXISTS (
                  SELECT 1 FROM answer_reviews ar
                  WHERE ar.message_id = sm.id
              )
            ORDER BY has_negative_feedback DESC, sm.created_at DESC
            LIMIT :limit
        """

        result = await self.session.execute(text(sql), params)
        return [
            {
                "message_id": row.message_id,
                "session_id": row.session_id,
                "chatbot_id": row.chatbot_id,
                "question_text": row.question_text,
                "answer_text": row.answer_text,
                "answered_at": row.answered_at,
                "has_negative_feedback": bool(row.has_negative_feedback),
            }
            for row in result.all()
        ]

    async def get_stats(self, period_days: int = 7) -> dict:
        """라벨별 카운트 + 적합/부적합 비율.

        반환:
            {
                "period_days": int,
                "total_reviewed": int,
                "approved_count": int,
                "rejected_count": int,
                "approval_rate": float,
                "distribution": [{"label": str, "count": int}, ...]
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=period_days)
        result = await self.session.execute(
            text(
                """
                SELECT label::text AS label, COUNT(*) AS count
                FROM answer_reviews
                WHERE created_at >= :cutoff
                GROUP BY label
                ORDER BY count DESC
                """
            ),
            {"cutoff": cutoff},
        )
        rows = result.all()
        distribution = [
            {"label": row.label, "count": int(row.count)} for row in rows
        ]
        total = sum(item["count"] for item in distribution)
        approved = sum(
            item["count"]
            for item in distribution
            if item["label"] == ReviewLabel.APPROVED.value
        )
        rejected_values = {label.value for label in _REJECTED_LABELS}
        rejected = sum(
            item["count"]
            for item in distribution
            if item["label"] in rejected_values
        )
        approval_rate = round(approved / total, 3) if total > 0 else 0.0

        return {
            "period_days": period_days,
            "total_reviewed": total,
            "approved_count": approved,
            "rejected_count": rejected,
            "approval_rate": approval_rate,
            "distribution": distribution,
        }

    async def list_negative_examples(
        self, limit: int = 10
    ) -> list[AnswerReview]:
        """negative few-shot 학습 데이터 후보 — 부적합 라벨 최신 N건.

        실제 system prompt 주입 hook 은 별도 PR. 본 메서드는 hook 자리만 열어둔다.
        """
        rejected_labels = list(_REJECTED_LABELS)
        stmt = (
            select(AnswerReview)
            .where(AnswerReview.label.in_(rejected_labels))  # type: ignore[attr-defined]
            .order_by(AnswerReview.created_at.desc())  # type: ignore[attr-defined]
            .limit(limit)
        )
        res = await self.session.exec(stmt)  # type: ignore[call-overload]
        return list(res.all())

    async def commit(self) -> None:
        await self.session.commit()
