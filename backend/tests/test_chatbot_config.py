from src.chatbot.configs import get_chatbot_config, list_chatbot_ids, DEFAULT_CONFIG
from src.search.cascading import CascadingConfig, SearchTier


def test_get_default_config():
    config = get_chatbot_config(None)
    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) >= 1


def test_get_known_chatbot_config():
    config = get_chatbot_config("malssum_priority")
    assert isinstance(config, CascadingConfig)
    assert len(config.tiers) >= 2
    assert "A" in config.tiers[0].sources


def test_get_unknown_chatbot_returns_default():
    config = get_chatbot_config("nonexistent_bot")
    assert config == DEFAULT_CONFIG


def test_list_chatbot_ids_returns_list():
    ids = list_chatbot_ids()
    assert isinstance(ids, list)
    assert "malssum_priority" in ids
    assert "all" in ids


def test_all_config_searches_all_sources():
    config = get_chatbot_config("all")
    all_sources = []
    for tier in config.tiers:
        all_sources.extend(tier.sources)
    assert "A" in all_sources
    assert "B" in all_sources
    assert "C" in all_sources
