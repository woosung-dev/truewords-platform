"""add rewritten_query to search_events

Revision ID: 856b04b1fb71
Revises: 1ee1295dc7f4
Create Date: 2026-04-11 12:10:22.865096

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '856b04b1fb71'
down_revision: Union[str, None] = '1ee1295dc7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('search_events', sa.Column('rewritten_query', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('search_events', 'rewritten_query')
