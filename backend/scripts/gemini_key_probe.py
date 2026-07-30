"""운영 Gemini API 키 생존 확인 — `ops-check.sh` 의 `gemini-key` 항목이 호출한다.

── 왜 필요한가 ────────────────────────────────────────────────────────────
Gemini 는 이 서비스의 **유일한 외부 의존**이다. 키가 회수되거나 청구가 막히면
챗봇만 죽는다. Postgres·Qdrant·컨테이너·디스크는 전부 정상이고 `/health` 도 200
이라 기존 6개 불변식 어디에도 걸리지 않는다. `GEMINI_TIER=paid` 라 현실적 사망
원인은 rate limit 이 아니라 **청구 실패** — GHA 를 5일간 조용히 죽인 것과 같은
계정 레벨 실패이고, 그건 429 가 아니라 403 으로 온다. 그래서 코드를 갈라 본다.

운영 키의 소유 프로젝트가 직관에 어긋난다는 점도 이 검사의 존재 이유다.
상세: `infra/oracle-vm/.env.example` 의 GEMINI_API_KEY 경고.

── 왜 generateContent 하나로는 부족한가 ───────────────────────────────────
채팅은 semantic-cache 히트여도 **매 요청 embed_content 를 부른다**
(`src/chat/service.py` Stage 순서가 Embedding → CacheCheck). 임베딩만 죽어도
채팅은 100% 실패한다. generateContent 만 찔러보면 초록인데 챗봇은 죽어 있다.

두 surface 를 **한쪽이 실패해도 나머지까지** 호출한다. 어느 쪽이 살아 있는지가
원인을 갈라 주기 때문이다 — `ops-check.sh` 의 `backup-remote` 가 로컬 상태를 함께
봐서 "업로드만 실패" 와 "백업 자체 실패" 를 구분하는 것과 같은 원칙이다. 여기서
멈추면 검사 행이 하나인 이유가 사라진다.

── 무엇을 healthy 로 보는가 ───────────────────────────────────────────────
HTTP 성공 여부만 본다. **응답 텍스트는 판정에 쓰지 않는다.** thinking 모델은
200 + finish_reason=MAX_TOKENS + 빈 parts 로 답할 수 있고, 그때 SDK 의
`response.text` 는 예외가 아니라 None 이다 (`types.GenerateContentResponse
._get_text`). 텍스트로 판정하면 살아 있는 키를 죽었다고 말한다.

임베딩만 예외로 **차원까지** 본다. 1536 이 아닌 벡터가 오면 HTTP 200 이어도
Qdrant 검색·적재가 전부 깨져 챗봇이 죽는다. 200 만으로는 못 잡는 유일한 silent
실패다.

── 왜 요청에 아무 옵션도 더하지 않는가 ────────────────────────────────────
`max_output_tokens` / `thinking_config` 를 넣지 않는다. 운영 `generate_text`
(`src/common/gemini.py`) 가 보내지 않는 필드다. gemini-3.5 계열은
`thinking_budget` 대신 `thinking_level` 을 받으므로 `thinking_budget=0` 은 400
INVALID_ARGUMENT 가 될 수 있고, 그러면 이 검사는 **정상인 키를 "무효" 로 보고**
한다. 경보를 못 믿게 만드는 게 검사가 없는 것보다 나쁘다.

  규칙: probe 요청은 운영이 매일 성공시키는 요청의 **부분집합**이어야 한다.

대신 usage_metadata 로 실제 소비 토큰을 찍는다. 며칠 로그를 보고 근거를 갖고
줄인다 (지금 줄이는 건 추측이다).

── 재시도를 SDK 에 맡기지 않는 이유 ───────────────────────────────────────
SDK 의 재시도 술어는 `isinstance(e, errors.APIError) and e.code in
retriable_codes` 다 (`_api_client.retry_args`). 즉 **transport 예외
(DNS/TCP/TLS/ReadTimeout)는 어느 정책에서도 재시도되지 않는다.** VM egress 가 한
번 흔들리면 ops-check 가 빨개지고, 그런 경보는 곧 무시된다. 반대로 SDK 의 5xx
재시도는 attempts=5 기본이라 전체 소요를 예산으로 계산할 수 없다.

그래서 **정책을 한 곳에 모은다** — per-request `attempts=1` 로 SDK 재시도를
중립화하고 재시도는 `_with_retry` 에서만 한다. 그러면 최악 소요가 산수가 된다:

    import                       ≈ 2.7s   (컨테이너 실측 — 예산에 포함된다)
    embed    2 × 8s  + 2s        = 18s
    generate 2 × 12s + 2s        = 26s
                                 ─────────
                                   46.7s  < 기본 예산 50s

예산을 이보다 짧게 주면 import 단계에서 먼저 터지므로, 그 경우를 별도 분기로
진단한다 (main() 의 import 가드). 원인이 다르면 조치도 달라야 한다.

`get_client(retry_429=False)` 는 계속 쓴다. 재시도 정책 때문이 아니라
`gemini_client.py` 가 존재하는 이유 자체가 "분산된 `genai.Client(...)` 초기화를
한 팩토리로 일원화" 이기 때문이다. 4번째 생성 지점을 만들면 그 결정을 깨뜨린다.
429 를 재시도하지 않는 건 의도다 — 그게 우리가 찾는 신호다.

── 출력 규약 ──────────────────────────────────────────────────────────────
stdout 에 **접두사로 찾는** 한 줄을 낸다. "마지막 줄" 이 아니다 — 진단 출력이나
SDK 로그가 뒤에 붙을 수 있다.

    GEMINI_PROBE verdict=OK|FAIL detail=<개행 없는 한 줄>

detail 은 **전부 우리가 조립한 문자열**이다. Google 원문 메시지는 절대 넣지
않는다 — `/opt/ops-status.json` 은 `"` 만 escape 하고 `~/truewords-cron.log` 는
평문이다.

`logging.basicConfig` 를 부르지 않는다. 켜면 tenacity `before_sleep_log` 가
stderr 를 오염시킨다.

**비-목표**: `generate_content_stream` 은 찌르지 않는다. 운영 채팅은 스트리밍
이지만 스트림만 깨지는 건 SDK 문제이지 키 실패가 아니다. 커버리지를 오해하지
않도록 적어 둔다.

사용:
    sudo docker compose --env-file .env exec -T backend python scripts/gemini_key_probe.py
    cd backend && uv run python scripts/gemini_key_probe.py

    # 실패 경로 리허설 — 실제 키를 건드리지 않는다 (400 은 과금·quota 소모 없음)
    sudo docker compose --env-file .env exec -T \
      -e GEMINI_API_KEY=invalid-key-for-drill backend python scripts/gemini_key_probe.py
    # ↑ 출력의 `key sha8` 이 정상 실행과 **달라야** 한다. 같으면 -e 가 먹지 않은
    #   것이고 그 리허설은 아무것도 검증하지 않았다.

종료 코드:
    0  두 surface 모두 정상
    1  하나 이상 실패 (분류는 detail)

상세 ADR: docs/dev-log/2026-07-30-silent-scheduled-job-failure.md
"""
from __future__ import annotations

import argparse
import hashlib
import signal
import ssl
import sys
import time
from pathlib import Path
from typing import Any, Callable, NamedTuple

# scripts/ 에서 src/* import 가능하도록 backend/ 를 sys.path 에 추가. **필수다.**
# pyproject 에 [build-system] 이 없어 uv.lock 이 이 프로젝트를
# `source = { virtual = "." }` 로 잡는다 → `uv sync` 가 src 를 site-packages 에
# 설치하지 않는다. `python scripts/x.py` 의 sys.path[0] 은 scripts/ 이므로 이 줄이
# 없으면 ModuleNotFoundError: No module named 'src'.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

SENTINEL = "GEMINI_PROBE"

# src/common/gemini.py 의 embed_dense_query output_dimensionality 와 같아야 한다.
# (상수가 gemini.py / pipeline/embedder.py 에 흩어져 있다 — 추출은 별도 트리거.)
EMBED_DIM = 1536

# 재시도 대상. 429 는 **일부러 제외** — 그게 우리가 찾는 신호다.
RETRIABLE_STATUS = (408, 500, 502, 503, 504)
ATTEMPTS = 2  # 최초 + 1회. transient 5xx/DNS 한 번을 흡수하고 멈춘다.
RETRY_SLEEP_S = 2.0

# 시도별 HTTP timeout(ms). 운영 cutoff(gemini_generate_timeout_seconds=30) 보다
# 엄격하다 — 의도다. 15초 걸려 답하는 챗봇을 "살아 있다" 고 부르지 않는다.
GEN_TIMEOUT_MS = 12_000
EMBED_TIMEOUT_MS = 8_000


class BudgetExceeded(RuntimeError):
    """전체 wall-clock 예산 초과.

    OSError 를 상속하지 않는다. TimeoutError(=OSError 하위)로 두면 httpx/httpcore
    의 예외 매핑이 이걸 붙잡아 ConnectError 류로 바꿔치기할 수 있고, 그러면
    "예산 초과" 가 "network" 로 오진된다.
    """


class DimensionMismatch(RuntimeError):
    def __init__(self, actual: int) -> None:
        super().__init__(f"dim {actual}")
        self.actual = actual


class EmptyEmbedding(RuntimeError):
    """HTTP 200 인데 벡터가 비어 있다."""


class Probe(NamedTuple):
    name: str  # "embed" | "generate"
    ok: bool
    code: str  # 실패 시 화이트리스트 분류 코드, 성공 시 ""
    seconds: float
    note: str  # 관측값 (차원 / 토큰)


def sanitize(value: Any, limit: int = 32) -> str:
    """외부 문자열을 detail 에 넣기 전 화이트리스트 통과.

    두 가지 이유로 필요하다. (1) `/opt/ops-status.json` 은 detail 의 `"` 만
    escape 한다 — 역슬래시·개행이 섞이면 JSON 이 깨진다. (2) `APIError.status` 는
    항상 INVALID_ARGUMENT 같은 enum 이 아니다. 응답이 JSON 이 아니면 SDK 가
    `response.reason_phrase` 를 status 로 넣으므로 (`errors.APIError
    .raise_for_response`) "Bad Gateway" 같은 공백 포함 임의 문자열이 올 수 있다.
    """
    text = str(value)[:limit]
    return "".join(
        c if (c.isascii() and (c.isalnum() or c in "_-")) else "_" for c in text
    )


def _emit(verdict: str, detail: str) -> None:
    """판정 한 줄. `' '.join(split())` 로 개행·탭을 물리적으로 제거한다."""
    print(f"{SENTINEL} verdict={verdict} detail={' '.join(detail.split())}", flush=True)


def _has_ssl_cause(exc: BaseException) -> bool:
    """ConnectError 안에 TLS 실패가 있나 — 조치가 DNS 와 완전히 다르다(시계/CA)."""
    cur: BaseException | None = exc
    for _ in range(5):
        if isinstance(cur, ssl.SSLError):
            return True
        cur = cur.__cause__ or cur.__context__
        if cur is None:
            break
    return False


def classify(exc: BaseException) -> str:
    """예외 → 화이트리스트 코드. Google 원문 메시지는 절대 반환하지 않는다."""
    import httpx
    from google.genai import errors

    if isinstance(exc, BudgetExceeded):
        return "timeout-budget"
    if isinstance(exc, DimensionMismatch):
        return f"dim-{exc.actual}"
    if isinstance(exc, EmptyEmbedding):
        return "embed-empty"
    if isinstance(exc, errors.APIError):
        code = getattr(exc, "code", 0) or 0
        status = sanitize(getattr(exc, "status", None) or "")
        return f"{code}-{status}" if status else f"http-{code}"
    if isinstance(exc, httpx.TimeoutException):
        return "timeout-http"
    if isinstance(exc, httpx.ConnectError):
        return "network-tls" if _has_ssl_cause(exc) else "network-connect"
    if isinstance(exc, httpx.TransportError):
        return f"network-{sanitize(type(exc).__name__)}"
    return f"unexpected-{sanitize(type(exc).__name__)}"


def _retriable(exc: BaseException) -> bool:
    import httpx
    from google.genai import errors

    if isinstance(exc, BudgetExceeded):
        return False
    if isinstance(exc, httpx.TransportError):
        # SDK 는 transport 예외를 절대 재시도하지 않는다. DNS 한 번 흔들려
        # ops-check 가 빨개지는 걸 여기서 막는다.
        return True
    return isinstance(exc, errors.APIError) and getattr(exc, "code", 0) in RETRIABLE_STATUS


def _with_retry(call: Callable[[], Any], deadline: float) -> Any:
    for attempt in range(1, ATTEMPTS + 1):
        if time.monotonic() >= deadline:
            raise BudgetExceeded("deadline passed")
        try:
            return call()
        except Exception as exc:  # noqa: BLE001 — 분류는 호출자가 한다
            if attempt == ATTEMPTS or not _retriable(exc):
                raise
            time.sleep(RETRY_SLEEP_S)
    raise AssertionError("unreachable")


def _http_options(timeout_ms: int) -> Any:
    """per-request HttpOptions. timeout 은 밀리초 단위.

    attempts=1 로 SDK 재시도를 중립화한다 — 재시도는 `_with_retry` 한 곳에서만.
    `patch_http_options` 는 None 이 아닌 필드만 덮으므로 client 설정은 남는다.
    """
    from google.genai import types

    return types.HttpOptions(
        timeout=timeout_ms,
        retry_options=types.HttpRetryOptions(attempts=1),
    )


def probe_embed(client: Any, model: str, deadline: float) -> Probe:
    from google.genai import types

    started = time.monotonic()
    try:

        def call() -> Any:
            # embed_dense_query 와 동일한 인자. 운영이 매일 성공시키는 요청이다.
            return client.models.embed_content(
                model=model,
                contents="ping",
                config=types.EmbedContentConfig(
                    task_type="RETRIEVAL_QUERY",
                    output_dimensionality=EMBED_DIM,
                    http_options=_http_options(EMBED_TIMEOUT_MS),
                ),
            )

        response = _with_retry(call, deadline)
        embeddings = response.embeddings or []
        if not embeddings or not embeddings[0].values:
            raise EmptyEmbedding()
        dim = len(embeddings[0].values)
        if dim != EMBED_DIM:
            # HTTP 200 이지만 챗봇은 죽는다 — Qdrant 차원 불일치.
            raise DimensionMismatch(dim)
        return Probe("embed", True, "", time.monotonic() - started, f"{dim}d")
    except Exception as exc:  # noqa: BLE001
        return Probe("embed", False, classify(exc), time.monotonic() - started, "")


def probe_generate(client: Any, model: str, deadline: float) -> Probe:
    from google.genai import types

    started = time.monotonic()
    try:

        def call() -> Any:
            # 운영 generate_text 와 같은 최소 요청. max_output_tokens /
            # thinking_config 를 넣지 않는 이유는 모듈 docstring 참조.
            return client.models.generate_content(
                model=model,
                contents="ping",
                config=types.GenerateContentConfig(
                    http_options=_http_options(GEN_TIMEOUT_MS)
                ),
            )

        response = _with_retry(call, deadline)
        # 판정은 예외 부재(= HTTP 성공)로 이미 끝났다. 아래는 관측값일 뿐이다.
        usage = response.usage_metadata
        note = (
            "tok=?"
            if usage is None
            else (
                f"tok in={usage.prompt_token_count or 0}"
                f"/out={usage.candidates_token_count or 0}"
                f"/think={usage.thoughts_token_count or 0}"
            )
        )
        return Probe("generate", True, "", time.monotonic() - started, note)
    except Exception as exc:  # noqa: BLE001
        return Probe("generate", False, classify(exc), time.monotonic() - started, "")


def _hint_both(code: str) -> str:
    if code.startswith("400"):
        return (
            "키 자체가 무효(회수/삭제)일 가능성이 가장 높다 — 키 소유 GCP 프로젝트 확인. "
            "infra/oracle-vm/.env.example 의 경고 참조"
        )
    if code.startswith(("401", "403")):
        return (
            "키 권한 / API 비활성 / **청구 중단**. GEMINI_TIER=paid 이므로 청구를 먼저 "
            "본다 — GHA 를 5일간 죽인 것과 같은 실패 모드다"
        )
    if code.startswith("429"):
        return "quota 소진. paid tier 면 rate limit 보다 청구 문제를 먼저 본다"
    if code.startswith("network"):
        return (
            "VM egress/DNS 문제 — generativelanguage.googleapis.com 도달 확인. "
            "network-tls 면 시계·CA 확인 (timedatectl)"
        )
    if code.startswith("timeout"):
        return "Gemini 가 시간 안에 응답하지 않았다. 챗봇도 같은 이유로 503 이다"
    return "위 코드로 Gemini 상태 확인"


def _hint_one(bad: Probe) -> str:
    if bad.code.startswith("dim-"):
        return (
            "HTTP 는 200 인데 차원이 다르다 — Qdrant 검색·적재가 전부 깨진다. "
            "output_dimensionality 지원 변경 확인"
        )
    if bad.code.startswith("404"):
        return f"{bad.name} 모델 ID 가 사라졌다 — src/common/gemini.py 의 MODEL_* 갱신 필요"
    if bad.code.startswith("429"):
        return f"{bad.name} 쪽 quota 만 소진됐다 (모델별 한도)"
    if bad.code == "not-run-budget":
        return "예산을 다 써서 호출조차 못 했다 — 앞 surface 가 느렸다"
    return f"{bad.name} surface 만 실패 — 해당 모델·요청 인자 확인"


def compose(embed: Probe, gen: Probe, fingerprint: str, tier: str) -> tuple[str, str]:
    """두 probe → (verdict, detail).

    한쪽만 실패한 경우를 따로 말하는 게 이 함수의 핵심이다 — `backup-remote` 가
    로컬 상태를 함께 봐서 원인을 갈라 주는 것과 같다. 검사 행을 하나로 합칠 수
    있는 근거가 여기에 있다.
    """
    tail = f"key sha8={fingerprint} · tier={sanitize(tier, 8)}"
    if embed.ok and gen.ok:
        return "OK", (
            f"embed {embed.seconds:.2f}s·{embed.note} · "
            f"generate {gen.seconds:.2f}s·{gen.note} · {tail}"
        )
    if not embed.ok and not gen.ok:
        cause = (
            f"양쪽 동일 실패 {embed.code}"
            if embed.code == gen.code
            else f"양쪽 실패 (embed {embed.code} · generate {gen.code})"
        )
        return "FAIL", f"{cause} — {_hint_both(embed.code)} · {tail}"
    bad, good = (embed, gen) if not embed.ok else (gen, embed)
    return "FAIL", (
        f"{bad.name} {bad.code} · {good.name} 는 성공({good.seconds:.2f}s) — "
        f"**키는 살아 있다.** {_hint_one(bad)} · {tail}"
    )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--budget-seconds",
        type=int,
        default=50,
        help="전체 wall-clock 상한 (SIGALRM). 최악 소요 44s + 여유. 기본 50",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    def on_alarm(signum: int, frame: Any) -> None:
        raise BudgetExceeded("budget exceeded")

    signal.signal(signal.SIGALRM, on_alarm)
    # 하한 1 — alarm(0) 은 타이머를 **취소**하므로 0·음수를 그대로 넘기면 예산이
    # 조용히 사라진다. 하한을 2 로 두면 `--budget-seconds 1` 리허설이 정상 소요
    # (~1.2s) 안에 끝나 버려 이 분기를 실측할 수 없다.
    signal.alarm(max(1, args.budget_seconds))
    deadline = time.monotonic() + args.budget_seconds

    # 지연 import — 실패해도 traceback 대신 판정 한 줄을 남겨야 한다. traceback 만
    # 남기면 bash 는 "판정 없음" 으로 떨어져 키 실패와 스크립트 부재를 구분 못 한다.
    try:
        from src.common.gemini import MODEL_EMBEDDING, MODEL_GENERATE
        from src.common.gemini_client import get_client
        from src.config import settings
    except BudgetExceeded:
        # BudgetExceeded 를 아래 핸들러가 삼키면 "컨테이너 env / 이미지 확인" 이라는
        # **엉뚱한 조치**를 지시한다. 실측: 컨테이너 안 import 가 2.7s 라 짧은 예산은
        # 여기서 먼저 터진다. 원인이 다르면 진단도 달라야 한다.
        _emit(
            "FAIL",
            f"예산 {args.budget_seconds}s 를 import 단계에서 초과했다 "
            f"(컨테이너 안 import 는 약 2.7s) — 예산이 너무 짧거나 컨테이너·디스크 이상",
        )
        return 1
    except BaseException as exc:  # noqa: BLE001
        _emit(
            "FAIL",
            f"probe 가 기동하지 못했다 (import/설정 {sanitize(type(exc).__name__)}) "
            f"— 컨테이너 env / 이미지 확인",
        )
        return 1

    # 지문. 리허설에서 -e override 가 먹지 않았다면 이 값이 정상 실행과 같게 나와
    # **리허설이 아무것도 검증하지 못했음**을 볼 수 있다. 없으면 반증 불가능하다.
    fingerprint = hashlib.sha256(
        settings.gemini_api_key.get_secret_value().encode()
    ).hexdigest()[:8]
    client = get_client(retry_429=False)

    # 이 줄이 판정 줄보다 **먼저** 나온다 — bash 가 "마지막 줄" 이 아니라 접두사로
    # 찾아야 하는 이유다.
    print(
        f"[probe] generate={MODEL_GENERATE} embedding={MODEL_EMBEDDING} "
        f"budget={args.budget_seconds}s",
        flush=True,
    )

    # 운영 파이프라인 순서(Embedding 먼저)와 같게, 싼 쪽을 먼저.
    embed = probe_embed(client, MODEL_EMBEDDING, deadline)
    if time.monotonic() >= deadline:
        gen = Probe("generate", False, "not-run-budget", 0.0, "")
    else:
        # embed 가 실패해도 **반드시** 호출한다 — 어느 쪽이 살아 있는지가 원인을 가른다.
        gen = probe_generate(client, MODEL_GENERATE, deadline)
    signal.alarm(0)

    verdict, detail = compose(embed, gen, fingerprint, settings.gemini_tier)
    _emit(verdict, detail)
    return 0 if verdict == "OK" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BudgetExceeded:
        # 알람은 probe 호출 밖(지문 계산·compose 등)에서도 터질 수 있다. 그때도
        # "내부 오류" 가 아니라 예산이라고 말해야 조치가 맞는다.
        _emit("FAIL", "전체 예산을 초과했다 — Gemini 응답 지연 또는 예산 설정 확인")
        sys.exit(1)
    except BaseException as exc:  # noqa: BLE001
        # 이 스크립트는 **어떤 경우에도** 판정 한 줄을 남긴다.
        _emit(
            "FAIL",
            f"probe 내부 오류 {sanitize(type(exc).__name__)} — cron 로그 원문 확인",
        )
        sys.exit(1)
