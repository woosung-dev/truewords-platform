"""공개 질문 인기도(조회·질문 수)·고정 순서·중복 방지·북마크 테이블 추가 (DEC-PWA-025)

Revision ID: a2f3b4c5d6e7
Revises: f7a8b9c0d1e2
"""

import sqlalchemy as sa
from alembic import op

revision = "a2f3b4c5d6e7"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hoondok_public_questions",
        sa.Column("view_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "hoondok_public_questions",
        sa.Column("ask_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column("hoondok_public_questions", sa.Column("pin_order", sa.Integer(), nullable=True))

    # FK 에 ondelete 없음 — 공개 질문 삭제는 PublicQuestionRepository 가 자식부터 지운다.
    # viewer_key 는 sha256 hex(원본 사용자·익명 id 를 저장하지 않는다).
    op.create_table(
        "hoondok_public_question_views",
        sa.Column("question_id", sa.String(16), sa.ForeignKey("hoondok_public_questions.id"), primary_key=True),
        sa.Column("viewer_key", sa.String(64), primary_key=True),
        sa.Column("day", sa.Date(), primary_key=True),
    )
    op.create_index("ix_hoondok_public_question_views_day", "hoondok_public_question_views", ["day"])

    op.create_table(
        "hoondok_public_question_asks",
        sa.Column("question_id", sa.String(16), sa.ForeignKey("hoondok_public_questions.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_hoondok_public_question_asks_user_id", "hoondok_public_question_asks", ["user_id"])

    # 추천 질문 북마크 — 인기도와 무관. 공개 질문 삭제·계정 삭제는 Repository 가 자식부터 지운다.
    op.create_table(
        "hoondok_public_question_bookmarks",
        sa.Column("question_id", sa.String(16), sa.ForeignKey("hoondok_public_questions.id"), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_hoondok_public_question_bookmarks_user_id", "hoondok_public_question_bookmarks", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_hoondok_public_question_bookmarks_user_id", table_name="hoondok_public_question_bookmarks")
    op.drop_table("hoondok_public_question_bookmarks")
    op.drop_index("ix_hoondok_public_question_asks_user_id", table_name="hoondok_public_question_asks")
    op.drop_table("hoondok_public_question_asks")
    op.drop_index("ix_hoondok_public_question_views_day", table_name="hoondok_public_question_views")
    op.drop_table("hoondok_public_question_views")
    op.drop_column("hoondok_public_questions", "pin_order")
    op.drop_column("hoondok_public_questions", "ask_count")
    op.drop_column("hoondok_public_questions", "view_count")
