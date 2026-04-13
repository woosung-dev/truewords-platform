"""ChatbotService weighted config 파싱 테스트."""

import pytest
from src.chatbot.service import ChatbotService
from src.search.cascading import CascadingConfig
from src.search.weighted import WeightedConfig


class TestParseSearchConfig:

    def test_weighted_mode(self):
        """search_mode=weighted → WeightedConfig."""
        data = {
            "search_mode": "weighted",
            "weighted_sources": [
                {"source": "A", "weight": 5, "score_threshold": 0.1},
                {"source": "B", "weight": 3, "score_threshold": 0.08},
            ],
        }
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, WeightedConfig)
        assert len(config.sources) == 2
        assert config.sources[0].source == "A"
        assert config.sources[0].weight == 5
        assert config.sources[1].score_threshold == 0.08

    def test_cascading_mode_default(self):
        """search_mode 미지정 → CascadingConfig (하위 호환)."""
        data = {
            "tiers": [{"sources": ["A"], "min_results": 3, "score_threshold": 0.1}],
        }
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, CascadingConfig)
        assert len(config.tiers) == 1
        assert config.tiers[0].sources == ["A"]

    def test_explicit_cascading_mode(self):
        """search_mode=cascading → CascadingConfig."""
        data = {
            "search_mode": "cascading",
            "tiers": [{"sources": ["A", "B"], "min_results": 5, "score_threshold": 0.15}],
        }
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, CascadingConfig)

    def test_invalid_mode_fallback(self):
        """잘못된 mode → CascadingConfig fallback."""
        data = {"search_mode": "invalid_mode", "tiers": []}
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, CascadingConfig)

    def test_weighted_empty_sources(self):
        """weighted mode with empty sources."""
        data = {"search_mode": "weighted", "weighted_sources": []}
        config = ChatbotService._parse_search_config(data)
        assert isinstance(config, WeightedConfig)
        assert len(config.sources) == 0
