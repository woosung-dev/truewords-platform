"""훈독 identity 예외 — 중앙 핸들러(app/core/common/exception_handlers.py)가 ErrorResponse 로 바꾼다."""


class InviteRequiredError(Exception):
    """제한 베타 초대 코드 누락·불일치 (403 INVITE_REQUIRED, PLAN-HD-001 Phase 3 F).

    이메일 중복(409)보다 먼저 검사해 초대받지 않은 요청에 이메일 존재 여부를 알리지 않는다.
    """

    def __init__(self) -> None:
        super().__init__("초대 코드가 필요해요. 초대받은 코드를 확인해 주세요")
