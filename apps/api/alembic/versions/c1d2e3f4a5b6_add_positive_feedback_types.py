"""add positive feedback types to feedbacktype enum

Revision ID: c1d2e3f4a5b6
Revises: d7e8f9a0b1c2
Create Date: 2026-07-07 00:00:00.000000

긍정 피드백 구조화 — feedbacktype native enum 에 긍정 세분 사유 4종 추가.
기존 HELPFUL(그냥 좋아요/기타) + accurate / well_cited / easy_to_understand / comforting.

SQLAlchemy 는 enum 을 name(대문자) 기준으로 저장하므로 라벨도 대문자로 추가한다.
PG12+ 는 ADD VALUE 를 트랜잭션 내 허용(같은 트랜잭션에서 값 *사용*만 불가 — 여기선 미사용).
enum 값 제거는 비파괴적으로 불가하므로 downgrade 는 no-op.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_VALUES = ("ACCURATE", "WELL_CITED", "EASY_TO_UNDERSTAND", "COMFORTING")


def upgrade() -> None:
    for value in _NEW_VALUES:
        op.execute(f"ALTER TYPE feedbacktype ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # pg enum 값 제거는 타입/컬럼 재생성이 필요 — 비파괴적 롤백 불가하여 no-op.
    pass
