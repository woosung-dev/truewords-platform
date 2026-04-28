"""입력 검증 — Prompt Injection 방어 + 길이/공백 체크.

P1-E (W2-⑦) Soft Refusal 전환:
- 빈 입력 / 길이 초과 → 여전히 ``InputBlockedError`` (hard fail).
- Prompt Injection 패턴 매치 → 예외 대신 ``InputValidationResult(passed=False, reason="injection")``
  반환. 호출자(InputValidationStage)가 ctx flag 로 변환 후, service.py 가
  generation/search 를 스킵하고 표준 거절 + 추천 질문 3개를 응답한다.
"""

import re
import unicodedata
from dataclasses import dataclass

from src.config import settings
from src.safety.exceptions import InputBlockedError

# Zero-width 및 비표준 공백 문자 정규화 패턴
_INVISIBLE_CHARS = re.compile(
    r"[​‌‍‎‏﻿­⁠᠎]"
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


@dataclass(frozen=True)
class InputValidationResult:
    """입력 검증 결과.

    passed=True  → 정상 입력. reason 은 None.
    passed=False → soft refusal 대상. reason 은 거절 사유 코드 ('injection').
                   호출자는 ctx flag 로 변환해 generation/search 를 스킵하고
                   표준 거절 + 추천 질문 응답을 구성한다.
    """

    passed: bool
    reason: str | None = None


def _normalize_input(query: str) -> str:
    """비표준 공백/제어문자 정규화. 패턴 우회 방지."""
    # Zero-width 문자를 공백으로 치환 (단어 사이 삽입 우회 방지)
    cleaned = _INVISIBLE_CHARS.sub(" ", query)
    # Non-breaking space → 일반 공백
    cleaned = cleaned.replace("\xa0", " ")
    # Unicode NFKC 정규화 (전각→반각 등)
    cleaned = unicodedata.normalize("NFKC", cleaned)
    return cleaned


async def validate_input(query: str) -> InputValidationResult:
    """입력 검증.

    검증 순서:
    1. 빈 문자열 / 공백만 있는 경우 → ``InputBlockedError`` (hard fail).
    2. 길이 제한 초과 → ``InputBlockedError`` (hard fail).
    3. 입력 정규화 (zero-width 문자, 비표준 공백 제거).
    4. Prompt Injection 패턴 매칭 → ``InputValidationResult(passed=False, reason="injection")``.

    Returns:
        ``InputValidationResult``. passed=True 이면 정상, passed=False 이면 soft refusal.
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

    # 4. Prompt Injection 패턴 → soft refusal (예외 대신 결과 반환)
    for pattern in BLOCKED_PATTERNS:
        if pattern.search(normalized):
            return InputValidationResult(passed=False, reason="injection")

    return InputValidationResult(passed=True)
