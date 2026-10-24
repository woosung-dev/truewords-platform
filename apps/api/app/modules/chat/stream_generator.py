"""스트리밍 답변 생성기. Gemini 스트리밍 API를 래핑."""

from collections.abc import AsyncGenerator
from contextlib import aclosing

from app.modules.chat.pipeline.context import ChatContext
from app.modules.safety.output_filter import StreamingSanitizer

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


async def sanitize_answer_stream(
    chunks: AsyncGenerator[str, None], ctx: ChatContext
) -> AsyncGenerator[str, None]:
    """안전 조각을 내보내고 정상 소진 때만 최종 답을 채운다. 중단 시 원본 생성기도 닫는다."""
    sanitizer = StreamingSanitizer()
    answer: list[str] = []
    guidance: str | None = None
    async with aclosing(chunks):
        async for chunk in chunks:
            released = sanitizer.feed(chunk)
            if sanitizer.aborted:
                guidance = released
                if released:
                    yield released
                break
            answer.append(chunk)
            if released:
                yield released
        if not sanitizer.aborted:
            tail = sanitizer.flush()
            if tail:
                yield tail
    ctx.stream_sanitizer_aborted = sanitizer.aborted
    ctx.answer = guidance if guidance is not None else "".join(answer)
