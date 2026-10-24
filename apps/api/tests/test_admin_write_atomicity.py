"""관리자 SQL 변경과 감사 기록은 PostgreSQL의 같은 트랜잭션에서 확정한다."""

import os
import time
import uuid
from datetime import date, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel, select
from testcontainers.core.container import DockerContainer

import app.main  # 모든 FK 모델 등록
from app.modules.admin.models import AdminUser, AdminAuditLog
from app.modules.admin.repository import AdminRepository
from app.modules.admin.service import AdminService
from app.modules.chatbot.repository import ChatbotRepository
from app.modules.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate
from app.modules.chatbot.service import ChatbotService
from app.modules.chatbot.models import ChatbotConfig
from app.modules.hoondok.cards_repository import CardRepository
from app.modules.hoondok.cards_service import CardAdminService
from app.modules.hoondok.cards_schemas import CardAdminCreate, CardAdminUpdate
from app.modules.hoondok.groups_repository import GroupRepository
from app.modules.hoondok.groups_service import GroupAdminService
from app.modules.hoondok.groups_schemas import OfficialJeongseongInput
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_service import JourneyService
from app.modules.hoondok.journey_schemas import ContentRightInput
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_service import LibraryService
from app.modules.hoondok.library_schemas import BulkRightsInput
from app.modules.hoondok.models import (
    ContentRight,
    DailyReading,
    WordCard,
    SharedJeongseong,
    ReadingGroup,
)
from app.modules.hoondok.repository import DailyReadingRepository, JeongseongRepository
from app.modules.hoondok.schemas import DailyReadingAdminCreate, DailyReadingAdminUpdate
from app.modules.hoondok.service import DailyReadingAdminService
from app.core.common.clock import utcnow


@pytest.fixture(scope="module")
def postgres_url():
    supplied = os.environ.get("AUDIT_TEST_DATABASE_URL")
    if supplied:
        assert supplied.startswith("postgresql+asyncpg://")
        yield supplied
        return
    # 운영 DB 대신 테스트 전용 임시 컨테이너를 사용한다. 외부 볼륨은 연결하지 않는다.
    with (
        DockerContainer("postgres:17-alpine")
        .with_env("POSTGRES_USER", "audit")
        .with_env("POSTGRES_PASSWORD", "local-test")
        .with_env("POSTGRES_DB", "audit")
        .with_exposed_ports(5432) as container
    ):
        for _ in range(100):
            if container.exec("pg_isready -h 127.0.0.1 -U audit -d audit")[0] == 0:
                break
            time.sleep(0.1)
        else:
            pytest.fail("테스트 PostgreSQL 준비 시간 초과")
        yield f"postgresql+asyncpg://audit:local-test@{container.get_container_host_ip()}:{container.get_exposed_port(5432)}/audit"


@pytest.fixture
async def database(postgres_url):
    schema = f"audit_{uuid.uuid4().hex}"
    bootstrap = create_async_engine(postgres_url)
    async with bootstrap.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_async_engine(
        postgres_url, connect_args={"server_settings": {"search_path": schema}}
    )
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        await engine.dispose()
        # 이 fixture가 새로 만든 고유 스키마만 정리한다.
        async with bootstrap.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await bootstrap.dispose()


async def prepare(session, case, audit, actor):
    """준비 데이터는 먼저 확정하고, 실제 감사 포함 쓰기 interface를 반환한다."""
    if case.startswith("right"):
        service = JourneyService(
            JourneyRepository(session), AsyncMock(), JeongseongRepository(session)
        )
        data = ContentRightInput(
            volume="v",
            work_title="원문",
            status="allowed",
            scope_full_text=True,
            book_series="father_anthology",
        )
        if case == "right-create":
            return lambda: service.save_right_with_audit(
                data, audit, actor
            ), ContentRight
        row = await service.save_right(data)
        if case == "right-bulk":
            library = LibraryService(LibraryRepository(session), AsyncMock())
            patch = BulkRightsInput(
                book_series="father_anthology",
                status="withdrawn",
                scope_search=False,
                scope_full_text=False,
                scope_jeongseong=False,
            )
            return lambda: library.bulk_update_with_audit(
                patch, audit, actor
            ), ContentRight
        patch = data.model_copy(update={"work_title": "변경"})
        return lambda: service.save_right_with_audit(
            patch, audit, actor, row.id
        ), ContentRight
    if case.startswith("daily"):
        service = DailyReadingAdminService(DailyReadingRepository(session))
        data = DailyReadingAdminCreate(
            reading_date=date(2026, 10, 24),
            title="말씀",
            body="본문",
            speaker="화자",
            work_title="원문",
            authority_grade="R",
        )
        if case == "daily-create":
            return lambda: service.create_with_audit(data, audit, actor), DailyReading
        row = await service.create(data)
        return lambda: service.update_with_audit(
            row.id, DailyReadingAdminUpdate(review_status="withdrawn"), audit, actor
        ), DailyReading
    if case.startswith("card"):
        service = CardAdminService(CardRepository(session))
        data = CardAdminCreate(
            text="본문",
            volume="v",
            chunk_id="1",
            chunk_index=0,
            work_title="원문",
            source_label="출처",
        )
        if case == "card-create":
            return lambda: service.create_with_audit(data, audit, actor), WordCard
        row = await service.create(data)
        return lambda: service.update_with_audit(
            row.id, CardAdminUpdate(status="retired"), audit, actor
        ), WordCard
    if case.startswith("official") or case == "group-delete":
        service = GroupAdminService(GroupRepository(session))
        if case == "group-delete":
            group = ReadingGroup(
                name="모임",
                invite_code="ABCD-EFGH",
                invite_expires_at=utcnow() + timedelta(days=30),
            )
            session.add(group)
            await session.commit()
            return lambda: service.delete_group_with_audit(
                group.id, audit, actor
            ), ReadingGroup
        data = OfficialJeongseongInput(
            title="정성", started_on=date(2026, 10, 24), duration_days=7
        )
        if case == "official-create":
            return lambda: service.create_official_with_audit(
                data, audit, actor
            ), SharedJeongseong
        row = await service.create_official(data)
        if case == "official-delete":
            return lambda: service.delete_official_with_audit(
                row.id, audit, actor
            ), SharedJeongseong
        return lambda: service.update_official_with_audit(
            row.id, data.model_copy(update={"title": "수정"}), audit, actor
        ), SharedJeongseong
    service = ChatbotService(ChatbotRepository(session))
    data = ChatbotConfigCreate(chatbot_id="test", display_name="시연")
    if case == "chatbot-create":
        return lambda: service.create_with_audit(data, audit, actor), ChatbotConfig
    row = await service.create(data)
    return lambda: service.update_with_audit(
        row.id, ChatbotConfigUpdate(display_name="변경"), audit, actor
    ), ChatbotConfig


CASES = [
    "right-create",
    "right-update",
    "right-bulk",
    "daily-create",
    "daily-update",
    "card-create",
    "card-update",
    "official-create",
    "official-update",
    "official-delete",
    "group-delete",
    "chatbot-create",
    "chatbot-update",
]


@pytest.mark.parametrize("case", CASES)
@pytest.mark.parametrize("failure", [None, "insert", "commit"])
async def test_admin_write_and_audit_commit_together(
    database, case, failure, monkeypatch
):
    async with database() as session:
        actor = AdminUser(email="actor@example.com", hashed_password="test")
        session.add(actor)
        await session.commit()
        repo = AdminRepository(session)
        audit = AdminService(repo)
        operation, model = await prepare(session, case, audit, actor.id)
        before = [
            row.model_dump()
            for row in (
                await session.execute(select(model).order_by(model.id))
            ).scalars()
        ]
        if failure:
            monkeypatch.setattr(
                repo,
                "create_audit_log" if failure == "insert" else "commit",
                AsyncMock(side_effect=RuntimeError("audit failure")),
            )
            with pytest.raises(RuntimeError, match="audit failure"):
                await operation()
        else:
            await operation()
    # 같은 identity map을 보지 않고 새 연결에서 확정된 결과를 확인한다.
    async with database() as fresh:
        after = [
            row.model_dump()
            for row in (await fresh.execute(select(model).order_by(model.id))).scalars()
        ]
        logs = list((await fresh.execute(select(AdminAuditLog))).scalars())
        if failure:
            assert after == before
            assert logs == []
        else:
            assert after != before
            assert len(logs) == 1
            assert logs[0].admin_user_id == actor.id


@pytest.mark.parametrize("case", ["right-create", "daily-create", "chatbot-create"])
async def test_failed_mutation_does_not_add_audit(database, case, monkeypatch):
    from fastapi import HTTPException

    async with database() as session:
        actor = AdminUser(email="actor@example.com", hashed_password="test")
        session.add(actor)
        await session.commit()
        audit = AdminService(AdminRepository(session))
        operation, model = await prepare(session, case, audit, actor.id)
        await operation()
        log = AsyncMock(wraps=audit.log_audit)
        monkeypatch.setattr(audit, "log_audit", log)
        with pytest.raises(HTTPException) as caught:
            await operation()
        assert caught.value.status_code == 409
        log.assert_not_awaited()
    async with database() as fresh:
        assert len(list((await fresh.execute(select(model))).scalars())) == 1
        assert len(list((await fresh.execute(select(AdminAuditLog))).scalars())) == 1
