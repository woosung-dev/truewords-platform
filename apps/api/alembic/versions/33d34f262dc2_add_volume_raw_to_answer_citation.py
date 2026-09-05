"""add volume_raw to answer_citation

Revision ID: 33d34f262dc2
Revises: 7a344c99c625
Create Date: 2026-04-25 10:09:46.643740

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '33d34f262dc2'
down_revision: Union[str, None] = '7a344c99c625'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "answer_citations",
        sa.Column("volume_raw", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("answer_citations", "volume_raw")
