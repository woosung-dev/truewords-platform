"""add reading_paths·reading_path_steps·path_runs·path_step_completions — 7일 정성 1a (추가만)

Revision ID: e6f7a8b9c0d1
Revises: d5c6d7e8f9a0
"""

import sqlalchemy as sa
from alembic import op

revision = "e6f7a8b9c0d1"
down_revision = "d5c6d7e8f9a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 상태값은 PG ENUM 이 아니라 varchar + 앱 검증이다.
    op.create_table(
        "reading_paths",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("when_line", sa.String(100), nullable=True),
        sa.Column("book", sa.String(32), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_reading_paths_slug", "reading_paths", ["slug"], unique=True)
    op.create_index("ix_reading_paths_owner_user_id", "reading_paths", ["owner_user_id"])

    op.create_table(
        "reading_path_steps",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("path_id", sa.Uuid(), sa.ForeignKey("reading_paths.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path_version", sa.Integer(), nullable=False),
        sa.Column("minutes_tier", sa.Integer(), nullable=False),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("start_chunk_index", sa.Integer(), nullable=False),
        sa.Column("end_chunk_index", sa.Integer(), nullable=False),
        sa.Column("half_end_chunk_index", sa.Integer(), nullable=True),
        sa.Column("start_chunk_id", sa.String(128), nullable=False),
        sa.Column("end_chunk_id", sa.String(128), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "path_id", "path_version", "minutes_tier", "day_index", name="uq_reading_path_steps_path_tier_day"
        ),
    )
    op.create_index("ix_reading_path_steps_path_id", "reading_path_steps", ["path_id"])

    op.create_table(
        "path_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("path_id", sa.Uuid(), sa.ForeignKey("reading_paths.id"), nullable=False),
        sa.Column("path_version", sa.Integer(), nullable=False),
        sa.Column("minutes_tier", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(100), nullable=False),
        sa.Column("book", sa.String(32), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("preferred_slot", sa.String(16), nullable=True),
        sa.Column("extension_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("finish_action", sa.String(16), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_path_runs_user_id", "path_runs", ["user_id"])
    op.create_index("ix_path_runs_path_id", "path_runs", ["path_id"])
    # 사용자당 진행 중 정성 1건
    op.create_index(
        "uq_path_runs_user_active",
        "path_runs",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "path_step_completions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("path_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_index", sa.Integer(), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("completed_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("run_id", "day_index", name="uq_path_step_completions_run_day"),
        sa.UniqueConstraint("run_id", "completed_on", name="uq_path_step_completions_run_date"),
    )
    op.create_index("ix_path_step_completions_run_id", "path_step_completions", ["run_id"])


def downgrade() -> None:
    op.drop_index("ix_path_step_completions_run_id", table_name="path_step_completions")
    op.drop_table("path_step_completions")
    op.drop_index("uq_path_runs_user_active", table_name="path_runs")
    op.drop_index("ix_path_runs_path_id", table_name="path_runs")
    op.drop_index("ix_path_runs_user_id", table_name="path_runs")
    op.drop_table("path_runs")
    op.drop_index("ix_reading_path_steps_path_id", table_name="reading_path_steps")
    op.drop_table("reading_path_steps")
    op.drop_index("ix_reading_paths_owner_user_id", table_name="reading_paths")
    op.drop_index("ix_reading_paths_slug", table_name="reading_paths")
    op.drop_table("reading_paths")
