"""add passage_highlights — 구절 형광펜·메모 (API-HD-053, ENT-HD-021)

형광펜을 단락(청크) 단위에서 사용자가 고른 글자 범위 단위로 옮긴다. `passage_marks` 의 예전
`kind="highlight"` 행은 옮기거나 지우지 않는다(데이터 삭제는 별도 절차) — API 가 읽지 않을 뿐이다.

Revision ID: v7a8b9c0d1e2
Revises: u6f7a8b9c0d1
"""

import sqlalchemy as sa
from alembic import op

revision = "v7a8b9c0d1e2"
down_revision = "u6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 한 단락에 여러 형광펜이 올 수 있어 unique 를 두지 않는다. color 는 1~3 앱 검증(DB CHECK 없음).
    # FK 에 ondelete 없음 — 계정 삭제는 LibraryRepository.delete_for_user.
    op.create_table(
        "passage_highlights",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("volume", sa.String(512), nullable=False),
        sa.Column("chunk_id", sa.String(128), nullable=False),
        sa.Column("start_chunk_index", sa.Integer(), nullable=False),
        sa.Column("start_offset", sa.Integer(), nullable=False),
        sa.Column("end_chunk_index", sa.Integer(), nullable=False),
        sa.Column("end_offset", sa.Integer(), nullable=False),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("color", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_passage_highlights_user_id", "passage_highlights", ["user_id"])
    op.create_index(
        "ix_passage_highlights_user_volume", "passage_highlights", ["user_id", "volume"]
    )


def downgrade() -> None:
    op.drop_index("ix_passage_highlights_user_volume", table_name="passage_highlights")
    op.drop_index("ix_passage_highlights_user_id", table_name="passage_highlights")
    op.drop_table("passage_highlights")
