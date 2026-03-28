from unittest.mock import MagicMock
from src.qdrant_client import create_collection


def test_create_collection_uses_dense_and_sparse_vectors():
    mock_client = MagicMock()
    create_collection(mock_client, "test_collection")

    mock_client.create_collection.assert_called_once()
    call_kwargs = mock_client.create_collection.call_args.kwargs

    assert call_kwargs["collection_name"] == "test_collection"
    assert "dense" in call_kwargs["vectors_config"]
    assert "sparse" in call_kwargs["sparse_vectors_config"]
    assert call_kwargs["vectors_config"]["dense"].size == 3072
