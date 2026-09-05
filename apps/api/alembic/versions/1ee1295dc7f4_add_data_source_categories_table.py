"""add data_source_categories table

Revision ID: 1ee1295dc7f4
Revises: 84b935925eaa
Create Date: 2026-04-05 23:29:32.619751

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '1ee1295dc7f4'
down_revision: Union[str, None] = '84b935925eaa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # §13.2 S2: 파괴적 DROP TABLE IF EXISTS 제거. round-trip(up→down→up) 시 데이터 소실 방지.
    # - 테이블 존재 여부를 inspector 로 확인 후 부재 시에만 CREATE.
    # - 시드 INSERT 는 ON CONFLICT (key) DO NOTHING 으로 idempotent 처리.
    #   기존 row 의 사용자 수정값(description 등)을 덮지 않음.
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if "data_source_categories" not in inspector.get_table_names():
        op.execute("""
            CREATE TABLE data_source_categories (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                key VARCHAR(20) NOT NULL UNIQUE,
                name VARCHAR NOT NULL,
                description VARCHAR NOT NULL DEFAULT '',
                color VARCHAR NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT true,
                is_searchable BOOLEAN NOT NULL DEFAULT true,
                created_at TIMESTAMP NOT NULL DEFAULT now(),
                updated_at TIMESTAMP NOT NULL DEFAULT now()
            )
        """)
        op.execute(
            "CREATE INDEX ix_data_source_categories_key "
            "ON data_source_categories (key)"
        )

    # 시드 데이터 — idempotent (ON CONFLICT DO NOTHING)
    op.execute("""
        INSERT INTO data_source_categories (key, name, description, color, sort_order, is_searchable)
        VALUES
            ('A', '말씀선집', '615권 텍스트 데이터', 'indigo', 1, true),
            ('B', '어머니말씀', '주요 어록 및 연설', 'violet', 2, true),
            ('C', '원리강론', '기본 교리서', 'blue', 3, true),
            ('D', '용어사전', '동적 프롬프트 인젝션용', 'slate', 4, false)
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("data_source_categories")
