import pytest
from unittest.mock import MagicMock


@pytest.fixture
def mock_qdrant():
    return MagicMock()
