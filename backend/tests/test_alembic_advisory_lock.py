"""Alembic advisory lock + expected-head + _is_ancestor 단위 테스트.

설계:
- §19.11 O-5: pg_try_advisory_lock + timeout + ALEMBIC_SKIP_IF_LOCKED
- §21.8 B4: skip 전 DB head 검증 (ALEMBIC_EXPECTED_HEAD)
- §22.7 N4: expected head 빌드 artifact fallback + ancestor 기반 rollback 허용

실 DB 경합 시나리오는 수동 실측 (docs/dev-log/26-alembic-advisory-lock-poc.md 참조).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from src.alembic_support import advisory_lock
from src.alembic_support.advisory_lock import (
    _bool_env,
    _current_db_head,
    _expected_head,
    _handle_miss,
    _int_env,
    _is_ancestor,
    is_enabled,
)


# ============================================================
# Env parsing
# ============================================================
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


# ============================================================
# _expected_head (env → file fallback) — §22.7 N4
# ============================================================
class TestExpectedHead:
    def test_env_takes_precedence(self, monkeypatch, tmp_path):
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", "env_value")
        f = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        f.write_text("file_value\n")
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(f),)
        )
        assert _expected_head() == "env_value"

    def test_file_fallback_when_env_unset(self, monkeypatch, tmp_path):
        monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
        f = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        f.write_text("file_value\n")
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(f),)
        )
        assert _expected_head() == "file_value"

    def test_file_fallback_when_env_blank(self, monkeypatch, tmp_path):
        """env 값이 빈 문자열/공백 이면 파일 fallback 진입."""
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", "   ")
        f = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        f.write_text("file_value")
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(f),)
        )
        assert _expected_head() == "file_value"

    def test_file_extracts_first_token(self, monkeypatch, tmp_path):
        """alembic heads 출력이 'rev_id (head)' 형식이어도 첫 토큰만 취함."""
        monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
        f = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        f.write_text("abc123 (head)\n")
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(f),)
        )
        assert _expected_head() == "abc123"

    def test_empty_when_neither_available(self, monkeypatch, tmp_path):
        monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
        nonexistent = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(nonexistent),)
        )
        assert _expected_head() == ""

    def test_skips_empty_file_content(self, monkeypatch, tmp_path):
        monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
        f = tmp_path / "ALEMBIC_EXPECTED_HEAD"
        f.write_text("   \n")
        monkeypatch.setattr(
            advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", (str(f),)
        )
        assert _expected_head() == ""


# ============================================================
# _is_ancestor — §22.7 N4 rollback 호환
# ============================================================
# 실 alembic script 사용 (backend/alembic/versions/)
# 현재 revision graph (2026-04-25 기준, 가장 오래된 → 최신):
#   4019bf278be0 (initial schema)
#   84b935925eaa (add system_prompt and persona_name to chatbot_configs)
#   1ee1295dc7f4 (add data_source_categories table)
#   856b04b1fb71 (add rewritten_query to search_events)
#   8060cfb6e88c (add batch_jobs table)
#   7a344c99c625 (add ingestion_jobs table)  ← HEAD
REV_INIT = "4019bf278be0"
REV_MID = "1ee1295dc7f4"
REV_HEAD = "7a344c99c625"


class TestIsAncestor:
    def test_same_revision_is_ancestor(self):
        assert _is_ancestor(REV_HEAD, REV_HEAD) is True

    def test_direct_ancestor_returns_true(self):
        assert _is_ancestor(REV_MID, REV_HEAD) is True

    def test_root_is_ancestor_of_head(self):
        assert _is_ancestor(REV_INIT, REV_HEAD) is True

    def test_descendant_returns_false(self):
        """HEAD 는 INIT 의 조상이 아닌 descendant."""
        assert _is_ancestor(REV_HEAD, REV_INIT) is False

    def test_unknown_expected_returns_false(self):
        assert _is_ancestor("deadbeef123", REV_HEAD) is False

    def test_unknown_current_returns_false(self):
        assert _is_ancestor(REV_HEAD, "deadbeef123") is False

    def test_empty_expected_returns_false(self):
        assert _is_ancestor("", REV_HEAD) is False

    def test_empty_current_returns_false(self):
        assert _is_ancestor(REV_HEAD, "") is False

    def test_both_empty_returns_false(self):
        assert _is_ancestor("", "") is False


# ============================================================
# _handle_miss 분기
# ============================================================
def _mock_conn_returning_head(head_value: str | None) -> MagicMock:
    """alembic_version 조회 시 주어진 head_value 를 반환하는 mock connection."""
    conn = MagicMock()
    result = MagicMock()
    if head_value is None:
        result.first.return_value = None
    else:
        row = MagicMock()
        row.__getitem__.side_effect = lambda i: head_value if i == 0 else None
        result.first.return_value = row
    conn.execute.return_value = result
    return conn


def _clean_head_env(monkeypatch):
    """expected head 관련 env/file fallback 모두 초기화."""
    monkeypatch.delenv("ALEMBIC_EXPECTED_HEAD", raising=False)
    monkeypatch.setattr(advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", ())


class TestHandleMissBasic:
    def test_raises_when_skip_disabled(self, monkeypatch):
        monkeypatch.delenv("ALEMBIC_SKIP_IF_LOCKED", raising=False)
        _clean_head_env(monkeypatch)
        conn = _mock_conn_returning_head(None)
        with pytest.raises(RuntimeError, match="Failed to acquire"):
            _handle_miss(conn, 10)

    def test_warns_without_expected(self, monkeypatch, capsys):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        _clean_head_env(monkeypatch)
        conn = _mock_conn_returning_head(None)
        _handle_miss(conn, 10)
        assert "WARN" in capsys.readouterr().out

    def test_skips_when_head_matches_env(self, monkeypatch, capsys):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", REV_HEAD)
        monkeypatch.setattr(advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", ())
        conn = _mock_conn_returning_head(REV_HEAD)
        _handle_miss(conn, 10)
        out = capsys.readouterr().out
        assert "matches" in out
        assert REV_HEAD in out


class TestHandleMissAncestor:
    """§22.7 N4 rollback 호환 — expected 가 current 의 조상이면 skip."""

    def test_skips_on_ancestor(self, monkeypatch, capsys):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", REV_MID)
        monkeypatch.setattr(advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", ())
        conn = _mock_conn_returning_head(REV_HEAD)  # DB 가 앞서 있음
        _handle_miss(conn, 10)
        out = capsys.readouterr().out
        assert "ancestor" in out.lower() or "rollback" in out.lower()
        assert REV_MID in out
        assert REV_HEAD in out

    def test_raises_on_unrelated_head(self, monkeypatch):
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", "deadbeef_unknown_revision")
        monkeypatch.setattr(advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", ())
        conn = _mock_conn_returning_head(REV_HEAD)
        with pytest.raises(RuntimeError, match="Cannot skip migration"):
            _handle_miss(conn, 10)

    def test_raises_on_descendant(self, monkeypatch):
        """expected 가 current 의 descendant 면 (구 DB + 신 image) → RuntimeError.

        신 image 가 요구하는 head 가 DB 보다 앞서 있다는 의미. migration 필요한데
        lock 못 얻었으므로 skip 할 수 없음.
        """
        monkeypatch.setenv("ALEMBIC_SKIP_IF_LOCKED", "true")
        monkeypatch.setenv("ALEMBIC_EXPECTED_HEAD", REV_HEAD)
        monkeypatch.setattr(advisory_lock, "DEFAULT_EXPECTED_HEAD_FILES", ())
        conn = _mock_conn_returning_head(REV_MID)  # DB 가 뒤에 있음
        with pytest.raises(RuntimeError, match="Cannot skip migration"):
            _handle_miss(conn, 10)


# ============================================================
# _current_db_head
# ============================================================
class TestCurrentDbHead:
    def test_returns_none_on_error(self):
        conn = MagicMock()
        conn.execute.side_effect = Exception("alembic_version table not found")
        assert _current_db_head(conn) is None

    def test_returns_version_when_present(self):
        conn = _mock_conn_returning_head("abc123")
        assert _current_db_head(conn) == "abc123"

    def test_returns_none_when_empty(self):
        conn = _mock_conn_returning_head(None)
        assert _current_db_head(conn) is None
