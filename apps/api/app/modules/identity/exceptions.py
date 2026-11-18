"""훈독 identity 예외 — 중앙 핸들러(app/core/common/exception_handlers.py)가 ErrorResponse 로 바꾼다."""


class InviteRequiredError(Exception):
    """제한 베타 초대 코드 누락·불일치 (403 INVITE_REQUIRED, PLAN-HD-001 Phase 3 F).

    이메일 중복(409)보다 먼저 검사해 초대받지 않은 요청에 이메일 존재 여부를 알리지 않는다.
    """

    def __init__(self) -> None:
        super().__init__("초대 코드가 필요해요. 초대받은 코드를 확인해 주세요")


class IdentityError(Exception):
    """로그인 수단 거절. 클라이언트는 error_code 로 화면을 고른다.

    - 404 OAUTH_PROVIDER_UNAVAILABLE(미등록·미설정 제공자) · IDENTITY_NOT_FOUND(없거나 남의 로그인 수단)
    - 409 LAST_LOGIN_METHOD(마지막 로그인 수단은 해제할 수 없다)
    - 410 PASSWORD_SIGNUP_CLOSED(이메일·비밀번호 가입 종료)
    """

    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
