"""add jeongseong_periods.resolution — 정성 기간 '나의 각오' (2026-09-29)

선택 입력 50자. 본인 응답(API-HD-009)에만 담고 모임·가족·관리자 응답에는 넣지 않는다.
nullable 컬럼 추가만이라 직전 backend 이미지도 이 스키마 위에서 기동한다.

Revision ID: v7a8b9c0d1e2
Revises: u6f7a8b9c0d1
"""

import sqlalchemy as sa
from alembic import op

revision = "v7a8b9c0d1e2"
down_revision = "u6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jeongseong_periods", sa.Column("resolution", sa.String(length=50), nullable=True))


def downgrade() -> None:
    # 되돌리면 저장된 각오는 버린다.
    op.drop_column("jeongseong_periods", "resolution")
