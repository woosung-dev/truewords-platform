"""스트리밍 답변 생성기. Gemini 스트리밍 API를 래핑."""

from collections.abc import AsyncGenerator

from app.core.common.gemini import generate_text_stream
from app.modules.chat.prompt import build_context_prompt
from app.modules.chatbot.runtime_config import GenerationConfig
from app.modules.search.hybrid import SearchResult


async def generate_answer_stream(
    query: str,
    results: list[SearchResult],
    *,
    generation_config: GenerationConfig,
    history: list[tuple[str, str]] | None = None,
) -> AsyncGenerator[str, None]:
    """검색 결과 기반 스트리밍 답변 생성. R2 — GenerationConfig 단일 인자."""
    prompt = build_context_prompt(query, results, history=history)
    async for chunk in generate_text_stream(
        prompt, system_instruction=generation_config.system_prompt
    ):
        yield chunk
