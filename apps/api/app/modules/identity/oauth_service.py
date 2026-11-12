"""OAuth 콜백의 계정 결정 — 검증된 외부 신원(ExternalIdentity)을 로그인·연결·가입으로 바꾼다.

불변식: 이메일로 계정을 찾아 병합하지 않는다. 계정 키는 (issuer, subject_scope, subject)이고, 같은 이메일의
기존 계정이 있으면 새 계정을 만들지 않고 email_exists 로 돌려보낸다(사전 계정 탈취 방지).
결과 코드는 웹 `/onboarding/done` 의 status·error 값과 같다.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError

from app.core.common.clock import utcnow
from app.modules.identity.models import User, UserIdentity
from app.modules.identity.oauth_flow import OAuthFlow
from app.modules.identity.oidc import ExternalIdentity
from app.modules.identity.repository import UserIdentityRepository, UserRepository
from app.modules.identity.service import required_invite_code

logger = logging.getLogger(__name__)

DISPLAY_NAME_MAX = 64
DISPLAY_NAME_FALLBACK = "식구"


@dataclass(frozen=True)
class OAuthOutcome:
    """status 는 성공(signed_in·created·linked), error 는 실패 코드. session_user 가 있으면 세션 쿠키를 발급한다.

    linked 는 로그인 수단이 바뀌어 session_version 이 오르므로 session_user 로 새 쿠키를 발급해 현재 브라우저를 유지한다.
    """

    status: str | None = None
    error: str | None = None
    session_user: User | None = None


def _fail(code: str) -> OAuthOutcome:
    return OAuthOutcome(error=code)


def _display_name(ext: ExternalIdentity) -> str:
    return (ext.display_name or "").strip()[:DISPLAY_NAME_MAX].strip() or DISPLAY_NAME_FALLBACK


def _new_identity(ext: ExternalIdentity) -> UserIdentity:
    now = utcnow()
    return UserIdentity(
        provider=ext.provider,
        issuer=ext.issuer,
        subject_scope=ext.subject_scope,
        subject=ext.subject,
        client_id=ext.client_id,
        email=ext.email,
        email_verified=ext.email_verified,
        created_at=now,
        last_login_at=now,
    )


def _record_verified_email(user: User, ext: ExternalIdentity) -> None:
    """권위 있는 제공자가 확인한 이메일이 계정 이메일과 같을 때만 기록한다."""
    if ext.email_authoritative and ext.email is not None and ext.email == user.email:
        user.email_verified_at = utcnow()
        user.email_verified_by = ext.issuer


class OAuthService:
    def __init__(self, users: UserRepository, identities: UserIdentityRepository) -> None:
        self.users = users
        self.identities = identities

    async def resolve(self, ext: ExternalIdentity, flow: OAuthFlow, current_user: User | None) -> OAuthOutcome:
        if not ext.email_verified:
            return _fail("email_unverified")

        identity = await self.identities.get_by_subject(ext.issuer, ext.subject_scope, ext.subject)
        if identity is not None:
            owner = await self.users.get_by_id(identity.user_id)
            if owner is not None and owner.deleted_at is None:
                return await self._existing(identity, owner, ext, flow, current_user)
            # 삭제된 계정을 가리키는 낡은 행 — 지우고 처음 보는 신원으로 계속한다.
            await self.identities.delete_and_commit(identity)

        if flow.intent == "link":
            return await self._link_new(ext, flow, current_user)
        return await self._create(ext, flow)

    async def _existing(
        self,
        identity: UserIdentity,
        owner: User,
        ext: ExternalIdentity,
        flow: OAuthFlow,
        current_user: User | None,
    ) -> OAuthOutcome:
        if flow.intent == "link":
            if current_user is None or current_user.id != flow.link_user_id:
                return _fail("session_mismatch")
            if owner.id != current_user.id:
                return _fail("already_linked")  # 다른 계정의 수단은 옮기지 않는다
            return OAuthOutcome(status="linked")
        identity.last_login_at = utcnow()
        identity.email = ext.email
        identity.email_verified = ext.email_verified
        await self.identities.save(identity)
        return OAuthOutcome(status="signed_in", session_user=owner)

    async def _link_new(self, ext: ExternalIdentity, flow: OAuthFlow, current_user: User | None) -> OAuthOutcome:
        # login CSRF 방어: 시작 때의 세션 사용자와 지금 세션이 같아야 한다.
        if current_user is None or flow.link_user_id is None or current_user.id != flow.link_user_id:
            return _fail("session_mismatch")
        # 롤백하면 current_user 가 만료돼 id 를 읽을 수 없다(MissingGreenlet) — 필요한 값은 먼저 지역 변수로 잡는다.
        current_user_id = current_user.id
        user = await self.users.get_for_update(current_user_id)
        if user is None or user.deleted_at is not None:
            return _fail("session_mismatch")
        if await self.identities.get_by_user_issuer(user.id, ext.issuer, ext.subject_scope) is not None:
            await self.users.session.rollback()  # 잠금을 푼다
            return _fail("provider_linked")
        user.password_hash = None
        user.session_version += 1  # 같은 트랜잭션에서 올려 옛 세션(다른 기기·옛 토큰)을 끊는다
        _record_verified_email(user, ext)
        try:
            await self.identities.link_to_user(user, _new_identity(ext))
        except IntegrityError:
            return await self._after_race(ext, flow, current_user_id, default_error="already_linked")
        return OAuthOutcome(status="linked", session_user=user)

    async def _create(self, ext: ExternalIdentity, flow: OAuthFlow) -> OAuthOutcome:
        assert ext.email is not None  # email_verified 이면 이메일이 있다
        # 초대 게이트가 먼저다 — 초대받지 않은 요청에 이메일 존재 여부(email_exists)를 알리지 않는다.
        if required_invite_code() is not None and not flow.invite_ok:
            return _fail("invite_required")
        if await self.users.get_by_email(ext.email) is not None:
            return _fail("email_exists")
        user = User(email=ext.email, password_hash=None, display_name=_display_name(ext))
        _record_verified_email(user, ext)
        try:
            user = await self.identities.create_user_with_identity(user, _new_identity(ext))
        except IntegrityError:
            return await self._after_race(ext, flow, None, default_error="email_exists")
        return OAuthOutcome(status="created", session_user=user)

    async def _after_race(
        self, ext: ExternalIdentity, flow: OAuthFlow, current_user_id: uuid.UUID | None, *, default_error: str
    ) -> OAuthOutcome:
        """첫 로그인 경쟁 — 롤백된 뒤 다시 조회해 다른 요청이 먼저 만든 행이 있으면 그것으로 이어간다.

        롤백으로 ORM 객체가 모두 만료되므로 사용자 객체가 아니라 id 값만 받는다.
        """
        identity = await self.identities.get_by_subject(ext.issuer, ext.subject_scope, ext.subject)
        owner = await self.users.get_by_id(identity.user_id) if identity is not None else None
        if identity is None or owner is None or owner.deleted_at is not None:
            return _fail(default_error)
        if flow.intent == "link":
            if current_user_id is not None and owner.id == current_user_id:
                # 같은 계정에 다른 요청이 먼저 연결했다 — 그 요청이 올린 session_version 으로 쿠키를 다시 발급한다.
                return OAuthOutcome(status="linked", session_user=owner)
            return _fail("already_linked")
        identity.last_login_at = utcnow()
        await self.identities.save(identity)
        return OAuthOutcome(status="signed_in", session_user=owner)
