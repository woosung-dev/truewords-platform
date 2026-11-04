"""원문 문단 안에서도 시작·끝을 정확하게 지정한다."""
from alembic import op
import sqlalchemy as sa

revision = "d5c6d7e8f9a0"
down_revision = "c4b5c6d7e8f9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('hoondok_source_ranges', sa.Column('start_offset', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('hoondok_source_ranges', sa.Column('end_offset', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('hoondok_source_ranges', 'end_offset')
    op.drop_column('hoondok_source_ranges', 'start_offset')
