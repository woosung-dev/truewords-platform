from unittest.mock import MagicMock, patch
from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import ingest_chunks


def test_ingest_calls_upsert_with_correct_payload():
    mock_client = MagicMock()
    chunks = [
        Chunk(text="말씀 내용입니다.", volume="vol_001", chunk_index=0),
        Chunk(text="두 번째 말씀입니다.", volume="vol_001", chunk_index=1),
    ]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 768),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    mock_client.upsert.assert_called_once()
    call_kwargs = mock_client.upsert.call_args.kwargs
    assert call_kwargs["collection_name"] == "test_collection"
    points = call_kwargs["points"]
    assert len(points) == 2


def test_ingest_payload_contains_text_and_volume():
    mock_client = MagicMock()
    chunks = [Chunk(text="참부모님 말씀.", volume="vol_005", chunk_index=0)]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.0] * 768),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([0], [1.0])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    points = mock_client.upsert.call_args.kwargs["points"]
    payload = points[0].payload
    assert payload["text"] == "참부모님 말씀."
    assert payload["volume"] == "vol_005"
    assert payload["chunk_index"] == 0


def test_empty_chunks_does_not_call_upsert():
    mock_client = MagicMock()
    ingest_chunks(mock_client, "test_collection", [])
    mock_client.upsert.assert_not_called()


def test_ingest_payload_includes_source():
    mock_client = MagicMock()
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0, source="A")]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 3072),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    upsert_call = mock_client.upsert.call_args
    points = upsert_call.kwargs["points"]
    assert points[0].payload["source"] == "A"


def test_ingest_payload_source_default_empty():
    mock_client = MagicMock()
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0)]

    with (
        patch("src.pipeline.ingestor.embed_dense_document", return_value=[0.1] * 3072),
        patch("src.pipeline.ingestor.embed_sparse", return_value=([1, 2], [0.5, 0.3])),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    upsert_call = mock_client.upsert.call_args
    points = upsert_call.kwargs["points"]
    assert points[0].payload["source"] == ""
