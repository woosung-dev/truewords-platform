from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 환경 구분
    environment: str = "development"  # development | production

    # AI
    gemini_api_key: SecretStr

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    qdrant_api_key: SecretStr | None = None
    # Phase 2.4 (dev-log 51) — 운영 청킹은 Recursive(v5, langchain RecursiveCharacterTextSplitter 700/150)
    collection_name: str = "malssum_poc_v5"

    # PostgreSQL
    database_url: SecretStr = SecretStr(
        "postgresql+asyncpg://truewords:truewords@localhost:5432/truewords"
    )

    # Admin JWT
    admin_jwt_secret: SecretStr = SecretStr("change-me-in-production")
    admin_jwt_algorithm: str = "HS256"
    admin_jwt_expire_minutes: int = 60 * 24  # 24시간

    # 훈독 일반 사용자 JWT (쿠키 hoondok_token, aud="hoondok"). 서명 키는 admin 과 공유하고 aud 로 분리한다.
    hoondok_jwt_expire_minutes: int = 60 * 24 * 7  # 7일 (PLAN-HD-001 §10, 2026-09-16)
    # 훈독 제한 베타 게이트 (PLAN-HD-001 Phase 3 F). 설정되면 POST /hoondok/auth/signup 이 같은 invite_code 를 요구한다.
    # 미설정·빈 값 = 게이트 OFF(로컬·E2E 기존 동작). 운영 값은 VM .env 에만 둔다. 로그인·기존 계정은 무관.
    hoondok_invite_code: SecretStr | None = None

    # 훈독 Web Push (PLAN-HD-006). 3값이 모두 있어야 구독이 열린다 — 하나라도 비면 기능 OFF(구독 409 PUSH_DISABLED).
    # 공개 키만 클라이언트에 내려간다(API-HD-019). 비밀 키·subject 는 발송기(sub-PR B)만 쓴다.
    hoondok_vapid_public_key: str | None = None  # base64url (uncompressed P-256)
    hoondok_vapid_private_key: SecretStr | None = None
    hoondok_vapid_subject: str | None = None  # "mailto:..." 또는 https URL

    # 훈독 "함께 읽는 사람들" 1단계 익명 숫자 (PLAN-HD-009, API-HD-029).
    # 오늘 훈독하기 완료자가 이 수 미만이면 숫자를 내려보내지 않는다(count=null). 캐시 0 = 매 요청 집계(테스트용).
    hoondok_together_min_count: int = 10
    hoondok_together_cache_seconds: float = 60.0

    # 훈독 AI 낭독 목소리 (PLAN-HD-011). Google Cloud Text-to-Speech(Chirp 3 HD) API 키가 없으면 기능 OFF —
    # 음성 API 는 503 TTS_DISABLED, 클라이언트는 브라우저 음성으로 돌아간다. 키는 VM .env 에만 둔다.
    google_tts_api_key: SecretStr | None = None
    # 달(America/Los_Angeles — Google 청구 달)마다 새로 합성하는 글자 수 상한. Chirp 3 HD 무료 한도 100만 자의 90%.
    # 캐시 적중은 세지 않는다.
    hoondok_tts_monthly_char_limit: int = 900_000
    # 사용자 한 명이 최근 24시간에 새로 합성할 수 있는 글자 수. 한 계정이 이번 달 몫을 다 쓰지 못하게 한다.
    # [가정] 3만 자 ≈ 원문 구간 15~20개. 넘으면 429 TTS_USER_LIMIT_EXCEEDED, 클라이언트는 기기 음성으로 읽는다.
    hoondok_tts_user_daily_char_limit: int = 30_000
    # 합성한 단락 mp3 저장 위치. 운영은 컨테이너 밖 볼륨으로 마운트한다(infra/oracle-vm/README.md).
    hoondok_tts_cache_dir: str = "var/hoondok-tts"

    def is_hoondok_tts_enabled(self) -> bool:
        key = self.google_tts_api_key
        return bool(key and key.get_secret_value().strip())

    def is_hoondok_push_enabled(self) -> bool:
        """VAPID 3값이 모두 설정되고 공백이 아닐 때만 True. 미설정이면 구독 API 가 열리지 않는다."""
        private = self.hoondok_vapid_private_key
        return bool(
            (self.hoondok_vapid_public_key or "").strip()
            and (private.get_secret_value().strip() if private else "")
            and (self.hoondok_vapid_subject or "").strip()
        )

    # ponytail: 레드팀 시연 한시 관리자 게이트 — admin API 를 허용할 단 하나의 계정 이메일.
    # 시연 종료 후 AdminRole 기반 권한으로 교체/삭제. 코드에 개인 이메일을 두지 않으려고
    # env(DEMO_ADMIN_EMAIL)로 받는다. 비어 있으면 아무도 게이트를 통과하지 못한다 —
    # admin API 전부 403, 채팅은 영향 없음. 운영 VM .env 에 반드시 설정한다.
    demo_admin_email: str = ""

    # 독립 web/admin origin (CORS). 쿠키의 host 범위는 포트로 분리되지 않는다.
    admin_frontend_url: str = "http://localhost:3001"
    web_frontend_url: str = "http://localhost:3000"

    # Cookie 보안 (운영 환경에서 True)
    cookie_secure: bool = False

    # Safety 설정
    safety_max_query_length: int = 1000
    rate_limit_max_requests: int = 20
    rate_limit_window_seconds: int = 60

    # Gemini hard timeout (audit 2차 S-4, 2026-05-15)
    # 동시 요청 시 Gemini 무한 대기로 인한 Cloud Run concurrency 잠김 차단.
    # generate_text: 단발 호출 — 일반 5~15초 latency, 30초 cutoff.
    # generate_text_stream: 전체 stream 누적 — 일반 10~30초, 60초 cutoff.
    gemini_generate_timeout_seconds: float = 30.0
    gemini_stream_timeout_seconds: float = 60.0

    # Semantic Cache 설정
    cache_collection_name: str = "semantic_cache"
    cache_threshold: float = 0.88
    cache_ttl_days: int = 7

    # 임베딩 파이프라인
    # GEMINI_TIER 하나로 무료/유료 전환. 개별 override도 가능.
    #   embed_max_chars_per_batch → TPM 방어 (분당 토큰)
    #   embed_batch_sleep         → RPM 방어 (분당 요청)
    gemini_tier: str = "free"  # free | paid

    # 개별 override용 (설정하지 않으면 gemini_tier 프리셋 적용)
    embed_max_chars_per_batch: int | None = None
    embed_batch_sleep: float | None = None

    # audit 2차 P-5 (2026-05-15, Agent B P1 5/10): dict literal → SettingsConfigDict
    # pydantic_settings 권장 패턴. mypy/IDE 타입 힌트 작동 + future-proof.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

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
