"""add content_hash to ingestion_jobs

Revision ID: dcf99a84bff1
Revises: a7b2c8d4e1f0
Create Date: 2026-04-27 17:05:03.625264

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'dcf99a84bff1'
down_revision: Union[str, None] = 'a7b2c8d4e1f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add content_hash for ADR-30 skip-mode content comparison.

    NULL 허용 + server_default 없음 — 기존 row는 NULL로 남으며 ingestor가
    재적재 시점에 자동으로 채워 넣는다(`update_content_hash`).
    """
    op.add_column(
        "ingestion_jobs",
        sa.Column("content_hash", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ingestion_jobs", "content_hash")
