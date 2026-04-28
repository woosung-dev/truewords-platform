"""ChatbotConfig.collection_main 필드 검증."""
from __future__ import annotations

from src.chatbot.models import ChatbotConfig


def test_collection_main_defaults_to_malssum_poc() -> None:
    cfg = ChatbotConfig(chatbot_id="t", display_name="t")
    assert cfg.collection_main == "malssum_poc"


def test_collection_main_can_be_set_to_v2() -> None:
    cfg = ChatbotConfig(
        chatbot_id="t", display_name="t",
        collection_main="malssum_poc_v2",
    )
    assert cfg.collection_main == "malssum_poc_v2"
