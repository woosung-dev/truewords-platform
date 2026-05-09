# 챗봇별 SSE 스트리밍 모드 토글 컬럼 (default true) 추가
"""add streaming_enabled to chatbot_configs

Revision ID: f3a4b5c6d7e8
Revises: e2f3d4a5b678
Create Date: 2026-05-09 20:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f3a4b5c6d7e8"
down_revision: Union[str, None] = "e2f3d4a5b678"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """봇별 SSE 스트리밍 응답 활성화 여부.

    default true — 기존 봇 모두 SSE 유지 (회귀 0). 짧은 답변 봇이나 cache hit
    위주 봇은 admin 에서 false 로 설정해 단일 응답으로 전환 가능.
    """
    op.add_column(
        "chatbot_configs",
        sa.Column(
            "streaming_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("chatbot_configs", "streaming_enabled")
