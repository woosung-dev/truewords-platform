"""ingestor 단위 테스트 — raw httpx (PR-E) 전환 후.

``_sync_upsert`` 를 patch 해서 호출 여부와 dict 형태 points 검증.
SDK PointStruct/SparseVector 의존성 제거됨.
"""

from unittest.mock import patch
from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import ingest_chunks


def _patch_io(upsert_calls: list):
    """공통 patch 헬퍼: _sync_upsert 호출 캡처."""

    def fake_upsert(collection_name, points):
        upsert_calls.append({"collection_name": collection_name, "points": points})

    return patch("src.pipeline.ingestor._sync_upsert", side_effect=fake_upsert)


def test_ingest_calls_upsert_with_correct_payload():
    upsert_calls: list = []
    chunks = [
        Chunk(text="말씀 내용입니다.", volume="vol_001", chunk_index=0),
        Chunk(text="두 번째 말씀입니다.", volume="vol_001", chunk_index=1),
    ]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 2),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])] * 2),
    ):
        ingest_chunks("test_collection", chunks)

    assert len(upsert_calls) == 1
    assert upsert_calls[0]["collection_name"] == "test_collection"
    points = upsert_calls[0]["points"]
    assert len(points) == 2


def test_ingest_payload_contains_text_and_volume():
    upsert_calls: list = []
    chunks = [Chunk(text="참부모님 말씀.", volume="vol_005", chunk_index=0)]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.0] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([0], [1.0])]),
    ):
        ingest_chunks("test_collection", chunks)

    payload = upsert_calls[0]["points"][0]["payload"]
    assert payload["text"] == "참부모님 말씀."
    assert payload["volume"] == "vol_005"
    assert payload["chunk_index"] == 0


def test_empty_chunks_does_not_call_upsert():
    upsert_calls: list = []
    with _patch_io(upsert_calls):
        ingest_chunks("test_collection", [])
    assert upsert_calls == []


def test_ingest_payload_includes_source():
    upsert_calls: list = []
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0, source="A")]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])]),
    ):
        ingest_chunks("test_collection", chunks)

    assert upsert_calls[0]["points"][0]["payload"]["source"] == ["A"]


def test_ingest_payload_source_default_empty():
    upsert_calls: list = []
    chunks = [Chunk(text="테스트 말씀", volume="vol_001", chunk_index=0)]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1, 2], [0.5, 0.3])]),
    ):
        ingest_chunks("test_collection", chunks)

    assert upsert_calls[0]["points"][0]["payload"]["source"] == []


def test_ingest_payload_includes_title_and_date():
    """payload에 title, date 필드가 포함되어야 함."""
    upsert_calls: list = []
    chunks = [Chunk(text="말씀", volume="vol_001", chunk_index=0, title="창조원리", date="1966.5.1")]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks("test_collection", chunks)

    payload = upsert_calls[0]["points"][0]["payload"]
    assert payload["title"] == "창조원리"
    assert payload["date"] == "1966.5.1"


def test_ingest_resumes_from_start_chunk():
    """start_chunk 이후 청크만 적재됨."""
    upsert_calls: list = []
    chunks = [Chunk(text=f"청크 {i}", volume="vol_001", chunk_index=i) for i in range(5)]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 3),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])] * 3),
    ):
        result = ingest_chunks("test_collection", chunks, start_chunk=2)

    assert result["chunk_count"] == 3
    points = upsert_calls[0]["points"]
    assert len(points) == 3
    indices = [p["payload"]["chunk_index"] for p in points]
    assert indices == [2, 3, 4]


def test_ingest_start_chunk_beyond_total_returns_zero():
    """start_chunk >= total이면 빈 결과 반환."""
    upsert_calls: list = []
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0)]

    with _patch_io(upsert_calls):
        result = ingest_chunks("test_collection", chunks, start_chunk=5)
    assert result["chunk_count"] == 0
    assert upsert_calls == []


def test_ingest_passes_title_to_embed_dense_batch():
    """title 파라미터가 embed_dense_batch로 전달됨."""
    upsert_calls: list = []
    chunks = [Chunk(text="말씀", volume="vol_001", chunk_index=0, title="창조원리")]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]) as mock_embed,
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks("test_collection", chunks, title="창조원리")

    call_args = mock_embed.call_args
    assert call_args.kwargs.get("title") == "창조원리" or (
        len(call_args.args) > 1 and call_args.args[1] == "창조원리"
    )


# ---------------------------------------------------------------------------
# ADR-30: payload_sources (재업로드 merge/replace 정책 지원)
# ---------------------------------------------------------------------------


def test_payload_sources_overrides_chunk_source():
    """payload_sources를 명시하면 chunk.source 값을 무시하고 그 리스트로 통일."""
    upsert_calls: list = []
    chunks = [
        Chunk(text="청크1", volume="vol_001", chunk_index=0, source="A"),
        Chunk(text="청크2", volume="vol_001", chunk_index=1, source=["B"]),
    ]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536] * 2),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])] * 2),
    ):
        ingest_chunks(
            "test_collection",
            chunks,
            payload_sources=["A", "C"],
        )

    points = upsert_calls[0]["points"]
    assert points[0]["payload"]["source"] == ["A", "C"]
    assert points[1]["payload"]["source"] == ["A", "C"]


def test_payload_sources_none_keeps_chunk_source():
    """payload_sources=None(기본값)일 때 기존 chunk.source 동작이 유지됨."""
    upsert_calls: list = []
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0, source="A")]

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks("test_collection", chunks, payload_sources=None)

    assert upsert_calls[0]["points"][0]["payload"]["source"] == ["A"]


def test_payload_sources_empty_chunk_source_replaced_when_provided():
    """기존 source 비어있어도 payload_sources가 명시되면 그대로 적용 (merge 시나리오)."""
    upsert_calls: list = []
    chunks = [Chunk(text="청크", volume="vol_001", chunk_index=0)]  # source 미지정

    with (
        _patch_io(upsert_calls),
        patch("src.pipeline.ingestor.embed_dense_batch", return_value=[[0.1] * 1536]),
        patch("src.pipeline.ingestor.embed_sparse_batch", return_value=[([1], [0.5])]),
    ):
        ingest_chunks(
            "test_collection",
            chunks,
            payload_sources=["A", "B"],
        )

    # merge 모드에서 기존 ["A"] + 새 "B" → 모든 청크 ["A", "B"]
    assert upsert_calls[0]["points"][0]["payload"]["source"] == ["A", "B"]
