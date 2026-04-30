from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 환경 구분
    environment: str = "development"  # development | production

    # AI
    gemini_api_key: SecretStr

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: SecretStr | None = None
    # Phase 2.2 (dev-log 45/49) — 운영 청킹은 paragraph(v3)
    collection_name: str = "malssum_poc_v3"

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
    cache_threshold: float = 0.88
    cache_ttl_days: int = 7

    # Cascading search 기본값
    cascade_score_threshold: float = 0.75
    cascade_fallback_threshold: float = 0.60
    cascade_min_results: int = 3

    # 임베딩 파이프라인
    # GEMINI_TIER 하나로 무료/유료 전환. 개별 override도 가능.
    #   embed_max_chars_per_batch → TPM 방어 (분당 토큰)
    #   embed_batch_sleep         → RPM 방어 (분당 요청)
    gemini_tier: str = "free"  # free | paid

    # 개별 override용 (설정하지 않으면 gemini_tier 프리셋 적용)
    embed_max_chars_per_batch: int | None = None
    embed_batch_sleep: float | None = None

    model_config = {"env_file": ".env", "extra": "ignore"}

    @model_validator(mode="after")
    def apply_gemini_tier_presets(self):
        """GEMINI_TIER 프리셋 적용. 개별 환경변수가 설정되면 그 값을 우선 사용."""
        presets = {
            "free": {
                "embed_max_chars_per_batch": 31000,   # TPM 30K × 70%
                "embed_batch_sleep": 60.0,            # TPM 윈도우 리셋 대기
            },
            "paid": {
                "embed_max_chars_per_batch": 900000,  # TPM 1M (사실상 무제한)
                "embed_batch_sleep": 3.0,             # RPM 3K 여유
            },
        }
        tier = presets.get(self.gemini_tier, presets["free"])
        for key, default in tier.items():
            if getattr(self, key) is None:
                object.__setattr__(self, key, default)
        return self

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
