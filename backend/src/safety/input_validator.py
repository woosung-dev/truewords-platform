"""입력 검증 — Prompt Injection 방어 + 길이/공백 체크."""

import re

from src.config import settings
from src.safety.exceptions import InputBlockedError

# 컴파일된 정규식 패턴 — 악의적 입력 탐지
BLOCKED_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        # 영어 Prompt Injection 패턴
        r"ignore\s+(all\s+)?previous",
        r"ignore\s+(all\s+)?instructions",
        r"forget\s+(your|all)\s+instructions",
        r"disregard\s+(all\s+)?previous",
        r"override\s+(your\s+)?instructions",
        r"role:\s*system",
        r"you\s+are\s+now\s+(?:a\s+)?(?:different|new)",
        r"pretend\s+(?:you\s+are|to\s+be)",
        r"act\s+as\s+(?:a\s+)?(?:different|new)",
        r"jailbreak",
        r"DAN\s+mode",
        # 한국어 Prompt Injection 패턴
        r"시스템\s*프롬프트",
        r"너의\s*지시사항",
        r"이전\s*(?:지시|명령|지침).*(?:무시|잊어)",
        r"(?:무시|잊어).*이전\s*(?:지시|명령|지침)",
        r"역할\s*(?:을\s*)?(?:바꿔|변경)",
        r"(?:지시|명령|지침).*(?:무시|잊)",
        r"프롬프트\s*(?:를\s*)?(?:보여|알려|공개)",
        r"(?:관리자|어드민)\s*모드",
    ]
]


async def validate_input(query: str) -> None:
    """입력 검증. 차단 시 InputBlockedError 발생.

    검증 순서:
    1. 빈 문자열 / 공백만 있는 경우
    2. 길이 제한 초과
    3. Prompt Injection 패턴 매칭
    """
    # 1. 빈 문자열 / 공백
    stripped = query.strip()
    if not stripped:
        raise InputBlockedError("빈 질문은 처리할 수 없습니다.")

    # 2. 길이 제한
    if len(stripped) > settings.safety_max_query_length:
        raise InputBlockedError(
            f"질문은 {settings.safety_max_query_length}자 이내로 입력해주세요."
        )

    # 3. Prompt Injection 패턴
    for pattern in BLOCKED_PATTERNS:
        if pattern.search(stripped):
            raise InputBlockedError("허용되지 않는 입력 패턴이 감지되었습니다.")
