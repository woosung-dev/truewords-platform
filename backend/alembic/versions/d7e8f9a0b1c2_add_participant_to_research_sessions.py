"""add participant fields to research_sessions (레드팀 시연)

Revision ID: d7e8f9a0b1c2
Revises: b5c6d7e8f9a0
Create Date: 2026-06-04 00:00:00.000000

레드팀 시연 — 루트 페이지 게이트에서 받는 참여자 식별 정보를 세션에 귀속.
research_sessions 에 2 컬럼 추가:
- participant_name: 참여자 이름 (게이트 입력)
- participant_category: 참여자 카테고리/소속 (게이트 입력)

기존 row 는 NULL (익명 세션). 분석/필터에서 group by 가 빈번할 것이므로 둘 다 인덱스.
시연용 임시 세팅 — 존속 미지수. 프로덕트 미반영 시 downgrade 로 제거.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d7e8f9a0b1c2"
down_revision: Union[str, None] = "b5c6d7e8f9a0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "research_sessions",
        sa.Column("participant_name", sa.String(length=128), nullable=True),
    )
    op.add_column(
        "research_sessions",
        sa.Column("participant_category", sa.String(length=128), nullable=True),
    )
    op.create_index(
        "ix_research_sessions_participant_name",
        "research_sessions",
        ["participant_name"],
    )
    op.create_index(
        "ix_research_sessions_participant_category",
        "research_sessions",
        ["participant_category"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_research_sessions_participant_category",
        table_name="research_sessions",
    )
    op.drop_index(
        "ix_research_sessions_participant_name",
        table_name="research_sessions",
    )
    op.drop_column("research_sessions", "participant_category")
    op.drop_column("research_sessions", "participant_name")
