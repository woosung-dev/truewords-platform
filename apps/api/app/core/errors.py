"""서비스 계층이 던지는 HTTP 오류.

fastapi.HTTPException 의 하위 클래스라 기본 핸들러를 그대로 타고 응답은 {"detail": ...} 그대로다.
error_code 가 필요한 거절(ErrorResponse 본문)은 모듈별 예외(예: hoondok/exceptions.py)를 쓴다.
"""

from fastapi import HTTPException


class DomainError(HTTPException):
    """상태 코드를 직접 지정하는 서비스 오류."""


class NotFoundError(DomainError):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=404, detail=detail)


class ConflictError(DomainError):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=409, detail=detail)


class InvalidError(DomainError):
    def __init__(self, detail: str) -> None:
        super().__init__(status_code=422, detail=detail)
