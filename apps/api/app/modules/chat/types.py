"""채팅 도메인 공용 타입 별칭.

- AnswerMode: 답변 모드 페르소나 5종 (P0-E). 위급 시 pastoral 자동 라우팅은
  별도 파이프라인이 처리한다.

PoC 정리 (2026-04-29) — P2-D MessageVisibility 는 백엔드/프론트 모두 unused
로 제거. 향후 ChatbotConfig.visibility 정책 도입 시 재추가.

v3 개편 (2026-05-14) — P1-G TheologicalEmphasis 5종 폐기. 강조점은 모드 모듈
본문에 흡수되었다.
"""

from __future__ import annotations

from typing import Literal

# P0-E 답변 모드 페르소나 5종
AnswerMode = Literal["standard", "theological", "pastoral", "beginner", "kids"]


__all__ = [
    "AnswerMode",
]
