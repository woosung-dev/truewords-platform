# 비로그인 익명 세션 쿠키(tw_anon_session) 발급/조회 공용 헬퍼
"""반응(MessageReaction) 과 피드백(AnswerFeedback) 이 공유하는 익명 세션 식별.

B2 보안 (Cross-review Codex + Sonnet 합의): user_session_id 를 서버가 HttpOnly
cookie 로만 발급/관리한다. 클라이언트 임의 입력 → fingerprint 스팸 차단.
"""

from __future__ import annotations

import secrets

from fastapi import Request, Response

from src.config import settings

# HttpOnly cookie 이름. 비로그인 익명 세션 식별용.
ANON_SESSION_COOKIE = "tw_anon_session"
ANON_SESSION_MAX_AGE = 60 * 60 * 24 * 365  # 1 year


def get_or_issue_session_id(request: Request, response: Response) -> str:
    """anon session id 를 cookie 에서 읽거나 새로 발급해서 Set-Cookie."""
    existing = request.cookies.get(ANON_SESSION_COOKIE)
    if existing and 16 <= len(existing) <= 128:
        return existing
    new_id = secrets.token_urlsafe(24)  # 32 chars URL-safe
    response.set_cookie(
        ANON_SESSION_COOKIE,
        new_id,
        max_age=ANON_SESSION_MAX_AGE,
        httponly=True,
        secure=getattr(settings, "cookie_secure", False),
        samesite="lax",
    )
    return new_id
