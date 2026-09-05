"""backfill display_name from filename

Revision ID: b5c6d7e8f9a0
Revises: a4b8e9c1d23f
Create Date: 2026-05-12 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b5c6d7e8f9a0"
down_revision: Union[str, None] = "a4b8e9c1d23f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """display_name IS NULL 인 행을 filename 확장자 제거 후 채운다.

    regexp_replace 패턴 '\\.[^.]+$' — 마지막 점 이후를 제거 (os.path.splitext 동일 동작).
    filename 에 점이 없으면 변경 없이 그대로 유지.

    ADR: docs/dev-log/2026-05-12-display-name-backfill.md
    """
    op.execute(
        sa.text(
            "UPDATE ingestion_jobs "
            "SET display_name = regexp_replace(filename, E'\\\\.[^\\\\.]+$', '') "
            "WHERE display_name IS NULL AND filename IS NOT NULL"
        )
    )


def downgrade() -> None:
    pass
