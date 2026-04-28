"""add answer_reviews table (P1-K)

Revision ID: p1k01a02b03c
Revises: p1a01f00d51e
Create Date: 2026-04-28 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "p1k01a02b03c"
down_revision: Union[str, None] = "p1a01f00d51e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_REVIEW_LABELS = (
    "approved",
    "theological_error",
    "citation_error",
    "tone_error",
    "off_domain",
)


def upgrade() -> None:
    """ADR-46 P1-K — 운영자 검수 사이클 + 이단/오류 학습 데이터 테이블.

    AnswerFeedback (사용자/혼합 자유서술) 과 별도 테이블. 부적합 라벨은
    negative few-shot 학습 데이터의 원천이 된다.

    PostgreSQL ENUM ``reviewlabel`` 은 fix C2 와 동일한 DO/IF NOT EXISTS 패턴으로
    멱등성 보장. SQLAlchemy 의 ``create_type=False`` 와 함께 사용해 테이블 생성 시
    중복 생성 시도가 일어나지 않게 한다.
    """
    review_label_enum = sa.Enum(
        *_REVIEW_LABELS,
        name="reviewlabel",
        create_type=False,
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'reviewlabel'
            ) THEN
                CREATE TYPE reviewlabel AS ENUM
                    ('approved', 'theological_error', 'citation_error',
                     'tone_error', 'off_domain');
            END IF;
        END$$;
        """
    )

    op.create_table(
        "answer_reviews",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "message_id",
            sa.UUID(),
            sa.ForeignKey("session_messages.id"),
            nullable=False,
        ),
        sa.Column("reviewer_user_id", sa.UUID(), nullable=False),
        sa.Column("label", review_label_enum, nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_answer_reviews_message_id",
        "answer_reviews",
        ["message_id"],
    )
    op.create_index(
        "ix_answer_reviews_reviewer_user_id",
        "answer_reviews",
        ["reviewer_user_id"],
    )
    op.create_index(
        "ix_answer_reviews_created_at",
        "answer_reviews",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_answer_reviews_created_at", table_name="answer_reviews")
    op.drop_index("ix_answer_reviews_reviewer_user_id", table_name="answer_reviews")
    op.drop_index("ix_answer_reviews_message_id", table_name="answer_reviews")
    op.drop_table("answer_reviews")
    op.execute("DROP TYPE IF EXISTS reviewlabel")
