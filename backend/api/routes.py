from fastapi import APIRouter
from pydantic import BaseModel
from src.search.cascading import cascading_search
from src.chat.generator import generate_answer
from src.chatbot.configs import get_chatbot_config, list_chatbot_ids
from src.qdrant_client import get_client

router = APIRouter()


class ChatRequest(BaseModel):
    query: str
    chatbot_id: str | None = None


class Source(BaseModel):
    volume: str
    text: str
    score: float
    source: str = ""


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    client = get_client()
    config = get_chatbot_config(request.chatbot_id)
    results = cascading_search(client, request.query, config, top_k=10)
    answer = generate_answer(request.query, results)
    return ChatResponse(
        answer=answer,
        sources=[
            Source(volume=r.volume, text=r.text, score=r.score, source=r.source)
            for r in results[:3]
        ],
    )


@router.get("/chatbots")
def get_chatbots():
    return {"chatbot_ids": list_chatbot_ids()}
