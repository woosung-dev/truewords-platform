from fastapi import APIRouter
from pydantic import BaseModel
from src.search.hybrid import hybrid_search
from src.chat.generator import generate_answer
from src.qdrant_client import get_client

router = APIRouter()


class ChatRequest(BaseModel):
    query: str


class Source(BaseModel):
    volume: str
    text: str
    score: float


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    client = get_client()
    results = hybrid_search(client, request.query, top_k=10)
    answer = generate_answer(request.query, results)
    return ChatResponse(
        answer=answer,
        sources=[
            Source(volume=r.volume, text=r.text, score=r.score)
            for r in results[:3]
        ],
    )
