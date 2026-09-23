"""훈독 함께 읽는 모임 Service — API-HD-030~043 (PLAN-HD-010).

권한 규칙:
- 모임원이 아니면 어떤 모임 라우트든 404 — 모임의 존재 자체를 알리지 않는다.
- 모임원이 리더 전용 동작을 부르면 403 `LEADER_ONLY`.
- 초대 코드가 잘못·만료됐거나 정원이 찬 모임의 미리보기는 모두 같은 404 `INVITE_NOT_FOUND`.

개인정보 경계(계획 §5): 모임원 응답에는 오늘 read 완료자만 담는다. 미완료자·전체 인원은
리더 식구 목록(API-HD-038)과 admin 목록(API-HD-043)에만 있다.
"""

import secrets
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import KST, today_kst
from app.modules.hoondok.groups_repository import GroupRepository
from app.modules.hoondok.groups_schemas import (
    AdminGroupItem,
    GroupCreate,
    GroupDetail,
    GroupJeongseongInput,
    GroupJeongseongOut,
    GroupMe,
    GroupReader,
    GroupShareOut,
    InviteOut,
    InvitePreview,
    JoinResult,
    MemberItem,
    MemberList,
    MyGroupItem,
    OfficialJeongseongInput,
    OfficialJeongseongOut,
    ReactionState,
    TodayReadingSummary,
)
from app.modules.hoondok.models import (
    GroupMember,
    GroupShare,
    ReadingGroup,
    SharedJeongseong,
    ShareReaction,
)

# Crockford base32 — I·L·O·U 를 쓰지 않는다. 8자 = 40bit.
INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_INVITE_ALIASES = str.maketrans({"I": "1", "L": "1", "O": "0"})
INVITE_TTL = timedelta(days=30)

GROUP_CAPACITY = 50  # 모임당 정원
MAX_MEMBERSHIPS = 5  # 사용자당 속한 모임(리더 포함)
MAX_LED_GROUPS = 3  # 사용자당 리더인 모임
MAX_GROUP_JEONGSEONGS = 3  # 모임당 진행 중·예정 모임 정성
STARTED_ON_WINDOW_DAYS = 30  # 모임 정성 시작일 오늘±30


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def generate_invite_code() -> str:
    raw = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_invite_code(value: str | None) -> str | None:
    """대소문자·하이픈·공백 무시, Crockford 별칭(I·L→1, O→0) 적용. 형식이 아니면 None."""
    if not value:
        return None
    raw = "".join(value.split()).replace("-", "").upper().translate(_INVITE_ALIASES)
    if len(raw) != 8 or any(ch not in INVITE_ALPHABET for ch in raw):
        return None
    return f"{raw[:4]}-{raw[4:]}"


def to_kst(moment: datetime) -> datetime:
    """naive UTC → KST aware."""
    return moment.replace(tzinfo=timezone.utc).astimezone(KST)


def _error(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "GROUP_NOT_FOUND")


def _invite_not_found() -> HTTPException:
    return _error(status.HTTP_404_NOT_FOUND, "INVITE_NOT_FOUND")


def _conflict(detail: str) -> HTTPException:
    return _error(status.HTTP_409_CONFLICT, detail)


def jeongseong_out(js: SharedJeongseong, today: date) -> GroupJeongseongOut | None:
    """끝난 정성은 None(목록 제외). 시작 전이면 upcoming·day_index=None."""
    day = (today - js.started_on).days + 1
    if day > js.duration_days:
        return None
    return GroupJeongseongOut(
        id=js.id,
        title=js.title,
        started_on=js.started_on,
        duration_days=js.duration_days,
        day_index=day if day >= 1 else None,
        state="active" if day >= 1 else "upcoming",
        is_official=js.group_id is None,
    )


class GroupService:
    def __init__(
        self,
        repo: GroupRepository,
        *,
        today_fn: Callable[[], date] = today_kst,
        now_fn: Callable[[], datetime] = _utcnow,
    ) -> None:
        self.repo = repo
        self.today_fn = today_fn
        self.now_fn = now_fn

    # --- 공통 ---------------------------------------------------------------

    async def _membership(self, group_id: uuid.UUID, user_id: uuid.UUID) -> tuple[ReadingGroup, GroupMember]:
        member = await self.repo.get_member(group_id, user_id)
        group = await self.repo.get_group(group_id) if member else None
        if member is None or group is None:
            raise _not_found()
        return group, member

    async def _leadership(self, group_id: uuid.UUID, user_id: uuid.UUID) -> tuple[ReadingGroup, GroupMember]:
        group, member = await self._membership(group_id, user_id)
        if member.role != "leader":
            raise _error(status.HTTP_403_FORBIDDEN, "LEADER_ONLY")
        return group, member

    async def _jeongseongs(self, group_id: uuid.UUID, today: date) -> list[GroupJeongseongOut]:
        items = [jeongseong_out(js, today) for js in await self.repo.list_open_jeongseongs(group_id, today)]
        return [item for item in items if item is not None]

    async def _readers(self, group_id: uuid.UUID, today: date) -> list[tuple[GroupMember, datetime]]:
        """오늘 완료자, 가나다순(한글 음절은 코드 포인트 순서 = 가나다 순서)."""
        rows = await self.repo.readers_on(group_id, today)
        return sorted(rows, key=lambda row: (row[0].display_name, row[0].id.hex))

    async def _resolve_invite(self, code: str | None) -> ReadingGroup | None:
        normalized = normalize_invite_code(code)
        if normalized is None:
            return None
        group = await self.repo.get_by_invite_code(normalized)
        if group is None or group.invite_expires_at <= self.now_fn():
            return None
        return group

    async def _new_invite_code(self) -> str:
        """40bit 라 충돌은 사실상 없지만 기존 코드와 겹치면 다시 뽑는다."""
        while True:
            code = generate_invite_code()
            if await self.repo.get_by_invite_code(code) is None:
                return code

    def _check_started_on(self, started_on: date, duration_days: int, today: date) -> None:
        if abs((started_on - today).days) > STARTED_ON_WINDOW_DAYS:
            raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "STARTED_ON_OUT_OF_RANGE")
        if started_on + timedelta(days=duration_days - 1) < today:
            raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "JEONGSEONG_ALREADY_ENDED")

    # --- API-HD-030 내 모임 ----------------------------------------------------

    async def list_my_groups(self, user_id: uuid.UUID) -> list[MyGroupItem]:
        today = self.today_fn()
        items: list[MyGroupItem] = []
        for member, group in await self.repo.list_memberships(user_id):
            readers = await self._readers(group.id, today)
            items.append(
                MyGroupItem(
                    id=group.id,
                    name=group.name,
                    kind=group.kind,
                    role=member.role,
                    my_display_name=member.display_name,
                    today_read_count=len(readers),
                    readers_preview=[m.display_name[0] for m, _ in readers[:3]],
                    jeongseongs=await self._jeongseongs(group.id, today),
                )
            )
        return items

    # --- API-HD-031 만들기 · 032 상세 · 033 이름·삭제 · 034 재발급 ---------------

    async def create_group(self, user_id: uuid.UUID, data: GroupCreate) -> GroupDetail:
        today = self.today_fn()
        if data.jeongseong is not None:
            self._check_started_on(data.jeongseong.started_on, data.jeongseong.duration_days, today)
        await self.repo.lock_user(user_id)
        if await self.repo.count_leader_groups(user_id) >= MAX_LED_GROUPS:
            raise _conflict("LEADER_LIMIT")
        if await self.repo.count_memberships(user_id) >= MAX_MEMBERSHIPS:
            raise _conflict("JOIN_LIMIT")
        now = self.now_fn()
        group = ReadingGroup(
            name=data.name,
            meeting_time=data.meeting_time,
            invite_code=await self._new_invite_code(),
            invite_expires_at=now + INVITE_TTL,
            created_at=now,
            updated_at=now,
        )
        self.repo.add(group)
        await self.repo.flush()  # FK 순서: 모임 → 모임원·정성
        self.repo.add(GroupMember(group_id=group.id, user_id=user_id, display_name=data.display_name, role="leader"))
        if data.jeongseong is not None:
            self.repo.add(
                SharedJeongseong(
                    group_id=group.id,
                    title=data.jeongseong.title,
                    started_on=data.jeongseong.started_on,
                    duration_days=data.jeongseong.duration_days,
                    created_by_user_id=user_id,
                )
            )
        try:
            await self.repo.commit()
        except IntegrityError:
            raise _conflict("INVITE_CODE_COLLISION")
        return await self.get_detail(user_id, group.id)

    async def get_detail(self, user_id: uuid.UUID, group_id: uuid.UUID) -> GroupDetail:
        today = self.today_fn()
        group, me = await self._membership(group_id, user_id)
        leader = await self.repo.get_leader(group.id)
        reading = await self.repo.get_daily_reading(today)
        readers = await self._readers(group.id, today)
        shares = await self.repo.list_shares(group.id, today)
        share_ids = [share.id for share, _ in shares]
        mine = [share.id for share, author in shares if author.id == me.id]
        counts = await self.repo.reaction_counts(mine)
        reacted = await self.repo.reacted_share_ids(share_ids, me.id)
        is_leader = me.role == "leader"
        return GroupDetail(
            id=group.id,
            name=group.name,
            kind=group.kind,
            leader_display_name=leader.display_name if leader else "",
            meeting_time=group.meeting_time,
            date=today,
            today_reading=(
                TodayReadingSummary.model_validate(reading, from_attributes=True)
                if reading is not None and reading.review_status != "withdrawn"
                else None
            ),
            jeongseongs=await self._jeongseongs(group.id, today),
            readers=[
                GroupReader(
                    display_name=member.display_name,
                    read_at_kst=to_kst(completed_at),
                    is_me=member.id == me.id,
                    is_leader=member.role == "leader",
                )
                for member, completed_at in readers
            ],
            shares=[
                GroupShareOut(
                    id=share.id,
                    display_name=author.display_name,
                    body=share.body,
                    created_at_kst=to_kst(share.created_at),
                    is_mine=author.id == me.id,
                    has_my_reaction=share.id in reacted,
                    reaction_count=counts.get(share.id, 0) if author.id == me.id else None,
                )
                for share, author in shares
            ],
            me=GroupMe(
                member_id=me.id,
                display_name=me.display_name,
                role=me.role,
                has_read_today=any(member.id == me.id for member, _ in readers),
                has_shared_today=bool(mine),
            ),
            invite_code=group.invite_code if is_leader else None,
            invite_expires_at=group.invite_expires_at if is_leader else None,
        )

    async def rename(self, user_id: uuid.UUID, group_id: uuid.UUID, name: str) -> GroupDetail:
        group, _ = await self._leadership(group_id, user_id)
        group.name = name
        group.updated_at = self.now_fn()
        self.repo.add(group)
        await self.repo.commit()
        return await self.get_detail(user_id, group_id)

    async def delete_group(self, user_id: uuid.UUID, group_id: uuid.UUID) -> None:
        await self._leadership(group_id, user_id)
        await self.repo.delete_group(group_id)
        await self.repo.commit()

    async def regenerate_invite(self, user_id: uuid.UUID, group_id: uuid.UUID) -> InviteOut:
        group, _ = await self._leadership(group_id, user_id)
        now = self.now_fn()
        group.invite_code = await self._new_invite_code()
        group.invite_expires_at = now + INVITE_TTL
        group.updated_at = now
        self.repo.add(group)
        await self.repo.commit()
        return InviteOut(invite_code=group.invite_code, invite_expires_at=group.invite_expires_at)

    # --- API-HD-035 미리보기 · 036 참여 · D4 가입 게이트 ---------------------------

    async def preview_invite(self, user_id: uuid.UUID, code: str) -> InvitePreview:
        group = await self._resolve_invite(code)
        if group is None:
            raise _invite_not_found()
        member = await self.repo.get_member(group.id, user_id)
        if member is None and await self.repo.count_members(group.id) >= GROUP_CAPACITY:
            raise _invite_not_found()  # 정원 초과도 잘못된 코드와 구분하지 않는다
        leader = await self.repo.get_leader(group.id)
        return InvitePreview(
            name=group.name,
            kind=group.kind,
            leader_display_name=leader.display_name if leader else "",
            jeongseongs=await self._jeongseongs(group.id, self.today_fn()),
            is_member=member is not None,
            group_id=group.id if member is not None else None,
        )

    async def join(self, user_id: uuid.UUID, code: str, display_name: str) -> JoinResult:
        found = await self._resolve_invite(code)
        if found is None:
            raise _invite_not_found()
        group_id = found.id
        # 잠금 순서 사용자 → 모임. 모임 행을 잠근 뒤 인원을 다시 세어 마지막 자리 경쟁에서 정원을 넘지 않게 한다.
        await self.repo.lock_user(user_id)
        if await self.repo.get_group_for_update(group_id) is None:
            raise _invite_not_found()
        if await self.repo.get_member(group_id, user_id) is not None:
            raise _conflict("ALREADY_MEMBER")
        if await self.repo.count_members(group_id) >= GROUP_CAPACITY:
            raise _conflict("GROUP_FULL")
        if await self.repo.count_memberships(user_id) >= MAX_MEMBERSHIPS:
            raise _conflict("JOIN_LIMIT")
        self.repo.add(GroupMember(group_id=group_id, user_id=user_id, display_name=display_name, role="member"))
        try:
            await self.repo.commit()
        except IntegrityError:
            # unique(group,user) 또는 unique(group,display_name) — 동시 요청 경쟁도 여기로 온다.
            if await self.repo.get_member(group_id, user_id) is not None:
                raise _conflict("ALREADY_MEMBER")
            raise _conflict("DISPLAY_NAME_TAKEN")
        return JoinResult(group_id=group_id)

    async def is_joinable_invite(self, code: str) -> bool:
        """D4 베타 게이트: 존재·미만료·정원 미달인 모임 코드면 True."""
        group = await self._resolve_invite(code)
        return group is not None and await self.repo.count_members(group.id) < GROUP_CAPACITY

    # --- API-HD-037 내 이름·탈퇴 · 038 식구 목록·내보내기 -----------------------

    async def update_my_name(self, user_id: uuid.UUID, group_id: uuid.UUID, display_name: str) -> GroupMe:
        _, me = await self._membership(group_id, user_id)
        me.display_name = display_name
        self.repo.add(me)
        try:
            await self.repo.commit()
        except IntegrityError:
            raise _conflict("DISPLAY_NAME_TAKEN")
        today = self.today_fn()
        return GroupMe(
            member_id=me.id,
            display_name=me.display_name,
            role=me.role,
            has_read_today=await self.repo.has_read(user_id, today),
            has_shared_today=await self.repo.get_share_of(me.id, today) is not None,
        )

    async def leave(self, user_id: uuid.UUID, group_id: uuid.UUID) -> None:
        group, me = await self._membership(group_id, user_id)
        if me.role == "leader":
            await self.repo.get_group_for_update(group.id)
            if await self.repo.count_members(group.id) > 1:
                raise _conflict("LEADER_MUST_HANDOVER")
            await self.repo.delete_group(group.id)
        else:
            await self.repo.delete_member(me.id)
        await self.repo.commit()

    async def list_members(self, user_id: uuid.UUID, group_id: uuid.UUID) -> MemberList:
        await self._leadership(group_id, user_id)
        members = await self.repo.list_members(group_id)
        return MemberList(
            member_count=len(members),
            items=[
                MemberItem(id=m.id, display_name=m.display_name, role=m.role, joined_at=m.joined_at)
                for m in members
            ],
        )

    async def remove_member(self, user_id: uuid.UUID, group_id: uuid.UUID, member_id: uuid.UUID) -> None:
        _, me = await self._leadership(group_id, user_id)
        if member_id == me.id:
            raise _conflict("CANNOT_REMOVE_SELF")
        target = await self.repo.get_member_by_id(group_id, member_id)
        if target is None:
            raise _error(status.HTTP_404_NOT_FOUND, "MEMBER_NOT_FOUND")
        await self.repo.delete_member(target.id)
        await self.repo.commit()

    # --- API-HD-039 모임 정성 ----------------------------------------------------

    async def add_jeongseong(
        self, user_id: uuid.UUID, group_id: uuid.UUID, data: GroupJeongseongInput
    ) -> GroupJeongseongOut:
        await self._leadership(group_id, user_id)
        today = self.today_fn()
        self._check_started_on(data.started_on, data.duration_days, today)
        await self.repo.get_group_for_update(group_id)
        open_count = sum(
            1 for js in await self.repo.list_group_jeongseongs(group_id) if jeongseong_out(js, today) is not None
        )
        if open_count >= MAX_GROUP_JEONGSEONGS:
            raise _conflict("JEONGSEONG_LIMIT")
        js = SharedJeongseong(
            group_id=group_id,
            title=data.title,
            started_on=data.started_on,
            duration_days=data.duration_days,
            created_by_user_id=user_id,
        )
        self.repo.add(js)
        await self.repo.commit()
        out = jeongseong_out(js, today)
        assert out is not None  # _check_started_on 이 끝난 기간을 막는다
        return out

    async def delete_jeongseong(self, user_id: uuid.UUID, group_id: uuid.UUID, jeongseong_id: uuid.UUID) -> None:
        await self._leadership(group_id, user_id)
        js = await self.repo.get_jeongseong(jeongseong_id)
        if js is None or js.group_id != group_id:  # 공식 정성(group_id NULL)은 리더가 지울 수 없다
            raise _error(status.HTTP_404_NOT_FOUND, "JEONGSEONG_NOT_FOUND")
        await self.repo.delete_jeongseong(jeongseong_id)
        await self.repo.commit()

    # --- API-HD-040 한 줄 · 041 반응 ---------------------------------------------

    async def put_today_share(self, user_id: uuid.UUID, group_id: uuid.UUID, body: str) -> GroupShareOut:
        _, me = await self._membership(group_id, user_id)
        today = self.today_fn()
        if not await self.repo.has_read(user_id, today):
            raise _conflict("READ_REQUIRED")
        share = await self.repo.get_share_of(me.id, today)
        now = self.now_fn()
        if share is None:
            share = GroupShare(group_id=group_id, member_id=me.id, share_date=today, body=body, created_at=now, updated_at=now)
        else:
            share.body = body
            share.updated_at = now
        self.repo.add(share)
        try:
            await self.repo.commit()
        except IntegrityError:
            # 같은 사람의 동시 첫 저장 — 먼저 들어간 행을 덮어쓴다.
            share = await self.repo.get_share_of(me.id, today)
            if share is None:
                raise
            share.body = body
            share.updated_at = now
            self.repo.add(share)
            await self.repo.commit()
        counts = await self.repo.reaction_counts([share.id])
        return GroupShareOut(
            id=share.id,
            display_name=me.display_name,
            body=share.body,
            created_at_kst=to_kst(share.created_at),
            is_mine=True,
            has_my_reaction=False,
            reaction_count=counts.get(share.id, 0),
        )

    async def delete_share(self, user_id: uuid.UUID, group_id: uuid.UUID, share_id: uuid.UUID) -> None:
        _, me = await self._membership(group_id, user_id)
        share = await self.repo.get_share(group_id, share_id)
        if share is None:
            raise _error(status.HTTP_404_NOT_FOUND, "SHARE_NOT_FOUND")
        if share.member_id != me.id and me.role != "leader":
            raise _error(status.HTTP_403_FORBIDDEN, "NOT_ALLOWED")
        await self.repo.delete_share(share.id)
        await self.repo.commit()

    async def _reactable_share(self, group_id: uuid.UUID, share_id: uuid.UUID, me: GroupMember) -> GroupShare:
        share = await self.repo.get_share(group_id, share_id)
        if share is None or share.share_date != self.today_fn():  # 지난 한 줄은 화면에 없다
            raise _error(status.HTTP_404_NOT_FOUND, "SHARE_NOT_FOUND")
        if share.member_id == me.id:
            raise _conflict("OWN_SHARE")
        return share

    async def react(self, user_id: uuid.UUID, group_id: uuid.UUID, share_id: uuid.UUID) -> ReactionState:
        _, me = await self._membership(group_id, user_id)
        share = await self._reactable_share(group_id, share_id, me)
        if await self.repo.get_reaction(share.id, me.id) is None:
            self.repo.add(ShareReaction(share_id=share.id, member_id=me.id))
            try:
                await self.repo.commit()
            except IntegrityError:
                pass  # 동시 두 번 눌림 — 이미 반응한 상태면 충분하다(멱등)
        return ReactionState(has_reacted=True)

    async def unreact(self, user_id: uuid.UUID, group_id: uuid.UUID, share_id: uuid.UUID) -> ReactionState:
        _, me = await self._membership(group_id, user_id)
        share = await self._reactable_share(group_id, share_id, me)
        await self.repo.delete_reaction(share.id, me.id)
        await self.repo.commit()
        return ReactionState(has_reacted=False)


class GroupInviteVerifier:
    """identity `InviteCodeVerifier` 구현(D4). 모임 코드 형식일 때만 limiter 를 세고 DB 를 조회한다."""

    def __init__(self, service: GroupService, check_limit: Callable[[], None]) -> None:
        self.service = service
        self.check_limit = check_limit

    async def is_valid(self, code: str) -> bool:
        if normalize_invite_code(code) is None:
            return False
        self.check_limit()
        return await self.service.is_joinable_invite(code)


class GroupAdminService:
    """API-HD-042 공식 정성 · API-HD-043 모임 목록·삭제."""

    def __init__(self, repo: GroupRepository, *, now_fn: Callable[[], datetime] = _utcnow) -> None:
        self.repo = repo
        self.now_fn = now_fn

    @staticmethod
    def _official(js: SharedJeongseong) -> OfficialJeongseongOut:
        return OfficialJeongseongOut.model_validate(js, from_attributes=True)

    async def _get_official(self, jeongseong_id: uuid.UUID) -> SharedJeongseong:
        js = await self.repo.get_jeongseong(jeongseong_id)
        if js is None or js.group_id is not None:
            raise _error(status.HTTP_404_NOT_FOUND, "JEONGSEONG_NOT_FOUND")
        return js

    async def list_official(self) -> list[OfficialJeongseongOut]:
        return [self._official(js) for js in await self.repo.list_official_jeongseongs()]

    async def create_official(self, data: OfficialJeongseongInput) -> OfficialJeongseongOut:
        js = SharedJeongseong(group_id=None, **data.model_dump())
        self.repo.add(js)
        await self.repo.commit()
        return self._official(js)

    async def update_official(self, jeongseong_id: uuid.UUID, data: OfficialJeongseongInput) -> OfficialJeongseongOut:
        js = await self._get_official(jeongseong_id)
        for key, value in data.model_dump().items():
            setattr(js, key, value)
        js.updated_at = self.now_fn()
        self.repo.add(js)
        await self.repo.commit()
        return self._official(js)

    async def delete_official(self, jeongseong_id: uuid.UUID) -> None:
        await self._get_official(jeongseong_id)
        await self.repo.delete_jeongseong(jeongseong_id)
        await self.repo.commit()

    async def list_groups(self) -> list[AdminGroupItem]:
        return [
            AdminGroupItem(id=group.id, name=group.name, member_count=count, created_at=group.created_at)
            for group, count in await self.repo.list_groups_with_counts()
        ]

    async def delete_group(self, group_id: uuid.UUID) -> None:
        if await self.repo.get_group(group_id) is None:
            raise _not_found()
        await self.repo.delete_group(group_id)
        await self.repo.commit()
