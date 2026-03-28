from unittest.mock import patch, MagicMock
from src.pipeline.embedder import embed_dense_document, embed_dense_query, embed_sparse


def test_embed_dense_document_returns_768_floats():
    mock_result = {"embedding": [0.1] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result):
        result = embed_dense_document("테스트 텍스트")

    assert len(result) == 768
    assert all(isinstance(v, float) for v in result)


def test_embed_dense_document_uses_retrieval_document_task():
    mock_result = {"embedding": [0.0] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result) as mock_embed:
        embed_dense_document("텍스트")

    _, kwargs = mock_embed.call_args
    assert kwargs.get("task_type") == "RETRIEVAL_DOCUMENT"


def test_embed_dense_query_uses_retrieval_query_task():
    mock_result = {"embedding": [0.0] * 768}
    with patch("src.pipeline.embedder.genai.embed_content", return_value=mock_result) as mock_embed:
        embed_dense_query("질문")

    _, kwargs = mock_embed.call_args
    assert kwargs.get("task_type") == "RETRIEVAL_QUERY"


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
