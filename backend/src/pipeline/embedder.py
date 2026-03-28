from google import genai
from google.genai import types
from fastembed import SparseTextEmbedding
from src.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

_sparse_model: SparseTextEmbedding | None = None


def get_sparse_model() -> SparseTextEmbedding:
    global _sparse_model
    if _sparse_model is None:
        _sparse_model = SparseTextEmbedding(model_name="Qdrant/bm25")
    return _sparse_model


def embed_dense_document(text: str) -> list[float]:
    result = _client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT"),
    )
    return result.embeddings[0].values


def embed_dense_query(text: str) -> list[float]:
    result = _client.models.embed_content(
        model="gemini-embedding-001",
        contents=text,
        config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
    )
    return result.embeddings[0].values


def embed_sparse(text: str) -> tuple[list[int], list[float]]:
    model = get_sparse_model()
    embeddings = list(model.embed([text]))
    sparse = embeddings[0]
    return sparse.indices.tolist(), sparse.values.tolist()
