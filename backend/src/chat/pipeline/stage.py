"""Stage Protocol — Pipeline 의 단일 실행 단위."""

from __future__ import annotations

from typing import Protocol

from src.chat.pipeline.context import ChatContext


class Stage(Protocol):
    """ChatContext 를 입력받아 변환 후 반환.

    Stage 는 stateful 가능 (의존성 주입). 예외는 raise 그대로 —
    process_chat 의 try/except 가 처리.
    """

    async def execute(self, ctx: ChatContext) -> ChatContext: ...
