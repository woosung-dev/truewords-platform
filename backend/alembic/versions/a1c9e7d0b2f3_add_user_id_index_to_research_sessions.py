"""add user_id index to research_sessions (대화 기록 계정별 조회)

Revision ID: a1c9e7d0b2f3
Revises: f4b7c1a2d9e0
Create Date: 2026-07-10 00:00:00.000000

research_sessions.user_id 컬럼은 초기 스키마(4019bf278be0)부터 존재하나 인덱스가
없었다. 대화 기록 페이지가 `WHERE user_id = :uid` 로 세션을 필터·정렬하므로 조회
성능을 위해 인덱스를 추가한다. 컬럼 자체는 이미 있으므로 인덱스만 생성.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "a1c9e7d0b2f3"
down_revision: Union[str, None] = "f4b7c1a2d9e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        op.f("ix_research_sessions_user_id"),
        "research_sessions",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_research_sessions_user_id"),
        table_name="research_sessions",
    )
