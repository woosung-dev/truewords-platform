"""원문 기반 AI 요약 단위·공개본·미디어. 기존 데이터는 변경하지 않는다."""

from alembic import op
import sqlalchemy as sa

revision = "y0d1e2f3a4b5"
down_revision = "x9c0d1e2f3a4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_summary_units",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "content_right_id",
            sa.Uuid(),
            sa.ForeignKey("content_rights.id"),
            nullable=False,
        ),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("review_status", sa.String(20), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("published_revision_id", sa.Uuid(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_ai_summary_units_content_right_id", "ai_summary_units", ["content_right_id"]
    )
    op.create_table(
        "ai_summary_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "unit_id", sa.Uuid(), sa.ForeignKey("ai_summary_units.id"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("unit_id", "version"),
    )
    op.create_index(
        "ix_ai_summary_revisions_unit_id", "ai_summary_revisions", ["unit_id"]
    )
    op.create_table(
        "ai_summary_assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "unit_id", sa.Uuid(), sa.ForeignKey("ai_summary_units.id"), nullable=False
        ),
        sa.Column("mime_type", sa.String(40), nullable=False),
        sa.Column("filename", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_summary_assets_unit_id", "ai_summary_assets", ["unit_id"])

    op.create_foreign_key(
        "fk_summary_published_revision",
        "ai_summary_units",
        "ai_summary_revisions",
        ["published_revision_id"],
        ["id"],
    )


def downgrade():
    op.drop_constraint(
        "fk_summary_published_revision", "ai_summary_units", type_="foreignkey"
    )
    op.drop_table("ai_summary_assets")
    op.drop_table("ai_summary_revisions")
    op.drop_table("ai_summary_units")
