"""add daily_readings (훈독 오늘 말씀 편성, ENT-HD-002)

Revision ID: h0d01a2b3c4d
Revises: a1c9e7d0b2f3
Create Date: 2026-09-16 00:00:00.000000

PLAN-HD-001 §3 additive-only: 신규 테이블만 추가한다. 기존 테이블·컬럼은 건드리지
않으며 Postgres ENUM 타입을 만들지 않는다(상태값은 varchar + 앱 검증). 따라서 이
스키마 위에서 직전 backend 이미지도 그대로 기동한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "h0d01a2b3c4d"
down_revision: Union[str, None] = "a1c9e7d0b2f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_readings",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("reading_date", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("speaker", sa.String(length=64), nullable=False),
        sa.Column("spoken_on", sa.String(length=32), nullable=True),
        sa.Column("work_title", sa.String(length=200), nullable=False),
        sa.Column("edition", sa.String(length=120), nullable=True),
        sa.Column("authority_grade", sa.String(length=8), nullable=False),
        sa.Column(
            "review_status",
            sa.String(length=16),
            nullable=False,
            server_default="unverified",
        ),
        sa.Column("source_note", sa.String(length=500), nullable=True),
        sa.Column("chunk_id", sa.String(length=128), nullable=True),
        sa.Column("estimated_minutes", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        op.f("ix_daily_readings_reading_date"),
        "daily_readings",
        ["reading_date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_daily_readings_reading_date"), table_name="daily_readings")
    op.drop_table("daily_readings")
