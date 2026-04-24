"""스트리밍 답변 생성기. Gemini 스트리밍 API를 래핑."""

from collections.abc import AsyncGenerator

from src.common.gemini import generate_text_stream
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult


async def generate_answer_stream(
    query: str,
    results: list[SearchResult],
    *,
    system_prompt: str | None = None,
) -> AsyncGenerator[str, None]:
    """검색 결과 기반 스트리밍 답변 생성 (비동기 제너레이터).

    system_prompt 가 None 또는 빈 문자열이면 DEFAULT_SYSTEM_PROMPT 로 fallback.
    """
    effective = (system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT
    prompt = build_context_prompt(query, results)
    async for chunk in generate_text_stream(prompt, system_instruction=effective):
        yield chunk
