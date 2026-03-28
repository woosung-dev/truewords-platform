from dataclasses import dataclass
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Prefetch,
    FusionQuery,
    Fusion,
    SparseVector,
)
from src.pipeline.embedder import embed_dense_query, embed_sparse
from src.config import settings


@dataclass
class SearchResult:
    text: str
    volume: str
    chunk_index: int
    score: float


def hybrid_search(
    client: QdrantClient,
    query: str,
    top_k: int = 10,
) -> list[SearchResult]:
    dense = embed_dense_query(query)
    sparse_indices, sparse_values = embed_sparse(query)

    response = client.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=dense, using="dense", limit=50),
            Prefetch(
                query=SparseVector(
                    indices=sparse_indices,
                    values=sparse_values,
                ),
                using="sparse",
                limit=50,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        limit=top_k,
    )

    return [
        SearchResult(
            text=point.payload["text"],
            volume=point.payload["volume"],
            chunk_index=point.payload.get("chunk_index", 0),
            score=point.score,
        )
        for point in response.points
    ]
