"""drop collection_main from chatbot_configs + deactivate PoC bots

Revision ID: aa6f4b908ef4
Revises: c59c535a2200
Create Date: 2026-04-30 23:00:00.000000

Phase 2 — `collection_main` 봇별 컬렉션 토글 폐기 후속 (dev-log 52).

Phase 1 (코드 사용 중단) 안정 배포 확인 후 컬럼 자체를 drop 한다. backend/src
어디에서도 이 컬럼을 참조하지 않으므로 단순 drop_column 으로 충분하다.

추가로 Phase 2.x 청킹 PoC 봇(chunking-sentence / chunking-token1024 /
chunking-paragraph / all-paragraph) 을 is_active=False 로 비활성화한다.
research_sessions.chatbot_config_id FK 가 있어 hard delete 는 위험하므로
소프트 비활성화로 운영 어드민 목록에서 숨긴다.

downgrade 는 컬럼 재추가만 수행한다 (PoC 봇 활성화 복원은 운영 정책상
의도되지 않음).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'aa6f4b908ef4'
down_revision: Union[str, None] = 'c59c535a2200'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DEPRECATED_POC_CHATBOT_IDS = (
    'chunking-sentence',
    'chunking-token1024',
    'chunking-paragraph',
    'all-paragraph',
)


def upgrade() -> None:
    # 1) Phase 2.x 청킹 PoC 봇 비활성화 (research_sessions FK 보호 — hard delete 회피)
    #    값은 hardcoded constant 라 literal SQL 로 작성. offline SQL 생성 시
    #    expanding bindparam 이 NULL 로 풀리는 문제를 회피.
    quoted_ids = ', '.join(f"'{cid}'" for cid in _DEPRECATED_POC_CHATBOT_IDS)
    op.execute(
        f"UPDATE chatbot_configs SET is_active = FALSE "
        f"WHERE chatbot_id IN ({quoted_ids})"
    )
    # 2) collection_main 컬럼 drop
    op.drop_column('chatbot_configs', 'collection_main')


def downgrade() -> None:
    op.add_column(
        'chatbot_configs',
        sa.Column(
            'collection_main',
            sqlmodel.sql.sqltypes.AutoString(),
            nullable=False,
            server_default='malssum_poc',
        ),
    )
