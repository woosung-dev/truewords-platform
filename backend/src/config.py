from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "malssum_poc"

    model_config = {"env_file": ".env"}


settings = Settings()
