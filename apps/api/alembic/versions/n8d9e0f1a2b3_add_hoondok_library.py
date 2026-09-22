"""add hoondok library sections, reading positions and passage marks

Revision ID: n8d9e0f1a2b3
Revises: m7c8d9e0f1a2
"""

import sqlalchemy as sa
from alembic import op

revision = "n8d9e0f1a2b3"
down_revision = "m7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 상태값(level·origin·kind)은 PG ENUM 이 아니라 varchar/int + 앱 Literal 검증이다 (additive-only 규칙).
    op.add_column("content_rights", sa.Column("chunk_count", sa.Integer(), nullable=True))

    op.create_table(
        "volume_sections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("start_chunk_index", sa.Integer(), nullable=False),
        sa.Column("end_chunk_index", sa.Integer(), nullable=False),
        sa.Column("spoken_on", sa.String(32), nullable=True),
        sa.Column("place", sa.String(120), nullable=True),
        sa.Column("origin", sa.String(16), nullable=False, server_default="auto"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("volume", "position", name="uq_volume_sections_volume_position"),
    )
    op.create_index("ix_volume_sections_volume", "volume_sections", ["volume"])

    op.create_table(
        "reading_positions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "volume", name="uq_reading_positions_user_volume"),
    )
    op.create_index("ix_reading_positions_user_id", "reading_positions", ["user_id"])

    op.create_table(
        "passage_marks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("chunk_id", sa.String(128), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("color", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "chunk_id", "kind", name="uq_passage_marks_user_chunk_kind"),
    )
    op.create_index("ix_passage_marks_user_id", "passage_marks", ["user_id"])


def downgrade() -> None:
    op.drop_table("passage_marks")
    op.drop_table("reading_positions")
    op.drop_table("volume_sections")
    op.drop_column("content_rights", "chunk_count")
