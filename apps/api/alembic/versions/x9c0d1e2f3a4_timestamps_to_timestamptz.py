"""timestamp 컬럼 53개를 timestamptz 로 — aware UTC 전환 (2026-10-02)

sqlmodel 0.0.45+ 는 `datetime` 필드를 UTCDateTime(timestamptz)로 매핑하고 naive 값 바인딩을 거부한다.
기존 값은 모두 naive UTC 라 `AT TIME ZONE 'UTC'` 로 같은 순간(epoch)을 보존한다.

- 컬럼 목록은 모델 import 없이 하드코딩한다(이후 모델이 바뀌어도 이 리비전은 고정).
- USING 식이 있어 테이블을 다시 쓴다(ACCESS EXCLUSIVE). 베타 규모라 짧지만 배포 시 잠깐 쓰기가 막힌다.
- 이 스키마 위에서 직전 backend 이미지(naive 규약)는 aware/naive 비교에서 실패할 수 있다.
  롤백은 `alembic downgrade` 로 timestamp 로 되돌린 뒤 이전 이미지를 띄운다.

Revision ID: x9c0d1e2f3a4
Revises: w8b9c0d1e2f3
"""

import sqlalchemy as sa
from alembic import op

revision = "x9c0d1e2f3a4"
down_revision = "w8b9c0d1e2f3"
branch_labels = None
depends_on = None

# (테이블, 컬럼들) — w8b9c0d1e2f3 시점의 `timestamp without time zone` 컬럼 전부(53개).
COLUMNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("admin_audit_logs", ("created_at",)),
    ("admin_users", ("created_at", "updated_at")),
    ("answer_citations", ("created_at",)),
    ("answer_feedback", ("created_at", "updated_at")),
    ("card_receipts", ("shared_at",)),
    ("chat_message_reactions", ("created_at",)),
    ("chatbot_configs", ("created_at", "suggested_at", "updated_at")),
    ("client_error_events", ("occurred_at",)),
    ("content_rights", ("created_at", "updated_at")),
    ("daily_readings", ("created_at", "updated_at")),
    ("data_source_categories", ("created_at", "updated_at")),
    ("group_members", ("joined_at",)),
    ("group_shares", ("created_at", "updated_at")),
    ("hoondok_tts_usage", ("created_at",)),
    ("ingestion_jobs", ("completed_at", "created_at", "updated_at")),
    ("jeongseong_periods", ("created_at", "ended_at", "updated_at")),
    ("jeongseong_readings", ("created_at",)),
    ("mission_logs", ("completed_at",)),
    ("notification_preferences", ("updated_at",)),
    ("passage_highlights", ("created_at", "updated_at")),
    ("passage_marks", ("created_at", "updated_at")),
    ("push_subscriptions", ("created_at",)),
    ("reading_groups", ("created_at", "invite_expires_at", "updated_at")),
    ("reading_positions", ("updated_at",)),
    ("research_sessions", ("ended_at", "started_at")),
    ("search_events", ("created_at",)),
    ("session_messages", ("created_at",)),
    ("share_reactions", ("created_at",)),
    ("shared_jeongseongs", ("created_at", "updated_at")),
    ("users", ("consented_at", "created_at", "deleted_at")),
    ("volume_sections", ("created_at", "updated_at")),
    ("word_cards", ("created_at",)),
)


def upgrade() -> None:
    # 기본값 now() 등 세션 시간대에 기대는 변환이 서버 설정에 흔들리지 않게 고정한다.
    op.execute("SET LOCAL TimeZone = 'UTC'")
    for table, columns in COLUMNS:
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(timezone=True),
                existing_type=sa.DateTime(),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
            )


def downgrade() -> None:
    # timestamptz → UTC 벽시계 naive 값. 같은 순간을 보존한다.
    op.execute("SET LOCAL TimeZone = 'UTC'")
    for table, columns in COLUMNS:
        for column in columns:
            op.alter_column(
                table,
                column,
                type_=sa.DateTime(),
                existing_type=sa.DateTime(timezone=True),
                postgresql_using=f"{column} AT TIME ZONE 'UTC'",
            )
