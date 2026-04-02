from src.search.cascading import CascadingConfig, SearchTier

DEFAULT_CONFIG = CascadingConfig(
    tiers=[
        SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60),
    ]
)

_CHATBOT_REGISTRY: dict[str, CascadingConfig] = {
    "malssum_priority": CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=3, score_threshold=0.75),
            SearchTier(sources=["B"], min_results=2, score_threshold=0.65),
            SearchTier(sources=["C"], min_results=1, score_threshold=0.60),
        ]
    ),
    "all": CascadingConfig(
        tiers=[
            SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.60),
        ]
    ),
    "source_a_only": CascadingConfig(
        tiers=[
            SearchTier(sources=["A"], min_results=1, score_threshold=0.50),
        ]
    ),
    "source_b_only": CascadingConfig(
        tiers=[
            SearchTier(sources=["B"], min_results=1, score_threshold=0.50),
        ]
    ),
}


def get_chatbot_config(chatbot_id: str | None) -> CascadingConfig:
    if chatbot_id is None:
        return DEFAULT_CONFIG
    return _CHATBOT_REGISTRY.get(chatbot_id, DEFAULT_CONFIG)


def list_chatbot_ids() -> list[str]:
    return list(_CHATBOT_REGISTRY.keys())
