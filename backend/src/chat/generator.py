import google.generativeai as genai
from src.config import settings
from src.chat.prompt import SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult

genai.configure(api_key=settings.gemini_api_key)

model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    system_instruction=SYSTEM_PROMPT,
)


def generate_answer(query: str, results: list[SearchResult]) -> str:
    prompt = build_context_prompt(query, results)
    response = model.generate_content(prompt)
    return response.text
