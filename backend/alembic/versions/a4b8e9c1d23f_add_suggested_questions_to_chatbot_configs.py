# 봇별 동적 추천 질문 칩 컬럼 (cron job 으로 매일 03:30 KST 갱신)
"""add suggested_questions to chatbot_configs

Revision ID: a4b8e9c1d23f
Revises: f3a4b5c6d7e8
Create Date: 2026-05-10 00:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a4b8e9c1d23f"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """챗봇 입력 화면 추천 질문 칩 (봇별 동적).

    suggested_questions: list[str], default `[]` — cron 갱신 전엔 빈 리스트
    suggested_at: datetime | None — 마지막 갱신 시각

    cron job 이 30 일 질문 로그 + RAG sample 로 매일 03:30 KST 갱신.
    빈 리스트면 프론트가 FALLBACK_PROMPTS 4 개로 fallback.
    """
    op.add_column(
        "chatbot_configs",
        sa.Column(
            "suggested_questions",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )
    op.add_column(
        "chatbot_configs",
        sa.Column("suggested_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("chatbot_configs", "suggested_at")
    op.drop_column("chatbot_configs", "suggested_questions")
