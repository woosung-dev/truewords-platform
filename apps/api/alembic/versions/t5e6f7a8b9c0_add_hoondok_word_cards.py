"""add word_cards · card_receipts — 오늘의 책갈피 (PLAN-HD-012, ENT-HD-019·020)

Revision ID: t5e6f7a8b9c0
Revises: s4d5e6f7a8b9
"""

import sqlalchemy as sa
from alembic import op

revision = "t5e6f7a8b9c0"
down_revision = "s4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # status 는 PG ENUM 이 아니라 varchar + 앱 Literal 검증이다 (additive-only 규칙).
    # pinned_on unique — 하루에 고정 카드는 1장. NULL 은 여러 행이 가질 수 있다.
    op.create_table(
        "word_cards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("chunk_id", sa.String(128), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("work_title", sa.String(200), nullable=False),
        sa.Column("source_label", sa.String(300), nullable=False),
        sa.Column("topic", sa.String(200), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("pinned_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("pinned_on", name="uq_word_cards_pinned_on"),
    )
    op.create_index("ix_word_cards_volume", "word_cards", ["volume"])

    # 받은 사람 정보·열람 수는 두지 않는다. FK 에 ondelete 없음 — 계정 삭제는 CardRepository.delete_for_user.
    op.create_table(
        "card_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("card_id", sa.Uuid(), sa.ForeignKey("word_cards.id"), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("shared_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "card_id", name="uq_card_receipts_user_card"),
    )
    op.create_index("ix_card_receipts_user_id", "card_receipts", ["user_id"])
    op.create_index("ix_card_receipts_card_id", "card_receipts", ["card_id"])


def downgrade() -> None:
    op.drop_index("ix_card_receipts_card_id", table_name="card_receipts")
    op.drop_index("ix_card_receipts_user_id", table_name="card_receipts")
    op.drop_table("card_receipts")
    op.drop_index("ix_word_cards_volume", table_name="word_cards")
    op.drop_table("word_cards")
