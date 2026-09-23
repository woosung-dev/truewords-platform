"""훈독 함께 읽는 모임 Repository (PLAN-HD-010) — AsyncSession 은 여기만 보유한다.

FK 에 ondelete 가 없으므로 삭제 순서를 여기서 명시한다:
share_reactions → group_shares → shared_jeongseongs(모임) → group_members → reading_groups.
"""

import uuid
from datetime import date, datetime

from sqlalchemy import delete, func, or_, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import (
    DailyReading,
    GroupMember,
    GroupShare,
    MissionLog,
    ReadingGroup,
    SharedJeongseong,
    ShareReaction,
)
from app.modules.identity.models import User

READ_KIND = "read"  # 모임 완료자 = 오늘 훈독하기(read) 완료자. 연속일·1단계와 같은 kind


class GroupRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 트랜잭션 ---------------------------------------------------------

    def add(self, *objs: object) -> None:
        self.session.add_all(objs)

    async def flush(self) -> None:
        await self.session.flush()

    async def commit(self) -> None:
        """커밋. 실패(IntegrityError 등)하면 롤백해 세션을 재사용 가능하게 두고 예외를 그대로 올린다."""
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    async def rollback(self) -> None:
        await self.session.rollback()

    async def lock_user(self, user_id: uuid.UUID) -> None:
        """사용자별 한도(가입 5·리더 3) 검사를 동시 요청 사이에 직렬화한다. 잠금 순서: 사용자 → 모임."""
        await self.session.execute(select(User.id).where(User.id == user_id).with_for_update())

    # --- 모임 -------------------------------------------------------------

    async def get_group(self, group_id: uuid.UUID) -> ReadingGroup | None:
        # session.get 은 identity map 을 먼저 봐서 bulk DELETE 뒤에도 옛 객체를 돌려줄 수 있다 — 항상 조회한다.
        result = await self.session.execute(select(ReadingGroup).where(ReadingGroup.id == group_id))
        return result.scalar_one_or_none()

    async def get_group_for_update(self, group_id: uuid.UUID) -> ReadingGroup | None:
        """정원 검사용 행 잠금(Postgres SELECT ... FOR UPDATE). aiosqlite 는 무시한다."""
        result = await self.session.execute(
            select(ReadingGroup)
            .where(ReadingGroup.id == group_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def get_by_invite_code(self, code: str) -> ReadingGroup | None:
        result = await self.session.execute(select(ReadingGroup).where(ReadingGroup.invite_code == code))
        return result.scalar_one_or_none()

    async def delete_group(self, group_id: uuid.UUID) -> None:
        """모임 하드 삭제 — 커밋하지 않는다."""
        share_ids = select(GroupShare.id).where(GroupShare.group_id == group_id)
        await self.session.execute(delete(ShareReaction).where(ShareReaction.share_id.in_(share_ids)))
        await self.session.execute(delete(GroupShare).where(GroupShare.group_id == group_id))
        await self.session.execute(delete(SharedJeongseong).where(SharedJeongseong.group_id == group_id))
        await self.session.execute(delete(GroupMember).where(GroupMember.group_id == group_id))
        await self.session.execute(delete(ReadingGroup).where(ReadingGroup.id == group_id))

    async def list_groups_with_counts(self) -> list[tuple[ReadingGroup, int]]:
        """admin 목록(API-HD-043). 최신 생성 순."""
        counts = (
            select(GroupMember.group_id, func.count(GroupMember.id).label("n"))
            .group_by(GroupMember.group_id)
            .subquery()
        )
        result = await self.session.execute(
            select(ReadingGroup, func.coalesce(counts.c.n, 0))
            .outerjoin(counts, counts.c.group_id == ReadingGroup.id)
            .order_by(ReadingGroup.created_at.desc())
        )
        return [(group, int(n)) for group, n in result.all()]

    # --- 모임원 -----------------------------------------------------------

    async def get_member(self, group_id: uuid.UUID, user_id: uuid.UUID) -> GroupMember | None:
        result = await self.session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_member_by_id(self, group_id: uuid.UUID, member_id: uuid.UUID) -> GroupMember | None:
        result = await self.session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.id == member_id)
        )
        return result.scalar_one_or_none()

    async def get_leader(self, group_id: uuid.UUID) -> GroupMember | None:
        result = await self.session.execute(
            select(GroupMember).where(GroupMember.group_id == group_id, GroupMember.role == "leader")
        )
        return result.scalar_one_or_none()

    async def list_members(self, group_id: uuid.UUID) -> list[GroupMember]:
        """들어온 순서(가장 먼저 들어온 식구가 앞)."""
        result = await self.session.execute(
            select(GroupMember)
            .where(GroupMember.group_id == group_id)
            .order_by(GroupMember.joined_at, GroupMember.id)
        )
        return list(result.scalars().all())

    async def count_members(self, group_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count(GroupMember.id)).where(GroupMember.group_id == group_id)
        )
        return int(result.scalar_one())

    async def count_memberships(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(select(func.count(GroupMember.id)).where(GroupMember.user_id == user_id))
        return int(result.scalar_one())

    async def count_leader_groups(self, user_id: uuid.UUID) -> int:
        result = await self.session.execute(
            select(func.count(GroupMember.id)).where(GroupMember.user_id == user_id, GroupMember.role == "leader")
        )
        return int(result.scalar_one())

    async def list_memberships(self, user_id: uuid.UUID) -> list[tuple[GroupMember, ReadingGroup]]:
        result = await self.session.execute(
            select(GroupMember, ReadingGroup)
            .join(ReadingGroup, ReadingGroup.id == GroupMember.group_id)
            .where(GroupMember.user_id == user_id)
            .order_by(GroupMember.joined_at, GroupMember.id)
        )
        return [(member, group) for member, group in result.all()]

    async def delete_member(self, member_id: uuid.UUID) -> None:
        """탈퇴·내보내기 — 그 사람 한 줄·누른 반응·그 사람 한 줄에 달린 반응·모임원 행. 커밋하지 않는다."""
        share_ids = select(GroupShare.id).where(GroupShare.member_id == member_id)
        await self.session.execute(
            delete(ShareReaction).where(
                or_(ShareReaction.member_id == member_id, ShareReaction.share_id.in_(share_ids))
            )
        )
        await self.session.execute(delete(GroupShare).where(GroupShare.member_id == member_id))
        await self.session.execute(delete(GroupMember).where(GroupMember.id == member_id))

    # --- 완료자 -----------------------------------------------------------

    async def readers_on(self, group_id: uuid.UUID, day: date) -> list[tuple[GroupMember, datetime]]:
        """그날(KST) read 를 마친 모임원과 완료 시각(UTC naive). 미완료자는 조회하지 않는다."""
        result = await self.session.execute(
            select(GroupMember, MissionLog.completed_at)
            .join(MissionLog, MissionLog.user_id == GroupMember.user_id)
            .where(
                GroupMember.group_id == group_id,
                MissionLog.mission_date == day,
                MissionLog.kind == READ_KIND,
            )
        )
        return [(member, completed_at) for member, completed_at in result.all()]

    async def has_read(self, user_id: uuid.UUID, day: date) -> bool:
        result = await self.session.execute(
            select(MissionLog.id).where(
                MissionLog.user_id == user_id, MissionLog.mission_date == day, MissionLog.kind == READ_KIND
            )
        )
        return result.first() is not None

    async def get_daily_reading(self, day: date) -> DailyReading | None:
        result = await self.session.execute(select(DailyReading).where(DailyReading.reading_date == day))
        return result.scalar_one_or_none()

    # --- 정성 -------------------------------------------------------------

    async def list_open_jeongseongs(self, group_id: uuid.UUID | None, today: date) -> list[SharedJeongseong]:
        """끝나지 않은(진행 중·예정) 공식 정성 + 이 모임 정성. 끝남 판정은 service 가 한다(DB 날짜 산술 비의존)."""
        cond = SharedJeongseong.group_id.is_(None)
        if group_id is not None:
            cond = or_(cond, SharedJeongseong.group_id == group_id)
        result = await self.session.execute(
            select(SharedJeongseong).where(cond).order_by(SharedJeongseong.started_on, SharedJeongseong.created_at)
        )
        return list(result.scalars().all())

    async def list_group_jeongseongs(self, group_id: uuid.UUID) -> list[SharedJeongseong]:
        result = await self.session.execute(
            select(SharedJeongseong).where(SharedJeongseong.group_id == group_id)
        )
        return list(result.scalars().all())

    async def get_jeongseong(self, jeongseong_id: uuid.UUID) -> SharedJeongseong | None:
        result = await self.session.execute(select(SharedJeongseong).where(SharedJeongseong.id == jeongseong_id))
        return result.scalar_one_or_none()

    async def delete_jeongseong(self, jeongseong_id: uuid.UUID) -> None:
        await self.session.execute(delete(SharedJeongseong).where(SharedJeongseong.id == jeongseong_id))

    async def list_official_jeongseongs(self) -> list[SharedJeongseong]:
        result = await self.session.execute(
            select(SharedJeongseong)
            .where(SharedJeongseong.group_id.is_(None))
            .order_by(SharedJeongseong.started_on.desc(), SharedJeongseong.created_at.desc())
        )
        return list(result.scalars().all())

    # --- 한 줄·반응 --------------------------------------------------------

    async def list_shares(self, group_id: uuid.UUID, day: date) -> list[tuple[GroupShare, GroupMember]]:
        result = await self.session.execute(
            select(GroupShare, GroupMember)
            .join(GroupMember, GroupMember.id == GroupShare.member_id)
            .where(GroupShare.group_id == group_id, GroupShare.share_date == day)
            .order_by(GroupShare.created_at, GroupShare.id)
        )
        return [(share, member) for share, member in result.all()]

    async def get_share(self, group_id: uuid.UUID, share_id: uuid.UUID) -> GroupShare | None:
        result = await self.session.execute(
            select(GroupShare).where(GroupShare.group_id == group_id, GroupShare.id == share_id)
        )
        return result.scalar_one_or_none()

    async def get_share_of(self, member_id: uuid.UUID, day: date) -> GroupShare | None:
        result = await self.session.execute(
            select(GroupShare).where(GroupShare.member_id == member_id, GroupShare.share_date == day)
        )
        return result.scalar_one_or_none()

    async def delete_share(self, share_id: uuid.UUID) -> None:
        await self.session.execute(delete(ShareReaction).where(ShareReaction.share_id == share_id))
        await self.session.execute(delete(GroupShare).where(GroupShare.id == share_id))

    async def reaction_counts(self, share_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
        if not share_ids:
            return {}
        result = await self.session.execute(
            select(ShareReaction.share_id, func.count())
            .where(ShareReaction.share_id.in_(share_ids))
            .group_by(ShareReaction.share_id)
        )
        return {share_id: int(n) for share_id, n in result.all()}

    async def reacted_share_ids(self, share_ids: list[uuid.UUID], member_id: uuid.UUID) -> set[uuid.UUID]:
        if not share_ids:
            return set()
        result = await self.session.execute(
            select(ShareReaction.share_id).where(
                ShareReaction.share_id.in_(share_ids), ShareReaction.member_id == member_id
            )
        )
        return set(result.scalars().all())

    async def get_reaction(self, share_id: uuid.UUID, member_id: uuid.UUID) -> ShareReaction | None:
        result = await self.session.execute(
            select(ShareReaction).where(ShareReaction.share_id == share_id, ShareReaction.member_id == member_id)
        )
        return result.scalar_one_or_none()

    async def delete_reaction(self, share_id: uuid.UUID, member_id: uuid.UUID) -> None:
        await self.session.execute(
            delete(ShareReaction).where(ShareReaction.share_id == share_id, ShareReaction.member_id == member_id)
        )

    # --- 계정 삭제 purger (API-HD-011) --------------------------------------

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """계정 삭제의 일부 — 커밋하지 않는다(UserRepository.save 커밋에 묶인다).

        모임마다 모임원 행을 지우고, 리더였다면 가장 먼저 들어온 식구에게 리더를 넘긴다. 남은 식구가 없으면 모임을 지운다.
        이 사용자가 만든 정성의 created_by_user_id 는 비운다(정성 자체는 모임 것이라 남긴다).
        """
        locked = await self.session.execute(
            select(GroupMember).where(GroupMember.user_id == user_id).with_for_update()
        )
        memberships = list(locked.scalars().all())
        for member in memberships:
            group_id, was_leader = member.group_id, member.role == "leader"
            await self.get_group_for_update(group_id)
            await self.delete_member(member.id)
            if not was_leader:
                continue
            successor = await self.session.execute(
                select(GroupMember.id)
                .where(GroupMember.group_id == group_id)
                .order_by(GroupMember.joined_at, GroupMember.id)
                .limit(1)
            )
            successor_id = successor.scalar_one_or_none()
            if successor_id is None:
                await self.delete_group(group_id)
            else:
                await self.session.execute(
                    update(GroupMember).where(GroupMember.id == successor_id).values(role="leader")
                )
        await self.session.execute(
            update(SharedJeongseong)
            .where(SharedJeongseong.created_by_user_id == user_id)
            .values(created_by_user_id=None)
        )
