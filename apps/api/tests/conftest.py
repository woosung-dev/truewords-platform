"""테스트 공통 픽스처."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture(autouse=True)
def _empty_featured_malssum(monkeypatch):
    """테스트는 말씀 풀을 빈 목록으로 고정 — featured_malssum.json 이 로컬에서
    채워져 있어도 pick_malssum_for_answer 가 실제 LLM 을 호출하지 않게 한다.
    말씀 자체를 검증하는 테스트는 각자 monkeypatch 로 _items 를 덮어쓴다(우선)."""
    import app.modules.malssum.service as _malssum

    monkeypatch.setattr(_malssum, "_items", [])


@pytest.fixture(autouse=True)
def _demo_admin_gate(monkeypatch):
    """시연 관리자 게이트(env DEMO_ADMIN_EMAIL)를 테스트 고정값으로 맞춘다.
    게이트를 통과해야 하는 테스트는 current_admin 의 email 을 이 값으로 둔다.
    미설정·불일치 동작을 검증하는 테스트는 각자 monkeypatch 로 덮어쓴다(우선)."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "demo_admin_email", "demo-admin@example.com")


@pytest.fixture(autouse=True)
def _reset_cache_cooldown():
    """`app.modules.chat.dependencies._cache_last_failure_monotonic` 은 모듈 전역이라
    캐시 lazy init 실패를 유발한 테스트의 타임스탬프가 다음 테스트로 새어나간다.
    쿨다운(5분)이 남아 있는 것처럼 보여 재시도 분기가 엉뚱하게 갈린다.
    각 테스트 전후로 미시도 상태(None)로 되돌린다."""
    import app.modules.chat.dependencies as _deps

    _deps._cache_last_failure_monotonic = None
    yield
    _deps._cache_last_failure_monotonic = None


@pytest.fixture
def mock_qdrant():
    """비동기 Qdrant 클라이언트 목."""
    client = AsyncMock()
    client.query_points = AsyncMock()
    return client
