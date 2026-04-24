"""Staging 환경 기반 Qdrant 컬렉션명 자동 접미사 validator 테스트.

설계 문서: docs/07_infra/staging-separation.md §5
대상 코드: backend/src/config.py :: Settings.apply_environment_suffix
"""

from __future__ import annotations

import pytest

from src.config import Settings


def _fresh_settings(monkeypatch, env: dict[str, str]) -> Settings:
    """.env 파일과 무관하게 명시 env 만 적용한 Settings 생성.

    - 관련 env를 명시 설정하거나 삭제
    - `_env_file=None` 으로 .env 로드 차단
    """
    # 혹시 테스트 실행 환경에 남아있을 수 있는 키들을 전부 clean
    for key in (
        "ENVIRONMENT",
        "COLLECTION_NAME",
        "CACHE_COLLECTION_NAME",
        "ADMIN_JWT_SECRET",
        "COOKIE_SECURE",
        "GEMINI_API_KEY",
        "GEMINI_TIER",
    ):
        monkeypatch.delenv(key, raising=False)

    for key, value in env.items():
        monkeypatch.setenv(key, value)

    return Settings(_env_file=None)


class TestEnvironmentSuffix:
    def test_development_keeps_defaults(self, monkeypatch):
        s = _fresh_settings(monkeypatch, {"GEMINI_API_KEY": "dummy"})
        assert s.environment == "development"
        assert s.collection_name == "malssum_poc"
        assert s.cache_collection_name == "semantic_cache"

    def test_production_keeps_defaults(self, monkeypatch):
        s = _fresh_settings(
            monkeypatch,
            {
                "GEMINI_API_KEY": "dummy",
                "ENVIRONMENT": "production",
                "ADMIN_JWT_SECRET": "real-secret-not-default",
                "COOKIE_SECURE": "true",
            },
        )
        assert s.environment == "production"
        assert s.collection_name == "malssum_poc"
        assert s.cache_collection_name == "semantic_cache"

    def test_staging_applies_suffix(self, monkeypatch):
        s = _fresh_settings(
            monkeypatch,
            {"GEMINI_API_KEY": "dummy", "ENVIRONMENT": "staging"},
        )
        assert s.environment == "staging"
        assert s.collection_name == "malssum_poc_staging"
        assert s.cache_collection_name == "semantic_cache_staging"

    def test_staging_respects_explicit_override(self, monkeypatch):
        """staging 이어도 COLLECTION_NAME 을 명시 설정하면 그대로 사용 (접미사 안 붙임)."""
        s = _fresh_settings(
            monkeypatch,
            {
                "GEMINI_API_KEY": "dummy",
                "ENVIRONMENT": "staging",
                "COLLECTION_NAME": "custom_collection",
                "CACHE_COLLECTION_NAME": "custom_cache",
            },
        )
        assert s.collection_name == "custom_collection"
        assert s.cache_collection_name == "custom_cache"

    def test_staging_mixed_default_and_override(self, monkeypatch):
        """한쪽만 명시하면 명시된 것은 그대로, 기본값 쪽은 접미사 부여."""
        s = _fresh_settings(
            monkeypatch,
            {
                "GEMINI_API_KEY": "dummy",
                "ENVIRONMENT": "staging",
                "COLLECTION_NAME": "custom_only",
            },
        )
        assert s.collection_name == "custom_only"
        assert s.cache_collection_name == "semantic_cache_staging"

    def test_arbitrary_environment_value_noop(self, monkeypatch):
        """알 수 없는 environment 값은 suffix 로직 건드리지 않음."""
        s = _fresh_settings(
            monkeypatch,
            {"GEMINI_API_KEY": "dummy", "ENVIRONMENT": "qa"},
        )
        assert s.environment == "qa"
        assert s.collection_name == "malssum_poc"
        assert s.cache_collection_name == "semantic_cache"
