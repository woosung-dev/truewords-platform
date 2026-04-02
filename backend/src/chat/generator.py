from src.common.gemini import generate_text
from src.chat.prompt import SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult


async def generate_answer(query: str, results: list[SearchResult]) -> str:
    """검색 결과 기반 답변 생성 (비동기)."""
    prompt = build_context_prompt(query, results)
    return await generate_text(prompt, system_instruction=SYSTEM_PROMPT)
