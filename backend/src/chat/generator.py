from src.common.gemini import generate_text
from src.chat.prompt import DEFAULT_SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult


async def generate_answer(
    query: str,
    results: list[SearchResult],
    *,
    system_prompt: str | None = None,
) -> str:
    """검색 결과 기반 답변 생성 (비동기).

    system_prompt 가 None 또는 빈 문자열이면 DEFAULT_SYSTEM_PROMPT 로 fallback.
    ChatbotConfig.system_prompt 동적 주입을 위한 R2 Vertical Slice.
    """
    effective = (system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT
    prompt = build_context_prompt(query, results)
    return await generate_text(prompt, system_instruction=effective)
