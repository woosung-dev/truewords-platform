"""훈독 API-HD-010 월 기록 — month 패턴·연도 범위 422 · 월별 일수(윤년) · read 완료만 done · 기본 월 = 오늘 KST · 401."""

from __future__ import annotations

import uuid
from datetime import date
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.modules.admin.auth import create_access_token
from app.modules.hoondok.dependencies import get_mission_service
from app.modules.hoondok.service import MissionService
from app.modules.identity.dependencies import COOKIE_NAME, get_identity_repository
from app.modules.identity.models import User
from app.modules.identity.service import IdentityService

TODAY = date(2026, 9, 19)
PATH = "/hoondok/me/history"


class _Users:
    def __init__(self, user: User) -> None:
        self.user = user

    async def get_by_id(self, user_id):
        return self.user if user_id == self.user.id else None


class _Logs:
    def __init__(self) -> None:
        self.rows: set[tuple] = set()
        self.session = MagicMock()

    async def list_dates(self, user_id, kind):
        return sorted(d for u, d, k in self.rows if u == user_id and k == kind)


@pytest.fixture
def client():
    user = User(email="a@b.c", password_hash="x", display_name="효진")
    logs = _Logs()
    app.dependency_overrides[get_identity_repository] = lambda: _Users(user)
    # today 를 고정해 기본 월·미래 판정을 결정적으로 만든다
    app.dependency_overrides[get_mission_service] = lambda: MissionService(logs, today_fn=lambda: TODAY)
    try:
        c = TestClient(app)
        c.hoondok_user = user  # type: ignore[attr-defined]
        c.logs = logs  # type: ignore[attr-defined]
        yield c
    finally:
        app.dependency_overrides.pop(get_identity_repository, None)
        app.dependency_overrides.pop(get_mission_service, None)


@pytest.fixture
def auth_client(client: TestClient):
    client.cookies.set(COOKIE_NAME, IdentityService.issue_token(client.hoondok_user))
    return client


def test_history_month_pattern_422(auth_client: TestClient):
    for bad in ("2026-13", "2026/09", "26-09", "2026-00", "2026-9", "202609"):
        assert auth_client.get(PATH, params={"month": bad}).status_code == 422, bad
    # 연도 범위 2020 ~ 올해+1
    assert auth_client.get(PATH, params={"month": "2019-12"}).status_code == 422
    assert auth_client.get(PATH, params={"month": f"{TODAY.year + 2}-01"}).status_code == 422
    assert auth_client.get(PATH, params={"month": "2020-01"}).status_code == 200
    assert auth_client.get(PATH, params={"month": f"{TODAY.year + 1}-12"}).status_code == 200


def test_history_days_count_feb_leap_and_sep(auth_client: TestClient):
    leap = auth_client.get(PATH, params={"month": "2024-02"}).json()
    assert leap["month"] == "2024-02" and len(leap["days"]) == 29
    assert leap["days"][0]["date"] == "2024-02-01" and leap["days"][-1]["date"] == "2024-02-29"
    assert all(set(d) == {"date", "done"} for d in leap["days"])

    assert len(auth_client.get(PATH, params={"month": "2026-02"}).json()["days"]) == 28
    sep = auth_client.get(PATH, params={"month": "2026-09"}).json()
    assert len(sep["days"]) == 30 and sep["days"][-1]["date"] == "2026-09-30"


def test_history_done_flags_from_read_logs_only(auth_client: TestClient):
    uid = auth_client.hoondok_user.id
    auth_client.logs.rows |= {
        (uid, date(2026, 9, 1), "read"),
        (uid, date(2026, 9, 18), "read"),
        (uid, date(2026, 9, 5), "pray"),  # read 가 아니면 무시
        (uid, date(2026, 8, 31), "read"),  # 다른 달
        (uuid.uuid4(), date(2026, 9, 2), "read"),  # 다른 사용자
    }
    days = auth_client.get(PATH, params={"month": "2026-09"}).json()["days"]
    assert {d["date"] for d in days if d["done"]} == {"2026-09-01", "2026-09-18"}

    # 미래 날짜 기록이 있어도 done 은 false
    auth_client.logs.rows.add((uid, date(2026, 9, 25), "read"))
    days = auth_client.get(PATH, params={"month": "2026-09"}).json()["days"]
    assert all(not d["done"] for d in days if d["date"] > "2026-09-19")
    assert sum(d["done"] for d in days) == 2


def test_history_default_month_is_today_kst(auth_client: TestClient):
    body = auth_client.get(PATH).json()
    assert body["month"] == "2026-09" and len(body["days"]) == 30
    assert body["days"][0]["date"] == "2026-09-01"


def test_history_requires_cookie(client: TestClient):
    assert client.get(PATH).status_code == 401
    assert client.get(PATH, params={"month": "2026-09"}).status_code == 401
    admin = create_access_token({"sub": str(client.hoondok_user.id), "role": "admin", "email": "admin@test.com"})
    client.cookies.set("admin_token", admin)
    assert client.get(PATH).status_code == 401
    client.cookies.set(COOKIE_NAME, admin)
    assert client.get(PATH).status_code == 401
