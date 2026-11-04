"""drop hoondok reading groups — 훈독 모임 기능 제거 (DEC-PWA-027, 2026-11-04)

모임(r3c4d5e6f7a8)이 만든 테이블 5개를 지운다. 공식 정성(shared_jeongseongs)은 모임 상세에만 보였으므로 함께 지운다.
익명 "함께 읽는 사람들" 숫자(API-HD-029)는 mission_logs 만 세므로 영향이 없다.

downgrade 는 스키마만 되살린다 — 지운 데이터는 복구하지 않는다. 컬럼은 x9c0d1e2f3a4 이후 상태(timestamptz)로 만든다.

Revision ID: zb2c3d4e5f6a
Revises: z1e2f3a4b5c6
"""

import sqlalchemy as sa
from alembic import op

revision = "zb2c3d4e5f6a"
down_revision = "z1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # FK 에 ondelete 가 없으므로 자식부터 지운다. 인덱스·제약은 테이블과 함께 사라진다.
    op.drop_table("share_reactions")
    op.drop_table("group_shares")
    op.drop_table("shared_jeongseongs")
    op.drop_table("group_members")
    op.drop_table("reading_groups")


def downgrade() -> None:
    # 스키마만 다시 만든다(빈 테이블). r3c4d5e6f7a8 과 같은 구조 + x9c0d1e2f3a4 의 timestamptz.
    op.create_table(
        "reading_groups",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("meeting_time", sa.Time(), nullable=True),
        sa.Column("invite_code", sa.String(16), nullable=False),
        sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_reading_groups_invite_code", "reading_groups", ["invite_code"], unique=True)

    op.create_table(
        "group_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group_id", sa.Uuid(), sa.ForeignKey("reading_groups.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("display_name", sa.String(12), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
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
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_shared_jeongseongs_group_id", "shared_jeongseongs", ["group_id"])

    op.create_table(
        "group_shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("group_id", sa.Uuid(), sa.ForeignKey("reading_groups.id"), nullable=False),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("group_members.id"), nullable=False),
        sa.Column("share_date", sa.Date(), nullable=False),
        sa.Column("body", sa.String(100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("group_id", "member_id", "share_date", name="uq_group_shares_group_member_date"),
    )
    op.create_index("ix_group_shares_group_date", "group_shares", ["group_id", "share_date"])
    op.create_index("ix_group_shares_member_id", "group_shares", ["member_id"])

    op.create_table(
        "share_reactions",
        sa.Column("share_id", sa.Uuid(), sa.ForeignKey("group_shares.id"), primary_key=True),
        sa.Column("member_id", sa.Uuid(), sa.ForeignKey("group_members.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_share_reactions_member_id", "share_reactions", ["member_id"])
