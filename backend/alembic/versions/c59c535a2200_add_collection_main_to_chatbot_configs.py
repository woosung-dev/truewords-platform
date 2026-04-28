"""add collection_main to chatbot_configs

Revision ID: c59c535a2200
Revises: 4d872f8826ad
Create Date: 2026-04-28 11:36:41.307116

옵션 B (Anthropic Contextual Retrieval) A/B 토글용 컬럼 추가.
기본값 'malssum_poc' (기존 컬렉션). 'malssum_poc_v2'로 변경하면 contextual prefix 인덱스 사용.

Note: autogenerate가 감지한 다른 drift(answer_citations.volume_raw, system_prompt, data_source_categories)는
본 변경과 무관해 별도 PR로 처리한다.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'c59c535a2200'
down_revision: Union[str, None] = '4d872f8826ad'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'chatbot_configs',
        sa.Column(
            'collection_main',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
            server_default='malssum_poc',
        ),
    )


def downgrade() -> None:
    op.drop_column('chatbot_configs', 'collection_main')
