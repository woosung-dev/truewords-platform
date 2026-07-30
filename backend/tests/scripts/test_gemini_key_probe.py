"""Gemini 키 probe 의 분류·조립 로직 단위 테스트.

**왜 이 테스트가 필요한가.** probe 의 실패 분기 중 라이브로 유도할 수 있는 건
일부다 — 400(잘못된 키)·예산 초과·스크립트 부재는 리허설로 재현되지만, 429
(quota 소진)·404(모델 폐기)·차원 변경·`status` 가 임의 문자열인 경우는 실제 키로
만들어낼 수 없다. 그 분기들은 여기서만 잠긴다.

SDK 를 mock 하지 않는다. 검사 대상은 예외 → 코드 → 사람이 읽는 detail 로 가는
**우리 로직**이고, 예외 객체는 실제 `google.genai.errors` 클래스로 만든다.
"""
from __future__ import annotations

import httpx
import pytest
from google.genai import errors

from scripts.gemini_key_probe import (
    EMBED_DIM,
    DimensionMismatch,
    EmptyEmbedding,
    BudgetExceeded,
    Probe,
    classify,
    compose,
    sanitize,
)

FINGERPRINT = "deadbeef"
TIER = "paid"


def _api_error(code: int, status: str) -> errors.APIError:
    """실제 SDK 예외를 만든다 — 응답 본문 형태까지 SDK 가 파싱하게 둔다."""
    return errors.APIError(code, {"error": {"code": code, "status": status, "message": "x"}})


def _ok(name: str, note: str = "") -> Probe:
    return Probe(name, True, "", 0.42, note)


def _fail(name: str, code: str) -> Probe:
    return Probe(name, False, code, 0.11, "")


# ── classify ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("code", "status", "expected"),
    [
        (400, "INVALID_ARGUMENT", "400-INVALID_ARGUMENT"),
        (403, "PERMISSION_DENIED", "403-PERMISSION_DENIED"),
        (429, "RESOURCE_EXHAUSTED", "429-RESOURCE_EXHAUSTED"),
        (404, "NOT_FOUND", "404-NOT_FOUND"),
        (503, "UNAVAILABLE", "503-UNAVAILABLE"),
    ],
)
def test_classify_api_error_keeps_code_and_status(code: int, status: str, expected: str):
    assert classify(_api_error(code, status)) == expected


def test_classify_sanitizes_non_enum_status():
    """응답이 JSON 이 아니면 SDK 가 `response.reason_phrase` 를 status 로 넣는다.

    "Bad Gateway" 처럼 공백이 든 문자열이 그대로 detail 에 들어가면
    /opt/ops-status.json 이 깨질 수 있다 (그 JSON writer 는 `"` 만 escape 한다).
    """
    code = classify(_api_error(502, "Bad Gateway"))
    assert code == "502-Bad_Gateway"
    assert " " not in code


def test_classify_api_error_without_status_falls_back_to_http_code():
    assert classify(errors.APIError(500, {})) == "http-500"


def test_classify_dimension_mismatch_reports_actual_dim():
    """HTTP 200 인데 차원이 다른 경우 — 200 만으로는 못 잡는 silent 실패."""
    assert classify(DimensionMismatch(3072)) == "dim-3072"


def test_classify_empty_embedding():
    assert classify(EmptyEmbedding()) == "embed-empty"


def test_classify_budget_exceeded_is_not_confused_with_network():
    """BudgetExceeded 가 OSError 하위면 httpx 예외 매핑에 삼켜져 network 로 오진된다."""
    assert classify(BudgetExceeded("x")) == "timeout-budget"
    assert not isinstance(BudgetExceeded("x"), OSError)


def test_classify_distinguishes_tls_from_plain_connect_failure():
    """조치가 완전히 다르다 — TLS 는 시계·CA(timedatectl), connect 는 DNS·egress."""
    plain = httpx.ConnectError("connection refused")
    assert classify(plain) == "network-connect"

    import ssl

    tls = httpx.ConnectError("handshake failed")
    tls.__cause__ = ssl.SSLCertVerificationError("cert expired")
    assert classify(tls) == "network-tls"


def test_classify_http_timeout():
    assert classify(httpx.ReadTimeout("slow")) == "timeout-http"


def test_classify_unexpected_exception_is_still_a_safe_token():
    code = classify(ValueError("boom"))
    assert code == "unexpected-ValueError"


# ── sanitize ───────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("INVALID_ARGUMENT", "INVALID_ARGUMENT"),
        ('quote"and\\slash', "quote_and_slash"),
        ("new\nline\ttab", "new_line_tab"),
        ("한글", "__"),
    ],
)
def test_sanitize_whitelists_to_ascii_alnum_dash_underscore(raw: str, expected: str):
    assert sanitize(raw) == expected


def test_sanitize_truncates():
    assert len(sanitize("x" * 100, limit=8)) == 8


# ── compose ────────────────────────────────────────────────────────────────


def test_compose_both_ok_is_ok_and_carries_observations():
    verdict, detail = compose(
        _ok("embed", f"{EMBED_DIM}d"), _ok("generate", "tok in=1/out=1/think=0"), FINGERPRINT, TIER
    )
    assert verdict == "OK"
    assert f"{EMBED_DIM}d" in detail
    assert "tok in=1" in detail
    assert f"key sha8={FINGERPRINT}" in detail
    assert "tier=paid" in detail


def test_compose_both_failed_same_code_blames_the_key_itself():
    verdict, detail = compose(
        _fail("embed", "400-INVALID_ARGUMENT"),
        _fail("generate", "400-INVALID_ARGUMENT"),
        FINGERPRINT,
        TIER,
    )
    assert verdict == "FAIL"
    assert "양쪽 동일 실패" in detail
    assert "키 자체가 무효" in detail
    # 한쪽만 죽었을 때의 문구가 새어 나오면 진단이 뒤집힌다.
    assert "키는 살아 있다" not in detail


def test_compose_both_failed_403_points_at_billing_first():
    """paid tier 의 현실적 사망 원인은 rate limit 이 아니라 청구 실패다."""
    _, detail = compose(
        _fail("embed", "403-PERMISSION_DENIED"),
        _fail("generate", "403-PERMISSION_DENIED"),
        FINGERPRINT,
        TIER,
    )
    assert "청구" in detail


def test_compose_both_failed_different_codes_reports_both():
    _, detail = compose(
        _fail("embed", "429-RESOURCE_EXHAUSTED"),
        _fail("generate", "503-UNAVAILABLE"),
        FINGERPRINT,
        TIER,
    )
    assert "양쪽 실패" in detail
    assert "429-RESOURCE_EXHAUSTED" in detail
    assert "503-UNAVAILABLE" in detail


def test_compose_generate_only_failure_says_key_is_alive():
    """이 분기가 검사 행을 하나로 합칠 수 있는 근거다 — 원인을 갈라 준다."""
    verdict, detail = compose(
        _ok("embed", f"{EMBED_DIM}d"), _fail("generate", "404-NOT_FOUND"), FINGERPRINT, TIER
    )
    assert verdict == "FAIL"
    assert "키는 살아 있다" in detail
    assert "MODEL_* 갱신" in detail
    assert "embed 는 성공" in detail


def test_compose_embed_only_failure_says_key_is_alive():
    verdict, detail = compose(
        _fail("embed", "dim-3072"), _ok("generate", "tok in=1/out=1/think=0"), FINGERPRINT, TIER
    )
    assert verdict == "FAIL"
    assert "키는 살아 있다" in detail
    assert "Qdrant" in detail
    assert "generate 는 성공" in detail


def test_compose_detail_never_contains_newline():
    """detail 은 ops-check.sh 의 표 한 칸과 JSON 한 필드에 들어간다."""
    for embed, gen in [
        (_ok("embed"), _ok("generate")),
        (_fail("embed", "400-X"), _fail("generate", "400-X")),
        (_ok("embed"), _fail("generate", "404-NOT_FOUND")),
    ]:
        _, detail = compose(embed, gen, FINGERPRINT, TIER)
        assert "\n" not in detail
        assert "\\" not in detail
