import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from main import app

client = TestClient(app)


def _mock_search_results():
    from src.search.hybrid import SearchResult
    return [
        SearchResult(text="하나님은 사랑이시다.", volume="vol_001", chunk_index=0, score=0.95, source="A"),
    ]


def test_chat_endpoint_returns_200():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란 무엇인가?"})

    assert response.status_code == 200


def test_chat_endpoint_response_has_answer_and_sources():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="사랑은 하나님의 본질입니다."),
    ):
        response = client.post("/chat", json={"query": "사랑이란?"})

    data = response.json()
    assert "answer" in data
    assert "sources" in data
    assert data["answer"] == "사랑은 하나님의 본질입니다."
    assert len(data["sources"]) == 1
    assert data["sources"][0]["volume"] == "vol_001"


def test_chat_endpoint_requires_query_field():
    response = client.post("/chat", json={})
    assert response.status_code == 422


def test_chat_endpoint_empty_results_handled():
    with (
        patch("api.routes.cascading_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "존재하지않는질문"})

    assert response.status_code == 200
    assert "answer" in response.json()


def test_chat_endpoint_accepts_chatbot_id():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="답변입니다."),
    ):
        response = client.post("/chat", json={"query": "질문", "chatbot_id": "malssum_priority"})

    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "답변입니다."


def test_chat_endpoint_without_chatbot_id_uses_default():
    with (
        patch("api.routes.cascading_search", return_value=_mock_search_results()),
        patch("api.routes.generate_answer", return_value="기본 답변."),
    ):
        response = client.post("/chat", json={"query": "질문"})

    assert response.status_code == 200


def test_chat_endpoint_returns_empty_answer_when_no_results():
    with (
        patch("api.routes.cascading_search", return_value=[]),
        patch("api.routes.generate_answer", return_value="해당 내용을 말씀에서 찾지 못했습니다."),
    ):
        response = client.post("/chat", json={"query": "찾을수없는질문"})

    assert response.status_code == 200
    assert "찾지 못했습니다" in response.json()["answer"]


def test_chatbot_list_endpoint():
    response = client.get("/chatbots")
    assert response.status_code == 200
    data = response.json()
    assert "chatbot_ids" in data
    assert "malssum_priority" in data["chatbot_ids"]
