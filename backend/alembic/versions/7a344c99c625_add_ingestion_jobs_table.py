"""add ingestion_jobs table

Revision ID: 7a344c99c625
Revises: 8060cfb6e88c
Create Date: 2026-04-14 11:17:02.902765

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = '7a344c99c625'
down_revision: Union[str, None] = '8060cfb6e88c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ingestion_jobs',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('filename', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('volume_key', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('source', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('total_chunks', sa.Integer(), nullable=False),
        sa.Column('processed_chunks', sa.Integer(), nullable=False),
        sa.Column(
            'status',
            sa.Enum('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL', name='ingestionstatus'),
            nullable=False,
        ),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('completed_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ingestion_jobs_created_at'), 'ingestion_jobs', ['created_at'], unique=False)
    op.create_index(op.f('ix_ingestion_jobs_status'), 'ingestion_jobs', ['status'], unique=False)
    op.create_index(op.f('ix_ingestion_jobs_volume_key'), 'ingestion_jobs', ['volume_key'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_ingestion_jobs_volume_key'), table_name='ingestion_jobs')
    op.drop_index(op.f('ix_ingestion_jobs_status'), table_name='ingestion_jobs')
    op.drop_index(op.f('ix_ingestion_jobs_created_at'), table_name='ingestion_jobs')
    op.drop_table('ingestion_jobs')
    sa.Enum(name='ingestionstatus').drop(op.get_bind(), checkfirst=True)
