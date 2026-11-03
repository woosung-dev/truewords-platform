"""원문 문단 안에서도 시작·끝을 정확하게 지정한다."""
from alembic import op
import sqlalchemy as sa

revision = 'a2f3a4b5c6d7'
down_revision = 'z1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hoondok_source_ranges', sa.Column('start_offset', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('hoondok_source_ranges', sa.Column('end_offset', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('hoondok_source_ranges', 'end_offset')
    op.drop_column('hoondok_source_ranges', 'start_offset')
