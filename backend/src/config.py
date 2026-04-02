from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "malssum_poc"

    # Cascading search 기본값
    cascade_score_threshold: float = 0.75
    cascade_fallback_threshold: float = 0.60
    cascade_min_results: int = 3

    model_config = {"env_file": ".env"}


settings = Settings()
