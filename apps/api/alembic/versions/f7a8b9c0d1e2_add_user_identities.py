"""add user_identities + users.password_hash NULL 허용 + 이메일 확인 컬럼 — 구글 로그인·계정/로그인 수단 분리

계정(users)과 로그인 수단(user_identities)을 분리한다. 계정 키는 (issuer, subject_scope, subject)이며
이메일은 키가 아니다. users.email 은 건드리지 않는다.

- upgrade 는 추가·완화뿐이라 직전 이미지와 호환된다(password_hash NULL 계정의 비밀번호 로그인은 401).
- users.session_version 은 로그인 수단이 바뀔 때 올려 옛 세션을 끊는 값이다. server_default 가 있어 이 컬럼을
  모르는 직전 이미지가 INSERT 해도 0 으로 들어간다.
- 롤백은 이미지만 되돌린다. downgrade 는 비상용이다 — 구글 전용 계정뿐 아니라 구글을 연결해 비밀번호가 지워진
  기존 계정도(password_hash NULL) 사용할 수 없는 해시가 채워져 비밀번호로 로그인할 수 없게 되므로 잠긴다.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
"""

import sqlalchemy as sa
from alembic import op

revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None

# 어떤 비밀번호와도 일치하지 않는 유효한 형식의 bcrypt 해시(cost 12, salt·본문을 모두 고정한 값).
# 형식이 유효해야 checkpw 가 예외 없이 False 를 돌려준다. 이 값에 대응하는 평문은 알려져 있지 않다.
_UNUSABLE_BCRYPT_HASH = "$2b$12$" + "." * 53


def upgrade() -> None:
    # users 에 ALTER 를 걸 때 긴 트랜잭션 뒤에서 대기하면 그 뒤의 users 조회가 줄줄이 막힌다 — 오래 기다리지 말고 실패시킨다.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "user_identities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # 제공자는 PG ENUM 이 아니라 varchar + 앱 검증이다.
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("issuer", sa.String(255), nullable=False),
        # sub 가 앱 단위인 제공자(카카오 앱 ID 등)만 채운다. 구글은 ''.
        sa.Column("subject_scope", sa.String(255), nullable=False, server_default=""),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("client_id", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("issuer", "subject_scope", "subject", name="uq_user_identities_subject"),
        sa.UniqueConstraint("user_id", "issuer", "subject_scope", name="uq_user_identities_user_issuer"),
    )
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=True)
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("email_verified_by", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("session_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    """비상용. 롤백은 이미지만 되돌리는 것이 기본이다 — 구글 전용 계정뿐 아니라 구글을 연결해 비밀번호가 지워진 기존 계정도 여기서 잠긴다."""
    op.drop_table("user_identities")
    op.drop_column("users", "session_version")
    op.drop_column("users", "email_verified_by")
    op.drop_column("users", "email_verified_at")
    op.execute(
        sa.text("UPDATE users SET password_hash = :unusable WHERE password_hash IS NULL").bindparams(
            unusable=_UNUSABLE_BCRYPT_HASH
        )
    )
    op.alter_column("users", "password_hash", existing_type=sa.String(255), nullable=False)
