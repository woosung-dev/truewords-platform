"""add chat_message_reactions table (P1-A)

Revision ID: p1a01f00d51e
Revises: e1a8c5f7d3b2
Create Date: 2026-04-28 22:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "p1a01f00d51e"
# main rebase (2026-05-01): main 의 chain head 위로 rebase.
# 원래는 4d872f8826ad 분기였으나 main 이 c59c535a2200 → aa6f4b908ef4 →
# e1a8c5f7d3b2 까지 진행되어 multi-head 발생.
down_revision: Union[str, None] = "e1a8c5f7d3b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_REACTION_KINDS = ("thumbs_up", "thumbs_down", "save")


def upgrade() -> None:
    """ADR-46 P1-A — 답변 즉시 반응 (👍/👎/💾) 테이블.

    AnswerFeedback (운영자 라벨링용) 과 분리. 사용자가 1-tap 으로 토글한다.
    Unique (message_id, user_session_id, kind) 로 중복 방지.
    """
    # PostgreSQL ENUM 타입 — DO 블록으로 멱등성 보장.
    # CREATE TYPE 은 IF NOT EXISTS 미지원 → DO 블록 안에서 SELECT pg_type 검사.
    # postgresql.ENUM 의 create_type=False 는 op.create_table 에서 ENUM 재생성을
    # 정확히 막아준다 (sa.Enum 은 dialect 에 따라 무시될 수 있음).
    reaction_kind_enum = postgresql.ENUM(
        *_REACTION_KINDS,
        name="messagereactionkind",
        create_type=False,
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_type WHERE typname = 'messagereactionkind'
            ) THEN
                CREATE TYPE messagereactionkind AS ENUM
                    ('thumbs_up', 'thumbs_down', 'save');
            END IF;
        END$$;
        """
    )

    op.create_table(
        "chat_message_reactions",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "message_id",
            sa.UUID(),
            sa.ForeignKey("session_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_session_id", sa.String(length=128), nullable=False),
        sa.Column("kind", reaction_kind_enum, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "message_id",
            "user_session_id",
            "kind",
            name="uq_message_reaction_user_kind",
        ),
    )
    op.create_index(
        "ix_chat_message_reactions_message_id",
        "chat_message_reactions",
        ["message_id"],
    )
    op.create_index(
        "ix_chat_message_reactions_user_session_id",
        "chat_message_reactions",
        ["user_session_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_chat_message_reactions_user_session_id",
        table_name="chat_message_reactions",
    )
    op.drop_index(
        "ix_chat_message_reactions_message_id",
        table_name="chat_message_reactions",
    )
    op.drop_table("chat_message_reactions")
    op.execute("DROP TYPE IF EXISTS messagereactionkind")
