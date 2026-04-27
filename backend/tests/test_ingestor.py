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
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 2),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])] * 2),
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
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.0] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([0], [1.0])]),
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
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])]),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    points = mock_client.upsert.call_args.kwargs["points"]
    assert points[0].payload["source"] == ["A"]


def test_ingest_payload_source_default_empty():
    mock_client = MagicMock()
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0)]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])]),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    points = mock_client.upsert.call_args.kwargs["points"]
    assert points[0].payload["source"] == []


def test_ingest_payload_includes_title_and_date():
    """payload에 title, date 필드가 포함되어야 함."""
    mock_client = MagicMock()
    chunks = [Chunk(text="말씀", volume="vol_001", chunk_index=0, title="창조원리", date="1966.5.1")]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks(mock_client, "test_collection", chunks)

    points = mock_client.upsert.call_args.kwargs["points"]
    assert points[0].payload["title"] == "창조원리"
    assert points[0].payload["date"] == "1966.5.1"


def test_ingest_resumes_from_start_chunk():
    """start_chunk 이후 청크만 적재됨."""
    mock_client = MagicMock()
    chunks = [Chunk(text=f"청크 {i}", volume="vol_001", chunk_index=i) for i in range(5)]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 3),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])] * 3),
    ):
        result = ingest_chunks(mock_client, "test_collection", chunks, start_chunk=2)

    assert result["chunk_count"] == 3
    points = mock_client.upsert.call_args.kwargs["points"]
    assert len(points) == 3
    indices = [p.payload["chunk_index"] for p in points]
    assert indices == [2, 3, 4]


def test_ingest_start_chunk_beyond_total_returns_zero():
    """start_chunk >= total이면 빈 결과 반환."""
    mock_client = MagicMock()
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0)]

    result = ingest_chunks(mock_client, "test_collection", chunks, start_chunk=5)
    assert result["chunk_count"] == 0
    mock_client.upsert.assert_not_called()


def test_ingest_passes_title_to_embed_dense_batch():
    """title 파라미터가 embed_dense_batch로 전달됨."""
    mock_client = MagicMock()
    chunks = [Chunk(text="말씀", volume="vol_001", chunk_index=0, title="창조원리")]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]) as mock_embed,
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks(mock_client, "test_collection", chunks, title="창조원리")

    call_args = mock_embed.call_args
    assert call_args.kwargs.get("title") == "창조원리" or (
        len(call_args.args) > 1 and call_args.args[1] == "창조원리"
    )


# ---------------------------------------------------------------------------
# ADR-30: payload_sources (재업로드 merge/replace 정책 지원)
# ---------------------------------------------------------------------------


def test_payload_sources_overrides_chunk_source():
    """payload_sources를 명시하면 chunk.source 값을 무시하고 그 리스트로 통일."""
    mock_client = MagicMock()
    chunks = [
        Chunk(text="청크1", volume="vol_001", chunk_index=0, source="A"),
        Chunk(text="청크2", volume="vol_001", chunk_index=1, source=["B"]),
    ]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 2),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])] * 2),
    ):
        ingest_chunks(
            mock_client,
            "test_collection",
            chunks,
            payload_sources=["A", "C"],
        )

    points = mock_client.upsert.call_args.kwargs["points"]
    assert points[0].payload["source"] == ["A", "C"]
    assert points[1].payload["source"] == ["A", "C"]


def test_payload_sources_none_keeps_chunk_source():
    """payload_sources=None(기본값)일 때 기존 chunk.source 동작이 유지됨."""
    mock_client = MagicMock()
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0, source="A")]

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks(mock_client, "test_collection", chunks, payload_sources=None)

    points = mock_client.upsert.call_args.kwargs["points"]
    assert points[0].payload["source"] == ["A"]


def test_payload_sources_empty_chunk_source_replaced_when_provided():
    """기존 source 비어있어도 payload_sources가 명시되면 그대로 적용 (merge 시나리오)."""
    mock_client = MagicMock()
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0)]  # source 미지정

    with (
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks(
            mock_client,
            "test_collection",
            chunks,
            payload_sources=["A", "B"],
        )

    points = mock_client.upsert.call_args.kwargs["points"]
    # merge 모드에서 기존 ["A"] + 새 "B" → 모든 청크 ["A", "B"]
    assert points[0].payload["source"] == ["A", "B"]
