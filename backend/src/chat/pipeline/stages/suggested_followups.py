"""SuggestedFollowupsStage — 답변 본문 생성 직후 후속 질문 3개를 LLM 으로 추천 (P0-A).

GenerationStage 가 ctx.answer 를 채운 직후 실행. 별도 LLM 1회 호출 (Gemini Flash,
0.5s budget). 0건 fallback 이 아니라 모든 답변에 노출하는 게 ADR-46 의 의도.

타임아웃/실패/파싱 실패 → ctx.suggested_followups = None (silent fallback).
runtime_config.generation.enable_suggested_followups=False 일 때 즉시 skip.
"""

from __future__ import annotations

import asyncio
import logging
import re

from src.chat.pipeline.context import ChatContext
from src.common.gemini import MODEL_GENERATE, generate_text

logger = logging.getLogger(__name__)

# 답변 후속 질문 1회 LLM 호출 예산.
SUGGESTED_FOLLOWUPS_TIMEOUT_SECONDS = 0.5

SUGGESTED_FOLLOWUPS_SYSTEM_PROMPT = """당신은 가정연합 말씀 학습 도우미의 후속 질문 추천기입니다.

방금 사용자가 받은 답변을 바탕으로, 사용자가 자연스럽게 이어서 물어볼 만한
후속 질문 3개를 한국어로 제안하세요.

[규칙]
- 정확히 3줄, 각 줄은 하나의 질문
- 1) / 2) / 3) 등의 번호 접두사를 붙이지 않습니다
- 따옴표, 마크다운, 부가 설명 일체 금지
- 각 질문은 25자 이내로 간결하게
- 가정연합 말씀/원리/축복/효정/천일국 등 도메인 안에서 추천
"""

# 출력 한 줄을 후속 질문 1개로 파싱할 때 제거할 노이즈 prefix.
_PREFIX_NOISE = re.compile(r"^\s*(?:[-*•·]|\d+[\.\)])\s*")


def _parse_followups(raw: str) -> list[str]:
    """LLM 출력 → 최대 3개 question 리스트. 빈/짧은 줄은 버린다."""
    if not raw:
        return []
    out: list[str] = []
    for line in raw.splitlines():
        cleaned = _PREFIX_NOISE.sub("", line).strip().strip('"').strip("'")
        if len(cleaned) < 3:
            continue
        out.append(cleaned)
        if len(out) >= 3:
            break
    return out


def _build_prompt(query: str, answer: str) -> str:
    # 답변이 너무 길면 LLM 토큰 낭비 — 앞부분만 컨텍스트로 사용.
    snippet = (answer or "").strip()[:1200]
    return f"[사용자 질문]\n{query}\n\n[답변 요약]\n{snippet}\n\n위 흐름에서 이어질 후속 질문 3개를 출력하세요."


class SuggestedFollowupsStage:
    """답변 직후 후속 질문 3개를 추천한다.

    실패/타임아웃/runtime_config 미설정 시 ctx.suggested_followups = None.
    """

    async def execute(self, ctx: ChatContext) -> ChatContext:
        # 활성 토글 검사. runtime_config 없으면 default(True) 따라가지 않고 skip.
        if ctx.runtime_config is None:
            ctx.suggested_followups = None
            return ctx
        if not ctx.runtime_config.generation.enable_suggested_followups:
            ctx.suggested_followups = None
            return ctx
        if not ctx.answer:
            ctx.suggested_followups = None
            return ctx
        # PoC hotfix (Codex review #2 권고) — pastoral 모드는 위기 답변이므로
        # "다음 질문 추천" 노출이 의료 윤리적으로 부적절. 자동 skip.
        if ctx.resolved_answer_mode == "pastoral":
            ctx.suggested_followups = None
            return ctx

        prompt = _build_prompt(ctx.request.query, ctx.answer)
        try:
            raw = await asyncio.wait_for(
                generate_text(
                    prompt=prompt,
                    system_instruction=SUGGESTED_FOLLOWUPS_SYSTEM_PROMPT,
                    model=MODEL_GENERATE,
                ),
                timeout=SUGGESTED_FOLLOWUPS_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "suggested_followups: 타임아웃 (%.1fs 초과) | query=%r",
                SUGGESTED_FOLLOWUPS_TIMEOUT_SECONDS,
                ctx.request.query[:80],
            )
            ctx.suggested_followups = None
            return ctx
        except Exception as exc:
            logger.warning(
                "suggested_followups: LLM 호출 실패 | query=%r error=%s",
                ctx.request.query[:80],
                exc,
            )
            ctx.suggested_followups = None
            return ctx

        parsed = _parse_followups(raw)
        ctx.suggested_followups = parsed if parsed else None
        return ctx
