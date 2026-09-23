"""add hoondok reading groups — 함께 읽는 모임 2단계 (PLAN-HD-010, ENT-HD-013~017)

Revision ID: r3c4d5e6f7a8
Revises: q2b3c4d5e6f7
"""

import sqlalchemy as sa
from alembic import op

revision = "r3c4d5e6f7a8"
down_revision = "q2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # kind·role 은 PG ENUM 이 아니라 varchar + 앱 Literal 검증이다 (additive-only 규칙).
    # FK 에 ondelete 를 두지 않는다 — 삭제는 GroupRepository 가 순서대로 명시한다.
    op.create_table(
        "reading_groups",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("meeting_time", sa.Time(), nullable=True),
        sa.Column("invite_code", sa.String(16), nullable=False),
        sa.Column("invite_expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_reading_groups_invite_code", "reading_groups", ["invite_code"], unique=True)

    op.create_table(
        "group_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group_id", sa.Uuid(), sa.ForeignKey("reading_groups.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("display_name", sa.String(12), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
        sa.UniqueConstraint("group_id", "display_name", name="uq_group_members_group_display_name"),
    )
    op.create_index("ix_group_members_user_id", "group_members", ["user_id"])
    op.create_index(
        "uq_group_members_group_leader",
        "group_members",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("role = 'leader'"),
    )

    op.create_table(
        "shared_jeongseongs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group_id", sa.Uuid(), sa.ForeignKey("reading_groups.id"), nullable=True),
        sa.Column("title", sa.String(40), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("source_note", sa.String(200), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_shared_jeongseongs_group_id", "shared_jeongseongs", ["group_id"])

    op.create_table(
        "group_shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group_id", sa.Uuid(), sa.ForeignKey("reading_groups.id"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("group_members.id"), nullable=False),
        sa.Column("share_date", sa.Date(), nullable=False),
        sa.Column("body", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("group_id", "member_id", "share_date", name="uq_group_shares_group_member_date"),
    )
    op.create_index("ix_group_shares_group_date", "group_shares", ["group_id", "share_date"])
    op.create_index("ix_group_shares_member_id", "group_shares", ["member_id"])

    op.create_table(
        "share_reactions",
        sa.Column("share_id", sa.Uuid(), sa.ForeignKey("group_shares.id"), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("group_members.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_share_reactions_member_id", "share_reactions", ["member_id"])


def downgrade() -> None:
    op.drop_table("share_reactions")
    op.drop_table("group_shares")
    op.drop_table("shared_jeongseongs")
    op.drop_table("group_members")
    op.drop_table("reading_groups")
