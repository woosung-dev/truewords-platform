"""add users (훈독 일반 사용자, ENT-HD-001)

Revision ID: i1e2f3a4b5c6
Revises: h0d01a2b3c4d
Create Date: 2026-09-16 00:00:00.000000

PLAN-HD-001 §3 additive-only: 신규 테이블만 추가한다. admin_users 와 FK 를 맺지 않으며
Postgres ENUM 을 만들지 않는다. 이 스키마 위에서 직전 backend 이미지도 그대로 기동한다.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "i1e2f3a4b5c6"
down_revision: Union[str, None] = "h0d01a2b3c4d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("timezone", sa.String(length=64), nullable=False, server_default="Asia/Seoul"),
        sa.Column("consented_at", sa.DateTime(), nullable=True),
        sa.Column("consent_version", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
