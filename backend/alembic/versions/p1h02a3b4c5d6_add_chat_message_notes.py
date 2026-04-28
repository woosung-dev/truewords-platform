"""add chat_message_notes table (P1-H)

Revision ID: p1h02a3b4c5d6
Revises: p1a01f00d51e
Create Date: 2026-04-28 23:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "p1h02a3b4c5d6"
down_revision: Union[str, None] = "p1a01f00d51e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """ADR-46 P1-H — 인용 카드 단위 사용자 노트 영속화 테이블.

    답변 메시지의 인용 카드(chunk_id) 단위로 사용자가 메모를 저장한다.
    UNIQUE (message_id, chunk_id, user_session_id) 로 1 사용자 1 카드 1 노트.
    """
    op.create_table(
        "chat_message_notes",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "message_id",
            sa.UUID(),
            sa.ForeignKey("session_messages.id"),
            nullable=False,
        ),
        sa.Column("chunk_id", sa.String(length=128), nullable=False),
        sa.Column("user_session_id", sa.String(length=128), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "message_id",
            "chunk_id",
            "user_session_id",
            name="uq_message_note_user_chunk",
        ),
    )
    op.create_index(
        "ix_chat_message_notes_message_id",
        "chat_message_notes",
        ["message_id"],
    )
    op.create_index(
        "ix_chat_message_notes_user_session_id",
        "chat_message_notes",
        ["user_session_id"],
    )
    op.create_index(
        "ix_chat_message_notes_updated_at",
        "chat_message_notes",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chat_message_notes_updated_at",
        table_name="chat_message_notes",
    )
    op.drop_index(
        "ix_chat_message_notes_user_session_id",
        table_name="chat_message_notes",
    )
    op.drop_index(
        "ix_chat_message_notes_message_id",
        table_name="chat_message_notes",
    )
    op.drop_table("chat_message_notes")
