"""add pipeline_version to session_messages

Revision ID: a7b2c8d4e1f0
Revises: 33d34f262dc2
Create Date: 2026-04-26 12:00:00.000000

R1 Phase 3 N7: pipeline_version 컬럼 추가.
- 신규 메시지(v2 파이프라인)는 코드에서 pipeline_version=2 명시 주입.
- 기존 메시지(v1 legacy)는 server_default='1' 로 자동 backfill.
- Repository.get_messages_by_session(pipeline_version=...) 옵션으로 v1/v2 분리 조회 가능.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b2c8d4e1f0'
down_revision: Union[str, None] = '33d34f262dc2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "session_messages",
        sa.Column(
            "pipeline_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade() -> None:
    op.drop_column("session_messages", "pipeline_version")
