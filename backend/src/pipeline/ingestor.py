import uuid
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, SparseVector
from src.pipeline.chunker import Chunk
from src.pipeline.embedder import embed_dense_document, embed_sparse


def ingest_chunks(
    client: QdrantClient,
    collection_name: str,
    chunks: list[Chunk],
) -> None:
    if not chunks:
        return

    points: list[PointStruct] = []
    for chunk in chunks:
        dense = embed_dense_document(chunk.text)
        sparse_indices, sparse_values = embed_sparse(chunk.text)

        points.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector={
                    "dense": dense,
                    "sparse": SparseVector(
                        indices=sparse_indices,
                        values=sparse_values,
                    ),
                },
                payload={
                    "text": chunk.text,
                    "volume": chunk.volume,
                    "chunk_index": chunk.chunk_index,
                },
            )
        )

    client.upsert(collection_name=collection_name, points=points)
