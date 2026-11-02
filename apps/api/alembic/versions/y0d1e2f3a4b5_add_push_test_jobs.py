"""테스트 푸시 영속 예약."""

import sqlalchemy as sa
from alembic import op

revision = "y0d1e2f3a4b5"
down_revision = "x9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "push_test_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subscription_id", sa.Uuid(), nullable=False),
        sa.Column("request_id", sa.Uuid(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempted_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error_code", sa.String(32)),
    )
    for column in ("user_id", "subscription_id", "scheduled_at"):
        op.create_index(f"ix_push_test_jobs_{column}", "push_test_jobs", [column])
    op.create_index(
        "uq_push_test_pending",
        "push_test_jobs",
        ["subscription_id"],
        unique=True,
        postgresql_where=sa.text("status = 'queued'"),
    )


def downgrade():
    op.drop_table("push_test_jobs")
