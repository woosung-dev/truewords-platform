"""add content rights, personalized readings and safe client errors

Revision ID: l6b7c8d9e0f1
Revises: k5a6b7c8d9e0
"""

import sqlalchemy as sa
from alembic import op

revision = "l6b7c8d9e0f1"
down_revision = "k5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "content_rights",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("work_title", sa.String(200), nullable=False),
        sa.Column("source_keys", sa.JSON(), nullable=False),
        sa.Column("book_series", sa.String(200), nullable=True),
        sa.Column("authority_grade", sa.String(8), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("scope_search", sa.Boolean(), nullable=False),
        sa.Column("scope_full_text", sa.Boolean(), nullable=False),
        sa.Column("scope_jeongseong", sa.Boolean(), nullable=False),
        sa.Column("note", sa.String(2000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_content_rights_volume", "content_rights", ["volume"], unique=True
    )
    op.create_table(
        "jeongseong_readings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "period_id",
            sa.Uuid(),
            sa.ForeignKey("jeongseong_periods.id"),
            nullable=False,
        ),
        sa.Column("reading_date", sa.Date(), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("chunk_id", sa.String(128), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("speaker", sa.String(64), nullable=False),
        sa.Column("work_title", sa.String(200), nullable=False),
        sa.Column("spoken_on", sa.String(32), nullable=True),
        sa.Column("edition", sa.String(120), nullable=True),
        sa.Column("authority_grade", sa.String(8), nullable=False),
        sa.Column("review_status", sa.String(16), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint(
            "period_id", "reading_date", name="uq_jeongseong_readings_period_date"
        ),
    )
    op.create_index(
        "ix_jeongseong_readings_period_id", "jeongseong_readings", ["period_id"]
    )
    op.create_table(
        "client_error_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("message", sa.String(200), nullable=False),
        sa.Column("path", sa.String(120), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "ix_client_error_events_user_id", "client_error_events", ["user_id"]
    )


def downgrade() -> None:
    op.drop_table("client_error_events")
    op.drop_table("jeongseong_readings")
    op.drop_table("content_rights")
