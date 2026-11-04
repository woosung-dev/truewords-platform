"""add hoondok_public_questions — 검수 후 익명 공개되는 AI 질문 (DEC-PWA-025)

Revision ID: y0d1e2f3a4b5
Revises: x9c0d1e2f3a4
"""

import sqlalchemy as sa
from alembic import op

revision = "y0d1e2f3a4b5"
down_revision = "x9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # status 는 PG ENUM 이 아니라 varchar + 앱 Literal 검증이다 (additive-only 규칙).
    # message_id 는 session_messages 의 복사본 키라 FK 없이 unique 만 둔다 — 같은 답은 한 번만 신청된다.
    # user_id FK 에 ondelete 없음 — 계정 삭제는 PublicQuestionRepository.delete_for_user.
    op.create_table(
        "hoondok_public_questions",
        sa.Column("id", sa.String(16), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("answer_md", sa.Text(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("answer_mode", sa.String(32), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("message_id", name="uq_hoondok_public_questions_message_id"),
    )
    op.create_index("ix_hoondok_public_questions_user_id", "hoondok_public_questions", ["user_id"])
    op.create_index("ix_hoondok_public_questions_status", "hoondok_public_questions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_hoondok_public_questions_status", table_name="hoondok_public_questions")
    op.drop_index("ix_hoondok_public_questions_user_id", table_name="hoondok_public_questions")
    op.drop_table("hoondok_public_questions")
