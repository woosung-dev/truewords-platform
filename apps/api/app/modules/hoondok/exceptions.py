"""훈독 도메인 예외 — 중앙 핸들러(app/core/common/exception_handlers.py)가 ErrorResponse 로 바꾼다."""


class PushDisabledError(Exception):
    """VAPID 미설정 상태에서 푸시 구독 시도 (409 PUSH_DISABLED, PLAN-HD-006).

    서버가 발송 키를 갖고 있지 않으면 구독을 저장해도 알림이 가지 않는다 —
    조용히 받아 두지 않고 거절해 클라이언트가 브라우저 구독을 정리하게 한다.
    """

    def __init__(self) -> None:
        super().__init__("알림이 아직 준비되지 않았어요. 잠시 뒤에 다시 시도해 주세요")
