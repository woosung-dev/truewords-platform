"""add mission_logs (mission_date, kind) index — 함께 읽는 사람들 하루 집계 (PLAN-HD-009, API-HD-029)

Revision ID: q2b3c4d5e6f7
Revises: n8d9e0f1a2b3
"""

from alembic import op

revision = "q2b3c4d5e6f7"
down_revision = "n8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 기존 unique(user_id, mission_date, kind) 는 user_id 가 선두라 "오늘 read 완료자 수" 조회에 쓰이지 않는다.
    op.create_index("ix_mission_logs_date_kind", "mission_logs", ["mission_date", "kind"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_mission_logs_date_kind", table_name="mission_logs")
