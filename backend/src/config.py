from pydantic import SecretStr
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # AI
    gemini_api_key: SecretStr

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    collection_name: str = "malssum_poc"

    # PostgreSQL
    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://truewords:truewords@localhost:5432/truewords"
    )

    # Admin JWT
    admin_jwt_secret: SecretStr = SecretStr("change-me-in-production")
    admin_jwt_algorithm: str = "HS256"
    admin_jwt_expire_minutes: int = 60 * 24  # 24시간

    # Cascading search 기본값
    cascade_score_threshold: float = 0.75
    cascade_fallback_threshold: float = 0.60
    cascade_min_results: int = 3

    model_config = {"env_file": ".env"}


settings = Settings()
