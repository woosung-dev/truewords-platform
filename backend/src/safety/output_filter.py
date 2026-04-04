"""출력 안전 레이어 — 면책 고지, 민감 인명 필터, 답변 범위 검증."""

import re

# 모든 AI 답변에 반드시 포함 (생략 불가)
DISCLAIMER = "이 답변은 AI가 생성한 참고 자료이며, 신앙 지도자의 조언을 대체하지 않습니다."

# 민감 인명/사건 — 직접 언급 시 가이드라인 답변으로 대체
# 프로덕션에서는 DB/설정 파일에서 로드 권장
SENSITIVE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # (패턴, 대체 안내 메시지)
    # 추후 도메인 전문가와 협의하여 구체적 패턴 추가
]


def filter_sensitive_names(answer: str) -> str:
    """민감 인명/사건 언급 필터링. 감지 시 가이드라인 메시지로 대체."""
    for pattern, guidance in SENSITIVE_PATTERNS:
        if pattern.search(answer):
            return guidance
    return answer


def append_disclaimer(answer: str) -> str:
    """면책 고지 추가. 이미 포함된 경우 중복 추가하지 않음."""
    if DISCLAIMER in answer:
        return answer
    return f"{answer}\n\n---\n_{DISCLAIMER}_"


async def apply_safety_layer(answer: str) -> str:
    """출력 안전 레이어 오케스트레이션.

    순서:
    1. 민감 인명 필터링
    2. 면책 고지 추가
    """
    answer = filter_sensitive_names(answer)
    answer = append_disclaimer(answer)
    return answer
