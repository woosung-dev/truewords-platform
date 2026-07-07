"""answer_feedback current-state upsert (session_id + unique + updated_at)

Revision ID: f4b7c1a2d9e0
Revises: c1d2e3f4a5b6
Create Date: 2026-07-08 00:00:00.000000

answer_feedback 을 append-only 로그에서 "익명 세션별 메시지 피드백 현재 상태"
테이블로 재정의. user_session_id 컬럼 + unique(message_id, user_session_id) +
updated_at 추가. 기존 시연 데이터는 폐기(TRUNCATE) 후 새 스키마 적용.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f4b7c1a2d9e0"
down_revision: Union[str, None] = "c1d2e3f4a5b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 시연 단계 append-only 중복/모순 row 폐기 (사용자 확정). session_id NOT NULL
    # 컬럼을 안전하게 추가하기 위한 선행 조건이기도 하다.
    op.execute("TRUNCATE TABLE answer_feedback")

    op.add_column(
        "answer_feedback",
        sa.Column("user_session_id", sa.String(length=128), nullable=False),
    )
    op.add_column(
        "answer_feedback",
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_answer_feedback_user_session_id",
        "answer_feedback",
        ["user_session_id"],
    )
    op.create_unique_constraint(
        "uq_answer_feedback_session_message",
        "answer_feedback",
        ["message_id", "user_session_id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_answer_feedback_session_message",
        "answer_feedback",
        type_="unique",
    )
    op.drop_index(
        "ix_answer_feedback_user_session_id",
        table_name="answer_feedback",
    )
    op.drop_column("answer_feedback", "updated_at")
    op.drop_column("answer_feedback", "user_session_id")
