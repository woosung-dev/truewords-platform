"""훈독 함께 읽는 모임 라우터 — API-HD-030~041 (PLAN-HD-010). 쿠키 hoondok_token, 변경은 verify_csrf.

비모임원에게는 모든 모임 라우트가 404 다(GroupService 가 판정). 초대 코드 라우트(035·036)는 IP 기준 limiter 를 먼저 건다.
"""

import uuid

from fastapi import APIRouter, Depends, status

from app.modules.hoondok.dependencies import check_invite_join_limit, check_invite_preview_limit, get_group_service
from app.modules.hoondok.groups_schemas import (
    DisplayNameInput,
    GroupCreate,
    GroupDetail,
    GroupJeongseongInput,
    GroupJeongseongOut,
    GroupMe,
    GroupRename,
    GroupShareOut,
    InviteOut,
    InvitePreview,
    JoinResult,
    MemberList,
    MyGroupItem,
    ReactionState,
    ShareInput,
)
from app.modules.hoondok.groups_service import GroupService
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok-groups"])

_CSRF = [Depends(verify_csrf)]
_NO_CONTENT = status.HTTP_204_NO_CONTENT


@router.get("/me/groups", response_model=list[MyGroupItem])
async def list_my_groups(
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> list[MyGroupItem]:
    """API-HD-030 내 모임. 0건이면 []. 401 미인증."""
    return await service.list_my_groups(user.id)


@router.post("/groups", response_model=GroupDetail, status_code=status.HTTP_201_CREATED, dependencies=_CSRF)
async def create_group(
    data: GroupCreate,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupDetail:
    """API-HD-031 모임 만들기 → 201 상세 + invite_code. 409 LEADER_LIMIT·JOIN_LIMIT, 422 검증."""
    return await service.create_group(user.id, data)


@router.get("/groups/{group_id}", response_model=GroupDetail)
async def get_group(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupDetail:
    """API-HD-032 모임 상세 — 오늘 완료자만. 전체 인원 없음. 404 비모임원."""
    return await service.get_detail(user.id, group_id)


@router.patch("/groups/{group_id}", response_model=GroupDetail, dependencies=_CSRF)
async def rename_group(
    group_id: uuid.UUID,
    data: GroupRename,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupDetail:
    """API-HD-033 모임 이름 변경(리더). 403 LEADER_ONLY, 404 비모임원."""
    return await service.rename(user.id, group_id, data.name)


@router.delete("/groups/{group_id}", status_code=_NO_CONTENT, dependencies=_CSRF)
async def delete_group(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> None:
    """API-HD-033 모임 하드 삭제(리더) → 204."""
    await service.delete_group(user.id, group_id)


@router.post("/groups/{group_id}/invite", response_model=InviteOut, dependencies=_CSRF)
async def regenerate_invite(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> InviteOut:
    """API-HD-034 초대 코드 새로 만들기(리더). 이전 코드는 즉시 무효, 만료 30일."""
    return await service.regenerate_invite(user.id, group_id)


@router.get(
    "/invites/{code}",
    response_model=InvitePreview,
    dependencies=[Depends(check_invite_preview_limit)],
)
async def preview_invite(
    code: str,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> InvitePreview:
    """API-HD-035 초대 미리보기. 잘못·만료·정원 초과는 같은 404 INVITE_NOT_FOUND. 429 limiter."""
    return await service.preview_invite(user.id, code)


@router.post(
    "/invites/{code}/join",
    response_model=JoinResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(check_invite_join_limit), Depends(verify_csrf)],
)
async def join_group(
    code: str,
    data: DisplayNameInput,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> JoinResult:
    """API-HD-036 참여 → 201. 404 INVITE_NOT_FOUND · 409 ALREADY_MEMBER·DISPLAY_NAME_TAKEN·GROUP_FULL·JOIN_LIMIT."""
    return await service.join(user.id, code, data.display_name)


@router.patch("/groups/{group_id}/me", response_model=GroupMe, dependencies=_CSRF)
async def update_my_name(
    group_id: uuid.UUID,
    data: DisplayNameInput,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupMe:
    """API-HD-037 모임에서 쓰는 내 이름 변경. 409 DISPLAY_NAME_TAKEN."""
    return await service.update_my_name(user.id, group_id, data.display_name)


@router.delete("/groups/{group_id}/me", status_code=_NO_CONTENT, dependencies=_CSRF)
async def leave_group(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> None:
    """API-HD-037 나가기. 리더는 다른 식구가 있으면 409 LEADER_MUST_HANDOVER, 혼자면 모임 삭제."""
    await service.leave(user.id, group_id)


@router.get("/groups/{group_id}/members", response_model=MemberList)
async def list_members(
    group_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> MemberList:
    """API-HD-038 식구 목록(리더) — member_count 는 여기만. 읽음 상태 없음."""
    return await service.list_members(user.id, group_id)


@router.delete("/groups/{group_id}/members/{member_id}", status_code=_NO_CONTENT, dependencies=_CSRF)
async def remove_member(
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> None:
    """API-HD-038 식구 내보내기(리더). 자기 자신 409 CANNOT_REMOVE_SELF, 404 MEMBER_NOT_FOUND."""
    await service.remove_member(user.id, group_id, member_id)


@router.post(
    "/groups/{group_id}/jeongseongs",
    response_model=GroupJeongseongOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=_CSRF,
)
async def add_jeongseong(
    group_id: uuid.UUID,
    data: GroupJeongseongInput,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupJeongseongOut:
    """API-HD-039 모임 정성 추가(리더). 409 JEONGSEONG_LIMIT, 422 STARTED_ON_OUT_OF_RANGE."""
    return await service.add_jeongseong(user.id, group_id, data)


@router.delete("/groups/{group_id}/jeongseongs/{jeongseong_id}", status_code=_NO_CONTENT, dependencies=_CSRF)
async def delete_jeongseong(
    group_id: uuid.UUID,
    jeongseong_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> None:
    """API-HD-039 모임 정성 삭제(리더). 공식 정성은 404."""
    await service.delete_jeongseong(user.id, group_id, jeongseong_id)


@router.put("/groups/{group_id}/shares/today", response_model=GroupShareOut, dependencies=_CSRF)
async def put_today_share(
    group_id: uuid.UUID,
    data: ShareInput,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> GroupShareOut:
    """API-HD-040 오늘의 한 줄 저장(덮어쓰기). 오늘 훈독 전이면 409 READ_REQUIRED."""
    return await service.put_today_share(user.id, group_id, data.body)


@router.delete("/groups/{group_id}/shares/{share_id}", status_code=_NO_CONTENT, dependencies=_CSRF)
async def delete_share(
    group_id: uuid.UUID,
    share_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> None:
    """API-HD-040 한 줄 삭제 — 작성자 또는 리더. 그 외 403 NOT_ALLOWED."""
    await service.delete_share(user.id, group_id, share_id)


@router.put("/groups/{group_id}/shares/{share_id}/reaction", response_model=ReactionState, dependencies=_CSRF)
async def react_share(
    group_id: uuid.UUID,
    share_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> ReactionState:
    """API-HD-041 "함께 머물렀어요" 켜기(멱등). 자기 한 줄 409 OWN_SHARE."""
    return await service.react(user.id, group_id, share_id)


@router.delete("/groups/{group_id}/shares/{share_id}/reaction", response_model=ReactionState, dependencies=_CSRF)
async def unreact_share(
    group_id: uuid.UUID,
    share_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: GroupService = Depends(get_group_service),
) -> ReactionState:
    """API-HD-041 반응 끄기(멱등)."""
    return await service.unreact(user.id, group_id, share_id)
