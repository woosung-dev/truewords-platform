"""채팅 도메인 공용 타입 별칭.

다른 worktree (chat-input-pack, answer-pipeline-pack 등) 에서도 동일한
Literal 타입을 import 해 사용할 수 있도록 별도 모듈로 분리.

- AnswerMode: 답변 모드 페르소나 5종 (P0-E). 위급 시 pastoral 자동 라우팅은
  별도 파이프라인이 처리한다.
- TheologicalEmphasis: 신학 강조점 토글 (P1-G). runtime_config 의 system
  prompt 추가절(節) 분기에 사용.
- MessageVisibility: 메시지 공개 범위 (P2-D). chat_message.visibility 컬럼과
  매핑.
"""

from __future__ import annotations

from typing import Literal

# P0-E 답변 모드 페르소나 5종
AnswerMode = Literal["standard", "theological", "pastoral", "beginner", "kids"]

# P1-G 신학 강조점 토글
TheologicalEmphasis = Literal["all", "principle", "providence", "family", "youth"]

# P2-D 공개/비공개 토글
MessageVisibility = Literal["private", "unlisted", "public"]


__all__ = [
    "AnswerMode",
    "TheologicalEmphasis",
    "MessageVisibility",
]
