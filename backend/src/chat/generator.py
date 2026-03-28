from google import genai
from google.genai import types
from src.config import settings
from src.chat.prompt import SYSTEM_PROMPT, build_context_prompt
from src.search.hybrid import SearchResult

_client = genai.Client(api_key=settings.gemini_api_key)


def generate_answer(query: str, results: list[SearchResult]) -> str:
    prompt = build_context_prompt(query, results)
    response = _client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
        ),
    )
    return response.text
