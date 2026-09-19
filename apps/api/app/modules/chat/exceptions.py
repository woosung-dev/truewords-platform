"""채팅 도메인 예외 클래스."""

from __future__ import annotations

import uuid


class SessionOwnershipError(Exception):
    """다른 사용자(또는 로그인 사용자 → 익명)의 세션에 이어쓰기를 시도할 때 발생 (SEC-MONO-001).

    글로벌 exception handler 가 403 으로 변환한다. 세션 존재 여부를 노출하지 않도록
    메시지는 고정 문구를 쓴다.
    """

    def __init__(self, session_id: uuid.UUID) -> None:
        self.session_id = session_id
        super().__init__("이 세션에 이어서 대화할 권한이 없습니다.")
