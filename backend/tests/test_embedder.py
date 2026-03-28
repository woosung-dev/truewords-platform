from unittest.mock import patch, MagicMock
from src.pipeline.embedder import embed_dense_document, embed_dense_query, embed_sparse


def _make_embed_response(values: list[float]) -> MagicMock:
    embedding = MagicMock()
    embedding.values = values
    response = MagicMock()
    response.embeddings = [embedding]
    return response


def test_embed_dense_document_returns_3072_floats():
    mock_response = _make_embed_response([0.1] * 3072)
    with patch("src.pipeline.embedder._client") as mock_client:
        mock_client.models.embed_content.return_value = mock_response
        result = embed_dense_document("테스트 텍스트")

    assert len(result) == 3072
    assert all(isinstance(v, float) for v in result)


def test_embed_dense_document_uses_retrieval_document_task():
    mock_response = _make_embed_response([0.0] * 3072)
    with patch("src.pipeline.embedder._client") as mock_client:
        mock_client.models.embed_content.return_value = mock_response
        embed_dense_document("텍스트")

    _, kwargs = mock_client.models.embed_content.call_args
    assert kwargs["config"].task_type == "RETRIEVAL_DOCUMENT"


def test_embed_dense_query_uses_retrieval_query_task():
    mock_response = _make_embed_response([0.0] * 3072)
    with patch("src.pipeline.embedder._client") as mock_client:
        mock_client.models.embed_content.return_value = mock_response
        embed_dense_query("질문")

    _, kwargs = mock_client.models.embed_content.call_args
    assert kwargs["config"].task_type == "RETRIEVAL_QUERY"


def test_embed_sparse_returns_indices_and_values():
    mock_sparse = MagicMock()
    mock_sparse.indices.tolist.return_value = [1, 5, 10]
    mock_sparse.values.tolist.return_value = [0.5, 0.3, 0.8]

    with patch("src.pipeline.embedder.get_sparse_model") as mock_get:
        mock_model = MagicMock()
        mock_model.embed.return_value = iter([mock_sparse])
        mock_get.return_value = mock_model

        indices, values = embed_sparse("텍스트")

    assert indices == [1, 5, 10]
    assert values == [0.5, 0.3, 0.8]
