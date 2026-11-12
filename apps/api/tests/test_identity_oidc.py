"""훈독 구글 OIDC 어댑터 단독 검증 — ID token 검증·JWKS 캐시·토큰 요청 본문·claims 매핑.

토큰·JWKS 엔드포인트는 httpx.MockTransport 이고 실제 네트워크는 호출하지 않는다.
"""

from __future__ import annotations

import hashlib
import time
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from oidc_support import (
    CLIENT_ID,
    CLIENT_SECRET,
    DROP,
    ISSUER,
    KEY,
    OTHER_KEY,
    ROTATED_KEY,
    FakeGoogle,
    forge,
    make_claims,
    sign_rs256,
)
from pydantic import SecretStr

from app.core.config import Settings
from app.modules.identity import oidc
from app.modules.identity.oidc import (
    OidcError,
    OidcProvider,
    build_login_providers,
    clear_jwks_cache,
    google_config,
    map_google_claims,
)

REDIRECT = "https://app.example.com/api/backend/hoondok/auth/oauth/google/callback"
NONCE = "nonce-abc"
VERIFIER = "verifier-xyz"


@pytest.fixture(autouse=True)
def _fresh_jwks_cache():
    clear_jwks_cache()
    yield
    clear_jwks_cache()


async def _complete(google: FakeGoogle, id_token: str, nonce: str = NONCE):
    google.id_token = id_token
    return await google.provider().complete(code="auth-code", redirect_uri=REDIRECT, code_verifier=VERIFIER, nonce=nonce)


# --- 정상 경로 --------------------------------------------------------------------


async def test_valid_token_maps_to_external_identity():
    google = FakeGoogle()
    ext = await _complete(google, sign_rs256(make_claims(NONCE, email="Person@Gmail.com")))
    assert (ext.provider, ext.issuer, ext.subject_scope, ext.subject) == ("google", ISSUER, "", "google-sub-1")
    assert ext.email == "person@gmail.com"  # 소문자 정규화
    assert ext.email_verified and ext.email_authoritative
    assert ext.display_name == "길동" and ext.client_id == CLIENT_ID


async def test_legacy_issuer_without_scheme_is_accepted_and_stored_normalized():
    google = FakeGoogle()
    ext = await _complete(google, sign_rs256(make_claims(NONCE, iss="accounts.google.com")))
    assert ext.issuer == ISSUER


async def test_token_without_azp_is_accepted():
    ext = await _complete(FakeGoogle(), sign_rs256(make_claims(NONCE, azp=DROP)))
    assert ext.subject == "google-sub-1"


# --- ID token 검증 실패 -------------------------------------------------------------


def _rejects():
    return pytest.raises(OidcError)


async def test_signature_by_unknown_key_with_known_kid_is_rejected():
    """kid 만 JWKS 의 키와 같고 서명은 다른 키로 한 토큰."""
    token = sign_rs256(make_claims(NONCE), OTHER_KEY, kid=KEY.kid)
    with _rejects():
        await _complete(FakeGoogle(), token)


async def test_hs256_signed_with_public_key_material_is_rejected():
    """알고리즘 혼동 공격 — 헤더 alg 를 따르지 않고 RS256 만 허용한다."""
    token = forge({"alg": "HS256", "typ": "JWT", "kid": KEY.kid}, make_claims(NONCE), b"x" * 32)
    with _rejects():
        await _complete(FakeGoogle(), token)


async def test_alg_none_is_rejected():
    token = forge({"alg": "none", "typ": "JWT", "kid": KEY.kid}, make_claims(NONCE))
    with _rejects():
        await _complete(FakeGoogle(), token)


async def test_missing_kid_is_rejected():
    token = forge({"alg": "RS256", "typ": "JWT"}, make_claims(NONCE), b"x")
    with _rejects():
        await _complete(FakeGoogle(), token)


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://evil.example.com"},
        {"aud": "other-client"},
        {"aud": DROP},
        {"azp": "other-client"},
        {"exp": int(time.time()) - 3600},
        {"exp": DROP},
        {"sub": DROP},
        {"iss": DROP},
        {"nonce": "different-nonce"},
        {"nonce": DROP},
    ],
    ids=["iss", "aud", "aud-missing", "azp", "expired", "exp-missing", "sub-missing", "iss-missing", "nonce", "nonce-missing"],
)
async def test_invalid_claims_are_rejected(overrides):
    with _rejects():
        await _complete(FakeGoogle(), sign_rs256(make_claims(**overrides)))


async def test_multiple_audiences_without_azp_are_rejected():
    """OIDC Core 3.1.3.7 — aud 가 둘 이상이면 azp 가 반드시 있어야 한다."""
    with _rejects():
        await _complete(FakeGoogle(), sign_rs256(make_claims(aud=[CLIENT_ID, "other-client"], azp=DROP)))


async def test_multiple_audiences_with_other_azp_are_rejected():
    with _rejects():
        await _complete(FakeGoogle(), sign_rs256(make_claims(aud=[CLIENT_ID, "other-client"], azp="other-client")))


async def test_multiple_audiences_with_our_azp_are_accepted():
    ext = await _complete(FakeGoogle(), sign_rs256(make_claims(aud=[CLIENT_ID, "other-client"], azp=CLIENT_ID)))
    assert ext.subject == "google-sub-1"


async def test_single_element_audience_list_without_azp_is_accepted():
    ext = await _complete(FakeGoogle(), sign_rs256(make_claims(aud=[CLIENT_ID], azp=DROP)))
    assert ext.subject == "google-sub-1"


async def test_token_expired_within_clock_leeway_is_still_accepted():
    ext = await _complete(FakeGoogle(), sign_rs256(make_claims(NONCE, exp=int(time.time()) - 10)))
    assert ext.subject == "google-sub-1"


async def test_garbage_id_token_is_rejected():
    with _rejects():
        await _complete(FakeGoogle(), "not-a-jwt")


async def test_error_messages_do_not_contain_token_or_email():
    token = sign_rs256(make_claims(nonce="wrong", email="secret.person@gmail.com"))
    with _rejects() as exc:
        await _complete(FakeGoogle(), token)
    text = str(exc.value) + repr(exc.value)
    assert token not in text and "secret.person" not in text


# --- 토큰 엔드포인트 -------------------------------------------------------------------


async def test_token_request_body_has_verifier_fixed_redirect_uri_and_client_credentials():
    google = FakeGoogle()
    await _complete(google, sign_rs256(make_claims(NONCE)))
    assert len(google.token_calls) == 1
    body = google.token_calls[0]
    assert body["grant_type"] == ["authorization_code"]
    assert body["code"] == ["auth-code"]
    assert body["code_verifier"] == [VERIFIER]
    assert body["redirect_uri"] == [REDIRECT]
    assert body["client_id"] == [CLIENT_ID] and body["client_secret"] == [CLIENT_SECRET]
    token_request = next(r for r in google.requests if r.url.host == "oauth2.googleapis.com")
    assert token_request.method == "POST"
    assert "code" not in token_request.url.query.decode()  # 쿼리가 아니라 본문으로만 보낸다


@pytest.mark.parametrize("status", [400, 401, 500])
async def test_token_endpoint_error_status_is_rejected_without_jwks_fetch(status):
    google = FakeGoogle(token_status=status)
    with _rejects():
        await _complete(google, "ignored")
    assert google.jwks_calls == 0


async def test_token_endpoint_unreachable_is_wrapped():
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    provider = OidcProvider(google_config(CLIENT_ID, SecretStr(CLIENT_SECRET)), map_google_claims, transport=httpx.MockTransport(boom))
    with _rejects():
        await provider.complete(code="c", redirect_uri=REDIRECT, code_verifier=VERIFIER, nonce=NONCE)


@pytest.mark.parametrize("payload", [{}, {"id_token": ""}, {"id_token": 123}, ["x"]], ids=["absent", "empty", "non-str", "non-dict"])
async def test_token_response_without_usable_id_token_is_rejected(payload):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    provider = OidcProvider(google_config(CLIENT_ID, SecretStr(CLIENT_SECRET)), map_google_claims, transport=httpx.MockTransport(handler))
    with _rejects():
        await provider.complete(code="c", redirect_uri=REDIRECT, code_verifier=VERIFIER, nonce=NONCE)


# --- JWKS 캐시 --------------------------------------------------------------------------


async def test_jwks_is_cached_across_verifications():
    google = FakeGoogle()
    for _ in range(3):
        await _complete(google, sign_rs256(make_claims(NONCE)))
    assert google.jwks_calls == 1


async def test_unknown_kid_refetches_jwks_exactly_once_then_fails():
    google = FakeGoogle()
    await _complete(google, sign_rs256(make_claims(NONCE)))  # 캐시 채움
    assert google.jwks_calls == 1
    rogue = sign_rs256(make_claims(NONCE), OTHER_KEY)  # kid-other 는 JWKS 에 없다
    with _rejects():
        await _complete(google, rogue)
    assert google.jwks_calls == 2  # 1회만 재조회


async def test_unknown_kid_on_cold_cache_fetches_only_once():
    google = FakeGoogle()
    with _rejects():
        await _complete(google, sign_rs256(make_claims(NONCE), OTHER_KEY))
    assert google.jwks_calls == 1


async def test_key_rotation_is_picked_up_by_one_refetch():
    google = FakeGoogle()
    await _complete(google, sign_rs256(make_claims(NONCE)))
    google.keys = [ROTATED_KEY]  # 구글이 키를 교체
    ext = await _complete(google, sign_rs256(make_claims(NONCE), ROTATED_KEY))
    assert ext.subject == "google-sub-1"
    assert google.jwks_calls == 2


async def test_stale_jwks_is_refetched_after_ttl(monkeypatch):
    google = FakeGoogle()
    await _complete(google, sign_rs256(make_claims(NONCE)))
    real = time.monotonic()
    monkeypatch.setattr(oidc.time, "monotonic", lambda: real + oidc.JWKS_TTL_SECONDS + 1)
    await _complete(google, sign_rs256(make_claims(NONCE)))
    assert google.jwks_calls == 2


async def test_jwks_fetch_failure_is_wrapped():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"id_token": sign_rs256(make_claims(NONCE))})
        return httpx.Response(503)

    provider = OidcProvider(google_config(CLIENT_ID, SecretStr(CLIENT_SECRET)), map_google_claims, transport=httpx.MockTransport(handler))
    with _rejects():
        await provider.complete(code="c", redirect_uri=REDIRECT, code_verifier=VERIFIER, nonce=NONCE)


# --- authorization_url ------------------------------------------------------------------


def test_authorization_url_has_pkce_s256_state_nonce_fixed_redirect_and_select_account():
    verifier = "v" * 43
    challenge = hashlib.sha256(verifier.encode()).digest()
    import base64

    expected = base64.urlsafe_b64encode(challenge).rstrip(b"=").decode()
    url = FakeGoogle().provider().authorization_url(redirect_uri=REDIRECT, state="st", nonce="nn", code_challenge=expected)
    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == "https://accounts.google.com/o/oauth2/v2/auth"
    q = {k: v[0] for k, v in parse_qs(parts.query).items()}
    assert q["response_type"] == "code" and q["client_id"] == CLIENT_ID
    assert q["redirect_uri"] == REDIRECT and q["state"] == "st" and q["nonce"] == "nn"
    assert q["code_challenge"] == expected and q["code_challenge_method"] == "S256"
    assert q["prompt"] == "select_account" and q["scope"] == "openid email profile"
    assert "client_secret" not in q


# --- claims 매핑: email_authoritative ---------------------------------------------------------


def _map(**claims):
    base = {"sub": "s", "email": "a@gmail.com", "email_verified": True}
    return map_google_claims({**base, **claims}, google_config(CLIENT_ID, SecretStr(CLIENT_SECRET)))


def test_authoritative_for_gmail():
    assert _map(email="Someone@Gmail.COM").email_authoritative is True


def test_authoritative_for_workspace_domain_with_hd_claim():
    assert _map(email="staff@church.example", hd="church.example").email_authoritative is True


def test_not_authoritative_when_hd_does_not_match_email_domain():
    """hd 클레임이 있어도 이메일 도메인이 hd 와 다르면 그 도메인의 소유를 보증하지 않는다."""
    assert _map(email="staff@church.example", hd="other.example").email_authoritative is False
    assert _map(email="staff@sub.church.example", hd="church.example").email_authoritative is False
    assert _map(email="staff@church.example", hd="").email_authoritative is False
    assert _map(email="staff@church.example", hd=123).email_authoritative is False


def test_hd_comparison_is_case_insensitive():
    assert _map(email="Staff@Church.Example", hd="CHURCH.example").email_authoritative is True


def test_not_authoritative_for_other_domain_without_hd():
    ext = _map(email="me@naver.com")
    assert ext.email_verified is True and ext.email_authoritative is False


def test_unverified_email_is_never_authoritative():
    ext = _map(email_verified=False)
    assert ext.email_verified is False and ext.email_authoritative is False
    assert _map(email="x@church.example", hd="church.example", email_verified=False).email_authoritative is False


def test_missing_email_gives_unverified_identity():
    ext = map_google_claims({"sub": "s", "email_verified": True}, google_config(CLIENT_ID, SecretStr(CLIENT_SECRET)))
    assert ext.email is None and ext.email_verified is False and ext.email_authoritative is False


def test_email_verified_string_true_is_accepted():
    assert _map(email_verified="true").email_verified is True


def test_display_name_prefers_given_name_then_name_then_none():
    assert _map(given_name="길동", name="홍길동").display_name == "길동"
    assert _map(name="홍길동").display_name == "홍길동"
    assert _map().display_name is None


# --- build_login_providers -----------------------------------------------------------------------


def test_build_login_providers_only_when_google_configured():
    assert build_login_providers(Settings(hoondok_google_client_id=None, hoondok_google_client_secret=None)) == {}
    assert build_login_providers(Settings(hoondok_google_client_id=" ", hoondok_google_client_secret=SecretStr("s"))) == {}
    assert build_login_providers(Settings(hoondok_google_client_id="cid", hoondok_google_client_secret=SecretStr(" "))) == {}
    providers = build_login_providers(
        Settings(hoondok_google_client_id=" cid ", hoondok_google_client_secret=SecretStr(" sec "))
    )
    assert set(providers) == {"google"}
    assert providers["google"].config.client_id == "cid"  # type: ignore[attr-defined]
    assert providers["google"].config.client_secret.get_secret_value() == "sec"  # type: ignore[attr-defined]
