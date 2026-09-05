"""expand volume_raw to varchar 255

Revision ID: 3f5f5bf0893b
Revises: m1a02b03c04d
Create Date: 2026-04-27 15:46:58.528919

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '3f5f5bf0893b'
down_revision: Union[str, None] = 'm1a02b03c04d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'answer_citations',
        'volume_raw',
        existing_type=sa.VARCHAR(length=64),
        type_=sqlmodel.sql.sqltypes.AutoString(length=255),
        existing_nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'answer_citations',
        'volume_raw',
        existing_type=sqlmodel.sql.sqltypes.AutoString(length=255),
        type_=sa.VARCHAR(length=64),
        existing_nullable=True,
    )
