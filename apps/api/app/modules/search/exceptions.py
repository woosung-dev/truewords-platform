"""검색 파이프라인 도메인 예외."""


class SearchFailedError(Exception):
    """모든 검색 tier가 실패했을 때 raise.

    개별 tier의 일시적 실패는 cascading_search가 내부에서 처리 (다음 tier 시도).
    이 예외는 모든 tier가 소진된 후에만 raise된다.

    사용자 메시지: "검색 서비스에 일시적 장애가 발생했습니다."
    상태 코드: 503 Service Unavailable
    """

    def __init__(self, reason: str = "검색 서비스 일시 장애") -> None:
        self.reason = reason
        super().__init__(reason)


class EmbeddingFailedError(Exception):
    """Gemini 임베딩 생성 실패 시 raise.

    검색이 시작되기 전 단계의 실패이므로 SearchFailedError와 구분한다.
    사용자 관점에서 '검색 준비 중 오류'와 '검색 서비스 장애'는 다른 경험이므로
    에러 코드와 메시지를 분리한다.

    사용자 메시지: "검색 준비 중 오류가 발생했습니다."
    상태 코드: 503 Service Unavailable
    """

    def __init__(self, reason: str = "임베딩 생성 실패") -> None:
        self.reason = reason
        super().__init__(reason)
