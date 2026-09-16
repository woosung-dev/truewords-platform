"""add mission_logs (훈독 미션 완료 기록, ENT-HD-003)

Revision ID: j3f4a5b6c7d8
Revises: i1e2f3a4b5c6
Create Date: 2026-09-16 00:00:00.000000

PLAN-HD-001 §3 additive-only: 신규 테이블만 추가한다. FK 는 같은 Phase 에서 만든 users 뿐이며
기존 테이블·ENUM 을 건드리지 않는다. 직전 backend 이미지도 이 스키마 위에서 기동한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "j3f4a5b6c7d8"
down_revision: Union[str, None] = "i1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mission_logs",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("mission_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "mission_date", "kind", name="uq_mission_logs_user_date_kind"),
    )
    op.create_index(op.f("ix_mission_logs_user_id"), "mission_logs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_mission_logs_user_id"), table_name="mission_logs")
    op.drop_table("mission_logs")
