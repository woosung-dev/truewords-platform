"""ClosingTemplateStage — 답변 끝에 동봉할 기도문/결의문을 LLM 으로 생성 (P1-J).

ChatbotRuntimeConfig.generation.enable_closing=True 이고 closing_kind 가
"prayer" 또는 "resolution" 일 때만 1회 LLM 호출 (Gemini Flash, 0.5s budget).

closing_kind="off" 또는 enable_closing=False → ctx.closing = None.
타임아웃/실패 → ctx.closing = None (silent fallback, 본 답변은 영향 없음).
"""

from __future__ import annotations

import asyncio
import logging

from src.chat.pipeline.context import ChatContext
from src.common.gemini import MODEL_GENERATE, generate_text

logger = logging.getLogger(__name__)

CLOSING_TIMEOUT_SECONDS = 0.5

CLOSING_PROMPTS: dict[str, str] = {
    "prayer": (
        "당신은 가정연합 말씀 학습 도우미의 기도문 작성기입니다.\n"
        "방금 사용자가 받은 답변을 바탕으로, 그 주제에 맞는 짧은 기도문 1편을\n"
        "한국어로 작성하세요.\n\n"
        "[규칙]\n"
        "- 3~5문장, 100자 이내\n"
        "- '하나님 아버지' 또는 '참부모님' 호칭으로 시작\n"
        "- 부가 설명/제목/마크다운 금지, 본문만 출력\n"
    ),
    "resolution": (
        "당신은 가정연합 말씀 학습 도우미의 결의문 작성기입니다.\n"
        "방금 사용자가 받은 답변을 바탕으로, 사용자가 일상에서 실천할 수 있는\n"
        "짧은 결의문 1편을 한국어로 작성하세요.\n\n"
        "[규칙]\n"
        "- 2~4문장, 100자 이내\n"
        "- '저는 ~하겠습니다' 다짐 형식\n"
        "- 부가 설명/제목/마크다운 금지, 본문만 출력\n"
    ),
}


def _build_prompt(query: str, answer: str) -> str:
    snippet = (answer or "").strip()[:1200]
    return f"[사용자 질문]\n{query}\n\n[답변 요약]\n{snippet}\n\n위 답변에 어울리는 마무리 글을 작성하세요."


class ClosingTemplateStage:
    """답변 직후 기도문/결의문 1편 생성 (선택 사항).

    runtime_config.generation.enable_closing=False 또는 closing_kind="off" 또는
    실패 시 ctx.closing = None.
    """

    async def execute(self, ctx: ChatContext) -> ChatContext:
        if ctx.runtime_config is None:
            ctx.closing = None
            return ctx

        gen_cfg = ctx.runtime_config.generation
        if not gen_cfg.enable_closing or gen_cfg.closing_kind == "off":
            ctx.closing = None
            return ctx
        if not ctx.answer:
            ctx.closing = None
            return ctx

        system_prompt = CLOSING_PROMPTS.get(gen_cfg.closing_kind)
        if system_prompt is None:
            # 알려지지 않은 closing_kind — 안전하게 skip.
            ctx.closing = None
            return ctx

        prompt = _build_prompt(ctx.request.query, ctx.answer)
        try:
            raw = await asyncio.wait_for(
                generate_text(
                    prompt=prompt,
                    system_instruction=system_prompt,
                    model=MODEL_GENERATE,
                ),
                timeout=CLOSING_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "closing_template: 타임아웃 (%.1fs 초과) kind=%s",
                CLOSING_TIMEOUT_SECONDS,
                gen_cfg.closing_kind,
            )
            ctx.closing = None
            return ctx
        except Exception as exc:
            logger.warning(
                "closing_template: LLM 호출 실패 kind=%s error=%s",
                gen_cfg.closing_kind,
                exc,
            )
            ctx.closing = None
            return ctx

        text = (raw or "").strip()
        ctx.closing = text if text else None
        return ctx
