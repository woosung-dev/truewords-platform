"""채팅 도메인 공용 타입 별칭.

- AnswerMode: 답변 모드 페르소나 5종 (P0-E). 위급 시 pastoral 자동 라우팅은
  별도 파이프라인이 처리한다.
- TheologicalEmphasis: 신학 강조점 토글 (P1-G). runtime_config 의 system
  prompt 추가절(節) 분기에 사용.

PoC 정리 (2026-04-29) — P2-D MessageVisibility 는 백엔드/프론트 모두 unused
로 제거. 향후 ChatbotConfig.visibility 정책 도입 시 재추가.
"""

from __future__ import annotations

from typing import Literal

# P0-E 답변 모드 페르소나 5종
AnswerMode = Literal["standard", "theological", "pastoral", "beginner", "kids"]

# P1-G 신학 강조점 토글
TheologicalEmphasis = Literal["all", "principle", "providence", "family", "youth"]


__all__ = [
    "AnswerMode",
    "TheologicalEmphasis",
]
