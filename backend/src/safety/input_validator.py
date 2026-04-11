"""입력 검증 — Prompt Injection 방어 + 길이/공백 체크."""

import re
import unicodedata

from src.config import settings
from src.safety.exceptions import InputBlockedError

# Zero-width 및 비표준 공백 문자 정규화 패턴
_INVISIBLE_CHARS = re.compile(
    r"[\u200b\u200c\u200d\u200e\u200f\ufeff\u00ad\u2060\u180e]"
)

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
        r"""["']?role["']?\s*[:=]\s*["']?system""",
        r"you\s+are\s+now\s+(?:a\s+)?(?:different|new)",
        r"pretend\s+(?:you\s+are|to\s+be)",
        r"act\s+as\s+(?:a\s+)?(?:different|new)",
        r"jailbreak",
        r"DAN\s+mode",
        # 영어 추가 패턴
        r"##\s*system",
        # 한국어 Prompt Injection 패턴
        r"시스템\s*프롬프트",
        r"너의\s*지시사항",
        r"이전\s*(?:지시|명령|지침|규칙).*(?:무시|잊어|잊)",
        r"(?:무시|잊어|잊).*이전\s*(?:지시|명령|지침|규칙)",
        r"역할\s*(?:을\s*)?(?:바꿔|변경)",
        r"(?:지시|명령|지침|규칙).*(?:무시|잊)",
        r"프롬프트\s*(?:를\s*)?(?:보여|알려|공개)",
        r"(?:관리자|어드민)\s*모드",
        # 한국어 추가 패턴 — 간접 역할 변경, 혼합어
        r"너는\s*.*(?:어시스턴트|assistant|AI|봇).*(?:행동|동작|역할)",
        r"지금부터\s*너는",
        r"instructions?\s*(?:를|을)\s*ignore",
        r"ignore\s*.*(?:해|하)",
    ]
]


def _normalize_input(query: str) -> str:
    """비표준 공백/제어문자 정규화. 패턴 우회 방지."""
    # Zero-width 문자를 공백으로 치환 (단어 사이 삽입 우회 방지)
    cleaned = _INVISIBLE_CHARS.sub(" ", query)
    # Non-breaking space → 일반 공백
    cleaned = cleaned.replace("\xa0", " ")
    # Unicode NFKC 정규화 (전각→반각 등)
    cleaned = unicodedata.normalize("NFKC", cleaned)
    return cleaned


async def validate_input(query: str) -> None:
    """입력 검증. 차단 시 InputBlockedError 발생.

    검증 순서:
    1. 빈 문자열 / 공백만 있는 경우
    2. 길이 제한 초과
    3. 입력 정규화 (zero-width 문자, 비표준 공백 제거)
    4. Prompt Injection 패턴 매칭
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

    # 3. 정규화 (패턴 우회 방지)
    normalized = _normalize_input(stripped)

    # 4. Prompt Injection 패턴
    for pattern in BLOCKED_PATTERNS:
        if pattern.search(normalized):
            raise InputBlockedError("허용되지 않는 입력 패턴이 감지되었습니다.")
