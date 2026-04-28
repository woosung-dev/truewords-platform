"""add measurement columns to session_messages (M1)

Revision ID: m1a02b03c04d
Revises: p1h02a3b4c5d6
Create Date: 2026-04-29 00:30:00.000000

ADR-46 측정 인프라 — Cross-review #2 Opus W4-blocking 권고.
session_messages 에 4 컬럼 추가:
- requested_answer_mode: 사용자가 명시한 페르소나 (P0-E)
- resolved_answer_mode: 파이프라인이 최종 결정한 모드
- persona_overridden: B5 강제 override 발동 여부
- crisis_trigger: 위기 매칭 origin (DIRECT 키워드 텍스트 또는 "intent:crisis" 등)

목적: A/B 효과 분석 (페르소나 토글 영향, 위기 라우팅 정확도, false-positive 율)
의 baseline. 미적용 시 W4 후속 분석에서 false-null 위험.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "m1a02b03c04d"
down_revision: Union[str, None] = "p1h02a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """4 측정 컬럼 추가. 기존 row 는 NULL — backfill 불필요 (legacy)."""
    op.add_column(
        "session_messages",
        sa.Column("requested_answer_mode", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "session_messages",
        sa.Column("resolved_answer_mode", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "session_messages",
        sa.Column("persona_overridden", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "session_messages",
        sa.Column("crisis_trigger", sa.String(length=128), nullable=True),
    )
    # 분석 쿼리 효율 — resolved_answer_mode group by 가 빈번할 것이므로 인덱스.
    op.create_index(
        "ix_session_messages_resolved_answer_mode",
        "session_messages",
        ["resolved_answer_mode"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_session_messages_resolved_answer_mode",
        table_name="session_messages",
    )
    op.drop_column("session_messages", "crisis_trigger")
    op.drop_column("session_messages", "persona_overridden")
    op.drop_column("session_messages", "resolved_answer_mode")
    op.drop_column("session_messages", "requested_answer_mode")
