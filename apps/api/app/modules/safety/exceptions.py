"""보안 관련 예외 클래스."""


class InputBlockedError(Exception):
    """Prompt Injection 등 악의적 입력 감지 시 발생."""

    def __init__(self, reason: str = "차단된 입력입니다.") -> None:
        self.reason = reason
        super().__init__(reason)


class RateLimitExceededError(Exception):
    """요청 빈도 제한 초과 시 발생."""

    def __init__(self, retry_after: int = 60) -> None:
        self.retry_after = retry_after
        super().__init__(f"요청 빈도 제한을 초과했습니다. {retry_after}초 후 다시 시도해주세요.")
