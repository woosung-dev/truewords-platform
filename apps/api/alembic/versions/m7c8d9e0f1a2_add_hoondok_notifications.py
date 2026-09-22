"""add hoondok notification preferences and push subscriptions

Revision ID: m7c8d9e0f1a2
Revises: l6b7c8d9e0f1
"""

import sqlalchemy as sa
from alembic import op

revision = "m7c8d9e0f1a2"
down_revision = "l6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 상태값(lock_screen_level)은 PG ENUM 이 아니라 varchar + 앱 Literal 검증이다 (additive-only 규칙).
    op.create_table(
        "notification_preferences",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("read_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("read_time", sa.Time(), nullable=False, server_default="06:00"),
        sa.Column("lock_screen_level", sa.String(16), nullable=False, server_default="neutral"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("endpoint", sa.String(2048), nullable=False),
        sa.Column("p256dh", sa.String(255), nullable=False),
        sa.Column("auth", sa.String(255), nullable=False),
        sa.Column("user_agent", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_sent_on", sa.Date(), nullable=True),
        sa.Column("failed_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])
    op.create_index("ix_push_subscriptions_endpoint", "push_subscriptions", ["endpoint"], unique=True)


def downgrade() -> None:
    op.drop_table("push_subscriptions")
    op.drop_table("notification_preferences")
