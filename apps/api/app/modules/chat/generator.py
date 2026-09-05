from app.core.common.gemini import generate_text
from app.modules.chat.prompt import build_context_prompt
from app.modules.chatbot.runtime_config import GenerationConfig
from app.modules.search.hybrid import SearchResult


async def generate_answer(
    query: str,
    results: list[SearchResult],
    *,
    generation_config: GenerationConfig,
    history: list[tuple[str, str]] | None = None,
) -> str:
    """검색 결과 기반 답변 생성. system_prompt 는 GenerationConfig 에서 직접 사용.

    R2 본 리팩토링 — ChatbotRuntimeConfig.generation 단일 객체로 통일.
    """
    prompt = build_context_prompt(query, results, history=history)
    return await generate_text(
        prompt,
        system_instruction=generation_config.system_prompt,
    )
