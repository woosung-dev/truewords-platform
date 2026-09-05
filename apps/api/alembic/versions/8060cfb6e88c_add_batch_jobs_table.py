"""add batch_jobs table

Revision ID: 8060cfb6e88c
Revises: 856b04b1fb71
Create Date: 2026-04-11 19:59:45.189971

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '8060cfb6e88c'
down_revision: Union[str, None] = '856b04b1fb71'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('batch_jobs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('batch_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('filename', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('volume_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
    sa.Column('total_chunks', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', name='batchstatus'), nullable=False),
    sa.Column('error_message', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.Column('completed_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_batch_jobs_batch_id'), 'batch_jobs', ['batch_id'], unique=False)
    op.create_index(op.f('ix_batch_jobs_created_at'), 'batch_jobs', ['created_at'], unique=False)
    op.create_index(op.f('ix_batch_jobs_status'), 'batch_jobs', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_batch_jobs_status'), table_name='batch_jobs')
    op.drop_index(op.f('ix_batch_jobs_created_at'), table_name='batch_jobs')
    op.drop_index(op.f('ix_batch_jobs_batch_id'), table_name='batch_jobs')
    op.drop_table('batch_jobs')
