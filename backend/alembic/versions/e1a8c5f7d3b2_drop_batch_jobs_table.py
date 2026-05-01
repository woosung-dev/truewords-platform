"""drop batch_jobs table — Batch API 기능 제거

Revision ID: e1a8c5f7d3b2
Revises: aa6f4b908ef4
Create Date: 2026-05-01 02:00:00.000000

Gemini Batch API 기능 제거 (PR #95). polling 인프라 미완성으로 인해 batch
모드 결과가 영구 미반영되는 결함 발견. 즉시 처리 (standard) 모드만 운영
지원하므로 BatchJob 모델/테이블 모두 정리.

backend/src/pipeline/batch_models.py 등 batch 관련 모듈 삭제 후 본 마이그레이션
실행. drop 대상:
- batch_jobs 테이블
- batchstatus enum (PostgreSQL)

downgrade는 8060cfb6e88c (add_batch_jobs_table) 와 4d872f8826ad
(add_on_duplicate_to_batch_jobs) 의 union 으로 복구.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = 'e1a8c5f7d3b2'
down_revision: Union[str, None] = 'aa6f4b908ef4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f('ix_batch_jobs_status'), table_name='batch_jobs')
    op.drop_index(op.f('ix_batch_jobs_created_at'), table_name='batch_jobs')
    op.drop_index(op.f('ix_batch_jobs_batch_id'), table_name='batch_jobs')
    op.drop_table('batch_jobs')
    # PostgreSQL enum cleanup (다른 테이블에서 미사용)
    op.execute("DROP TYPE IF EXISTS batchstatus")


def downgrade() -> None:
    op.create_table(
        'batch_jobs',
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
        sa.Column('on_duplicate', sa.String(length=16), server_default='merge', nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_batch_jobs_batch_id'), 'batch_jobs', ['batch_id'], unique=False)
    op.create_index(op.f('ix_batch_jobs_created_at'), 'batch_jobs', ['created_at'], unique=False)
    op.create_index(op.f('ix_batch_jobs_status'), 'batch_jobs', ['status'], unique=False)
