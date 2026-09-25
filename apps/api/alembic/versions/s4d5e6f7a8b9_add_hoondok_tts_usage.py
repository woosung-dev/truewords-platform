"""add hoondok_tts_usage — AI 낭독 새 합성 글자 수 (PLAN-HD-011, ENT-HD-018)

Revision ID: s4d5e6f7a8b9
Revises: r3c4d5e6f7a8
"""

import sqlalchemy as sa
from alembic import op

revision = "s4d5e6f7a8b9"
down_revision = "r3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 월 상한 검사는 month 별 SUM(chars), 사용자 한도는 user_id 별 최근 24시간 SUM(chars) 다.
    # user_id 는 한도 계산용이라 FK 를 두지 않는다(계정 삭제와 무관하게 비용 기록은 남는다).
    op.create_table(
        "hoondok_tts_usage",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("month", sa.String(7), nullable=False),
        sa.Column("voice", sa.String(16), nullable=False),
        sa.Column("chars", sa.Integer(), nullable=False),
        sa.Column("cache_key", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_hoondok_tts_usage_month", "hoondok_tts_usage", ["month"])
    op.create_index("ix_hoondok_tts_usage_user_created", "hoondok_tts_usage", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_hoondok_tts_usage_user_created", table_name="hoondok_tts_usage")
    op.drop_index("ix_hoondok_tts_usage_month", table_name="hoondok_tts_usage")
    op.drop_table("hoondok_tts_usage")
