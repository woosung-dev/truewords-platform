"""원문 읽기 스냅샷과 운영자 편집 구간."""
from alembic import op
import sqlalchemy as sa

revision = 'z1e2f3a4b5c6'
down_revision = 'y0d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('hoondok_source_snapshots',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('content_right_id', sa.Uuid(), sa.ForeignKey('content_rights.id'), nullable=False),
        sa.Column('collection', sa.String(200), nullable=False),
        sa.Column('fingerprint', sa.String(64), nullable=False),
        sa.Column('edition', sa.String(300), nullable=False),
        sa.Column('text', sa.String(), nullable=False),
        sa.Column('chunks', sa.JSON(), nullable=False),
        sa.Column('blocks', sa.JSON(), nullable=False),
        sa.Column('sections', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('content_right_id', 'fingerprint'))
    op.create_index('ix_hoondok_source_snapshots_content_right_id', 'hoondok_source_snapshots', ['content_right_id'])
    op.create_table('hoondok_source_ranges',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('content_right_id', sa.Uuid(), sa.ForeignKey('content_rights.id'), nullable=False),
        sa.Column('snapshot_id', sa.Uuid(), sa.ForeignKey('hoondok_source_snapshots.id'), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('group_title', sa.String(300), nullable=False),
        sa.Column('start_block_id', sa.String(36), nullable=False),
        sa.Column('end_block_id', sa.String(36), nullable=False),
        sa.Column('source', sa.JSON(), nullable=False),
        sa.Column('archived', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_hoondok_source_ranges_content_right_id', 'hoondok_source_ranges', ['content_right_id'])
    op.create_index('ix_hoondok_source_ranges_snapshot_id', 'hoondok_source_ranges', ['snapshot_id'])


def downgrade():
    op.drop_table('hoondok_source_ranges')
    op.drop_table('hoondok_source_snapshots')
