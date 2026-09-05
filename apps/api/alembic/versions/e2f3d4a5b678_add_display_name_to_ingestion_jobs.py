# 데이터 소스 파일별 사람 친화적 표시명 컬럼 추가 (ADR: feat/data-source-display-name)
"""add display_name to ingestion_jobs

Revision ID: e2f3d4a5b678
Revises: 3f5f5bf0893b
Create Date: 2026-05-09 16:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e2f3d4a5b678"
down_revision: Union[str, None] = "3f5f5bf0893b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """파일 단위 사람 친화적 표시명. 예: '말씀선집 167권'.

    NULL 허용 — 미설정 파일은 chat 응답에서 기존 volume/source fallback.
    Admin PATCH 엔드포인트로 인라인 편집한다.
    """
    op.add_column(
        "ingestion_jobs",
        sa.Column("display_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ingestion_jobs", "display_name")
