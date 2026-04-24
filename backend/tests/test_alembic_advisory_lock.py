"""Alembic advisory lock 단위 테스트. DB 없이 환경변수/분기만 검증.

실 DB 경합 시나리오는 수동 실측 (docs/dev-log/26-alembic-advisory-lock-poc.md 참조).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.alembic_support.advisory_lock import (
    _bool_env,
    _current_db_head,
    _handle_miss,
    _int_env,
    is_enabled,
)


class TestBoolEnv:
    def test_unset_returns_default(self, monkeypatch):
        monkeypatch.delenv("FOO_BOOL", raising=False)
        assert _bool_env("FOO_BOOL") is False
        assert _bool_env("FOO_BOOL", default=True) is True

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("true", True),
            ("TRUE", True),
            ("1", True),
            ("yes", True),
            ("on", True),
            ("false", False),
            ("0", False),
            ("", False),
            ("  true  ", True),
        ],
    )
    def test_parses(self, monkeypatch, raw, expected):
        monkeypatch.setenv("FOO_BOOL", raw)
        assert _bool_env("FOO_BOOL") is expected


class TestIntEnv:
    def test_unset_returns_default(self, monkeypatch):
        monkeypatch.delenv("FOO_INT", raising=False)
        assert _int_env("FOO_INT", 42) == 42

    def test_parses_integer(self, monkeypatch):
        monkeypatch.setenv("FOO_INT", "99")
        assert _int_env("FOO_INT", 42) == 99

    def test_invalid_falls_back(self, monkeypatch):
        monkeypatch.setenv("FOO_INT", "not-a-number")
        assert _int_env("FOO_INT", 42) == 42


class TestIsEnabled:
    def test_off_by_default(self, monkeypatch):
        monkeypatch.delenv("ALEMBIC_USE_ADVISORY_LOCK", raising=False)
        assert is_enabled() is False

    def test_true_enables(self, monkeypatch):
        monkeypatch.setenv("ALEMBIC_USE_ADVISORY_LOCK", "true")
        assert is_enabled() is True


class TestHandleMiss:
    def test_raises_when_skip_disabled(self, monkeypatch):
        monkeypatch.delenv("ALEMBIC_SKIP_IF_LOCKED", raising=False)
        conn = MagicMock()
        with pytest.raises(RuntimeError, match="Failed to acquire"):
            _handle_miss(conn, 10)

    def test_warns_without_expected(self, monkeypatch, capsys):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
        conn = MagicMock()
        _handle_miss(conn, 10)  # 예외 없음
        assert "WARN" in capsys.readouterr().out

    def test_skips_when_head_matches(self, monkeypatch, capsys):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", "abc123")
        conn = MagicMock()
        row = MagicMock()
        row.__getitem__.side_effect = lambda i: "abc123" if i == 0 else None
        result = MagicMock()
        result.first.return_value = row
        conn.execute.return_value = result

        _handle_miss(conn, 10)  # 예외 없음
        assert "skipping" in capsys.readouterr().out

    def test_raises_on_head_mismatch(self, monkeypatch):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", "abc123")
        conn = MagicMock()
        row = MagicMock()
        row.__getitem__.side_effect = lambda i: "xyz999" if i == 0 else None
        result = MagicMock()
        result.first.return_value = row
        conn.execute.return_value = result

        with pytest.raises(RuntimeError, match="DB head="):
            _handle_miss(conn, 10)


class TestCurrentDbHead:
    def test_returns_none_on_error(self):
        conn = MagicMock()
        conn.execute.side_effect = Exception("alembic_version table not found")
        assert _current_db_head(conn) is None

    def test_returns_version_when_present(self):
        conn = MagicMock()
        row = MagicMock()
        row.__getitem__.side_effect = lambda i: "abc123" if i == 0 else None
        result = MagicMock()
        result.first.return_value = row
        conn.execute.return_value = result
        assert _current_db_head(conn) == "abc123"

    def test_returns_none_when_empty(self):
        conn = MagicMock()
        result = MagicMock()
        result.first.return_value = None
        conn.execute.return_value = result
        assert _current_db_head(conn) is None
