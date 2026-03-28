from unittest.mock import patch, MagicMock
from src.chat.prompt import build_context_prompt, SYSTEM_PROMPT
from src.chat.generator import generate_answer
from src.search.hybrid import SearchResult


def _make_results():
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95),
        SearchResult(text="참부모님의 가르침은 참사랑이다.", volume="vol_002", chunk_index=1, score=0.88),
    ]


def test_system_prompt_contains_core_terms():
    assert "참부모님" in SYSTEM_PROMPT
    assert "말씀" in SYSTEM_PROMPT
    assert "원리강론" in SYSTEM_PROMPT


def test_build_context_prompt_includes_all_sources():
    results = _make_results()
    prompt = build_context_prompt("사랑이란 무엇인가?", results)

    assert "하나님은 사랑이시다." in prompt
    assert "참부모님의 가르침은 참사랑이다." in prompt
    assert "vol_001" in prompt
    assert "vol_002" in prompt
    assert "사랑이란 무엇인가?" in prompt


def test_generate_answer_calls_gemini_and_returns_text():
    mock_response = MagicMock()
    mock_response.text = "사랑은 하나님의 본질입니다."

    with patch("src.chat.generator.model") as mock_model:
        mock_model.generate_content.return_value = mock_response
        answer = generate_answer("사랑이란?", _make_results())

    assert answer == "사랑은 하나님의 본질입니다."
    mock_model.generate_content.assert_called_once()


def test_generate_answer_passes_context_in_prompt():
    mock_response = MagicMock()
    mock_response.text = "답변"

    with patch("src.chat.generator.model") as mock_model:
        mock_model.generate_content.return_value = mock_response
        generate_answer("질문", _make_results())

    call_args = mock_model.generate_content.call_args
    prompt_text = call_args.args[0]
    assert "하나님은 사랑이시다." in prompt_text
