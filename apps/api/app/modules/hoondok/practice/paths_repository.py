"""7일 정성 Repository — 정의·장 스냅샷·진행·완료 행. AsyncSession 은 여기만 보유한다."""

import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import ContentRight, PathRun, PathStepCompletion, ReadingPath, ReadingPathStep
from app.modules.identity.models import User


class PathRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 정의 · 장 ---------------------------------------------------------------

    async def list_published(self) -> list[ReadingPath]:
        """발행된 공용 정성(owner 없음)을 sort_order 순으로."""
        result = await self.session.execute(
            select(ReadingPath)
            .where(ReadingPath.status == "published", ReadingPath.owner_user_id.is_(None))
            .order_by(ReadingPath.sort_order, ReadingPath.slug)
        )
        return list(result.scalars().all())

    async def get_published_by_slug(self, slug: str) -> ReadingPath | None:
        result = await self.session.execute(
            select(ReadingPath).where(ReadingPath.slug == slug, ReadingPath.status == "published")
        )
        return result.scalar_one_or_none()

    async def get_path(self, path_id: uuid.UUID) -> ReadingPath | None:
        return await self.session.get(ReadingPath, path_id)

    async def list_steps(self, path_id: uuid.UUID, version: int, minutes_tier: int | None = None) -> list[ReadingPathStep]:
        """한 정의·판의 장 스냅샷. minutes_tier 가 없으면 모든 단계를 단계·날 순으로."""
        query = select(ReadingPathStep).where(
            ReadingPathStep.path_id == path_id, ReadingPathStep.path_version == version
        )
        if minutes_tier is not None:
            query = query.where(ReadingPathStep.minutes_tier == minutes_tier)
        result = await self.session.execute(query.order_by(ReadingPathStep.minutes_tier, ReadingPathStep.day_index))
        return list(result.scalars().all())

    async def list_rights(self, volumes: set[str]) -> dict[str, ContentRight]:
        if not volumes:
            return {}
        result = await self.session.execute(select(ContentRight).where(ContentRight.volume.in_(sorted(volumes))))
        return {right.volume: right for right in result.scalars().all()}

    # --- 진행 ---------------------------------------------------------------------

    async def lock_user(self, user_id: uuid.UUID) -> None:
        """사용자 행 잠금(SELECT … FOR UPDATE) — 계정 삭제와 같은 규약(UserRepository.get_for_update).

        정성 기간 시작과 7일 정성 시작이 이 잠금 뒤 두 테이블을 확인해 "진행 중 정성은 하나"를 지킨다.
        잠금은 이 세션의 다음 커밋·롤백까지 유지된다. sqlite 에서는 FOR UPDATE 가 무시된다.
        """
        await self.session.execute(select(User.id).where(User.id == user_id).with_for_update())

    async def get_active_run(self, user_id: uuid.UUID) -> PathRun | None:
        result = await self.session.execute(
            select(PathRun)
            .where(PathRun.user_id == user_id, PathRun.status == "active")
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_run(self, run_id: uuid.UUID) -> PathRun | None:
        result = await self.session.execute(
            select(PathRun).where(PathRun.id == run_id).execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_latest_run(self, user_id: uuid.UUID) -> PathRun | None:
        """가장 최근에 시작한 run 1건(상태 무관)."""
        result = await self.session.execute(
            select(PathRun)
            .where(PathRun.user_id == user_id)
            .order_by(PathRun.created_at.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def list_completions(self, run_id: uuid.UUID) -> list[PathStepCompletion]:
        result = await self.session.execute(
            select(PathStepCompletion)
            .where(PathStepCompletion.run_id == run_id)
            .order_by(PathStepCompletion.day_index)
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    def add(self, row: PathRun | PathStepCompletion) -> None:
        self.session.add(row)

    async def flush(self) -> None:
        await self.session.flush()

    async def commit(self) -> None:
        """커밋. 실패하면 롤백해 세션을 다시 쓸 수 있게 두고 예외(IntegrityError 등)를 그대로 올린다."""
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def refresh(self, row: PathRun | PathStepCompletion) -> None:
        await self.session.refresh(row)

    # --- 계정 삭제 ------------------------------------------------------------------

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """계정 삭제(API-HD-011)의 일부 — 커밋하지 않는다. 소프트 삭제라 FK CASCADE 가 돌지 않아 순서대로 지운다.

        완료 → run → 본인 정성의 장 → 본인 정성, 남이 쓰는 정성의 created_by 는 NULL 로 바꾼다.
        """
        run_ids = select(PathRun.id).where(PathRun.user_id == user_id)
        await self.session.execute(delete(PathStepCompletion).where(PathStepCompletion.run_id.in_(run_ids)))
        await self.session.execute(delete(PathRun).where(PathRun.user_id == user_id))
        owned = select(ReadingPath.id).where(ReadingPath.owner_user_id == user_id)
        await self.session.execute(delete(ReadingPathStep).where(ReadingPathStep.path_id.in_(owned)))
        await self.session.execute(delete(ReadingPath).where(ReadingPath.owner_user_id == user_id))
        await self.session.execute(
            update(ReadingPath).where(ReadingPath.created_by == user_id).values(created_by=None)
        )
