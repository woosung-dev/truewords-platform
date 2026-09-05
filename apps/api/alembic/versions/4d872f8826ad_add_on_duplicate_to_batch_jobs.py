"""add on_duplicate to batch_jobs

Revision ID: 4d872f8826ad
Revises: dcf99a84bff1
Create Date: 2026-04-27 17:08:05.348975

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '4d872f8826ad'
down_revision: Union[str, None] = 'dcf99a84bff1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add on_duplicate column to batch_jobs (ADR-30 follow-up).

    NOT NULL + server_default 'merge' — 기존 row는 자동으로 'merge'로 채워지며
    안전 기본값. ingestion_jobs.content_hash와 달리 enum-like string이라
    NULL 허용 대신 server_default를 사용한다.
    """
    op.add_column(
        "batch_jobs",
        sa.Column(
            "on_duplicate",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'merge'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("batch_jobs", "on_duplicate")
