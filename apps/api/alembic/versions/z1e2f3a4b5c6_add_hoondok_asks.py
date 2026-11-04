"""add hoondok_ask_threads·turns·usage — AI 질문 계정 보관·하루 횟수 (DEC-PWA-025 2차)

Revision ID: z1e2f3a4b5c6
Revises: y0d1e2f3a4b5
"""

import sqlalchemy as sa
from alembic import op

revision = "z1e2f3a4b5c6"
down_revision = "y0d1e2f3a4b5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # FK 에 ondelete 없음 — 대화 삭제·계정 삭제는 AskRepository 가 자식부터 지운다.
    op.create_table(
        "hoondok_ask_threads",
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("research_sessions.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("saved", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_hoondok_ask_threads_user_id", "hoondok_ask_threads", ["user_id"])

    op.create_table(
        "hoondok_ask_turns",
        sa.Column("message_id", sa.Uuid(), sa.ForeignKey("session_messages.id"), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("hoondok_ask_threads.session_id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("answer_mode", sa.String(32), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("suggested_followups", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_hoondok_ask_turns_session_id", "hoondok_ask_turns", ["session_id"])
    op.create_index("ix_hoondok_ask_turns_user_id", "hoondok_ask_turns", ["user_id"])

    # (user_id, day) 복합 PK — 하루 한 행. day 는 KST 날짜.
    op.create_table(
        "hoondok_ask_usage",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("used", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("hoondok_ask_usage")
    op.drop_index("ix_hoondok_ask_turns_user_id", table_name="hoondok_ask_turns")
    op.drop_index("ix_hoondok_ask_turns_session_id", table_name="hoondok_ask_turns")
    op.drop_table("hoondok_ask_turns")
    op.drop_index("ix_hoondok_ask_threads_user_id", table_name="hoondok_ask_threads")
    op.drop_table("hoondok_ask_threads")
