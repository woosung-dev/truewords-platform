"""RuntimeConfigStage — chatbot_id 기반 런타임 설정 조회."""

from __future__ import annotations

from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.state import PipelineState, check_precondition
from app.modules.chatbot.runtime_config import ChatbotRuntimeConfig
from app.modules.chatbot.service import ChatbotService


class RuntimeConfigStage:
    """ChatbotService.build_runtime_config 결과를 ctx.runtime_config 에 저장.

    None 반환 시 default_config 로 fallback (chatbot_id=None 또는 미존재 처리).
    """

    def __init__(
        self,
        chatbot_service: ChatbotService,
        *,
        default_config: ChatbotRuntimeConfig,
    ) -> None:
        self.chatbot_service = chatbot_service
        self.default_config = default_config

    async def execute(self, ctx: ChatContext) -> ChatContext:
        check_precondition(self.__class__.__name__, ctx)
        ctx.runtime_config = (
            await self.chatbot_service.build_runtime_config(ctx.request.chatbot_id)
            or self.default_config
        )
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED
        return ctx
