"""공통 Pydantic 스키마 — 여러 feature가 공유하는 응답 포맷."""

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """통합 에러 응답 포맷 (Flutter 소비 라우터 기준).

    Attributes:
        error_code: 프론트엔드 분기용 에러 코드 (예: INPUT_BLOCKED)
        message: 사용자 표시 메시지 (한국어)
        request_id: 요청 추적 식별자 (UUID v4 또는 X-Request-Id 헤더값)
        details: 디버깅용 추가 정보 (선택, 프로덕션에서는 사용 자제)
    """

    error_code: str = Field(description="프론트엔드 분기용 에러 코드")
    message: str = Field(description="사용자 표시 메시지 (한국어)")
    request_id: str = Field(description="요청 추적 식별자")
    details: dict | None = Field(default=None, description="디버깅용 추가 정보")
