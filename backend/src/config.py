from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 환경 구분
    environment: str = "development"  # development | staging | production

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

    # Admin Frontend (CORS)
    admin_frontend_url: str = "http://localhost:3000"

    # Cookie 보안 (운영 환경에서 True)
    cookie_secure: bool = False

    # Safety 설정
    safety_max_query_length: int = 1000
    rate_limit_max_requests: int = 20
    rate_limit_window_seconds: int = 60

    # Semantic Cache 설정
    cache_collection_name: str = "semantic_cache"
    cache_threshold: float = 0.93
    cache_ttl_days: int = 7

    # Cascading search 기본값
    cascade_score_threshold: float = 0.75
    cascade_fallback_threshold: float = 0.60
    cascade_min_results: int = 3

    model_config = {"env_file": ".env"}

    @model_validator(mode="after")
    def validate_production(self):
        """프로덕션 환경에서 보안 필수값 검증."""
        if self.environment == "production":
            if self.admin_jwt_secret.get_secret_value() == "change-me-in-production":
                raise ValueError("ADMIN_JWT_SECRET must be changed in production")
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be True in production")
        return self


settings = Settings()
