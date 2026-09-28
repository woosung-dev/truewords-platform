"""drop notification_preferences.lock_screen_level — 잠금 화면 문구 선택 제거 (2026-09-28)

알림 문구를 중립 문구 하나로 줄였다. 훈독은 시연 단계라 저장된 선택값은 버린다.

Revision ID: u6f7a8b9c0d1
Revises: t5e6f7a8b9c0
"""

import sqlalchemy as sa
from alembic import op

revision = "u6f7a8b9c0d1"
down_revision = "t5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("notification_preferences", "lock_screen_level")


def downgrade() -> None:
    # 되돌리면 모든 행이 기본값 neutral 로 돌아온다(원래 선택값은 복원하지 않는다).
    op.add_column(
        "notification_preferences",
        sa.Column("lock_screen_level", sa.String(16), nullable=False, server_default="neutral"),
    )
