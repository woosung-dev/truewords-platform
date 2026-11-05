"""훈독 도메인 예외 — 중앙 핸들러(app/core/common/exception_handlers.py)가 ErrorResponse 로 바꾼다."""

from datetime import datetime


class PushDisabledError(Exception):
    """VAPID 미설정 상태에서 푸시 구독 시도 (409 PUSH_DISABLED, PLAN-HD-006).

    서버가 발송 키를 갖고 있지 않으면 구독을 저장해도 알림이 가지 않는다 —
    조용히 받아 두지 않고 거절해 클라이언트가 브라우저 구독을 정리하게 한다.
    """

    def __init__(self) -> None:
        super().__init__("알림이 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요")


class TtsError(Exception):
    """AI 낭독(PLAN-HD-011) 거절. 상태 코드와 오류 코드가 사유마다 다르다 — 클라이언트는 코드로 대체 경로를 고른다.

    - 422 TTS_INVALID_VOICE · 503 TTS_DISABLED(키 없음) · 404 TTS_SOURCE_NOT_FOUND
    - 429 TTS_QUOTA_EXCEEDED(월 글자 상한) · 502 TTS_UPSTREAM_FAILED(Google 오류·네트워크)
    """

    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code


class AskDailyLimitError(Exception):
    """훈독 AI 질문 하루 횟수 초과 (429 ASK_DAILY_LIMIT, DEC-PWA-025 2차). KST 자정에 다시 열린다."""

    def __init__(self, limit: int, used: int, resets_at: datetime) -> None:
        super().__init__(f"오늘 질문 {limit}번을 모두 썼어요. 내일 0시에 다시 물을 수 있어요")
        self.limit = limit
        self.used = used
        self.resets_at = resets_at


class PathError(Exception):
    """7일 정성(읽기 정성) 거절. 클라이언트는 error_code 로 화면을 고른다.

    - 404 PATH_NOT_FOUND · PATH_RUN_NOT_FOUND · PATH_STEP_NOT_FOUND
    - 409 PATH_RUN_ACTIVE(진행 중 7일 정성) · JEONGSEONG_ACTIVE(진행 중 정성 기간)
    - 409 ALREADY_READ_TODAY(오늘 다른 장을 이미 읽음) · STEP_OUT_OF_ORDER · PATH_RUN_NOT_ACTIVE · PATH_RUN_NOT_COMPLETED
    - 403 RIGHTS_CLOSED(시작 때 장 권리 닫힘)
    """

    def __init__(self, status_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
