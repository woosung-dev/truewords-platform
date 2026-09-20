"""add jeongseong_periods (훈독 정성 기간, ENT-HD-004)

Revision ID: k5a6b7c8d9e0
Revises: j3f4a5b6c7d8
Create Date: 2026-09-19 00:00:00.000000

PLAN-HD-001 §3 additive-only: 신규 테이블·인덱스만 추가한다. FK 는 users 뿐이며 기존 테이블·ENUM 을
건드리지 않는다. 상태값은 varchar + 앱 검증, 사용자당 active 1건은 부분 unique 인덱스로 지킨다.
직전 backend 이미지도 이 스키마 위에서 기동한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "k5a6b7c8d9e0"
down_revision: Union[str, None] = "j3f4a5b6c7d8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jeongseong_periods",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("topic", sa.String(length=40), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("reminder_time", sa.Time(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(op.f("ix_jeongseong_periods_user_id"), "jeongseong_periods", ["user_id"], unique=False)
    # 사용자당 진행 중(active) 1건 — 부분 unique. completed·abandoned 는 여러 건 남는다.
    op.create_index(
        "uq_jeongseong_periods_user_active",
        "jeongseong_periods",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )


def downgrade() -> None:
    op.drop_index("uq_jeongseong_periods_user_active", table_name="jeongseong_periods")
    op.drop_index(op.f("ix_jeongseong_periods_user_id"), table_name="jeongseong_periods")
    op.drop_table("jeongseong_periods")
