"""Semantic Cache 만료 point cleanup (TTL 기반).

`payload.created_at < now - CACHE_TTL_DAYS*86400` 인 point 를 삭제한다.
Qdrant 가 native point TTL 을 지원하지 않아 무한 누적되는 문제 (semantic_cache
디스크 비대화 + 인덱스 latency 증가) 를 해결한다.

인프라 무관 (스펙에 영향받지 않음): EC2/Docker/k8s/Cloud Run/온프레미스 어디서든
동일하게 동작한다. Trigger 만 환경별로 자유 선택:

  EC2 cron       0 3 * * * cd /path/backend && uv run python scripts/cleanup_semantic_cache.py --execute
  k8s CronJob    spec.schedule: "0 3 * * *"
  Docker compose cron sidecar 컨테이너
  Cloud Scheduler  엔드포인트 trigger (HTTP wrapper 별도)

환경변수 (모두 옵션, .env 자동 로드):
  QDRANT_URL              기본 http://localhost:6333
  QDRANT_API_KEY          기본 빈 문자열 (local Qdrant)
  CACHE_COLLECTION_NAME   기본 semantic_cache
  CACHE_TTL_DAYS          기본 7

사용:
  uv run python scripts/cleanup_semantic_cache.py --dry-run
  uv run python scripts/cleanup_semantic_cache.py --execute
  uv run python scripts/cleanup_semantic_cache.py --execute --ttl-days 14

종료 코드:
  0  성공 (삭제 0건 포함)
  1  Qdrant API 오류 또는 호출 실패

상세 ADR: docs/dev-log/{date}-semantic-cache-hardening.md
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_env() -> None:
    """backend/.env 자동 로드 (이미 export 된 값은 보존)."""
    env_file = BACKEND_DIR / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k, v.strip().strip('"').strip("'"))


# raw httpx (HTTP/1.1) — Cloudflare Tunnel + Cloud Run 환경에서 SDK HTTP/2 hang 회피.
# semantic_cache service 와 동일 정책 (PR #84/#86, dev-log 46).
_HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


def _headers(api_key: str) -> dict[str, str]:
    return {"api-key": api_key, "Content-Type": "application/json"}


async def _count(
    client: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    name: str,
    cutoff: float | None = None,
) -> int:
    body: dict = {"exact": True}
    if cutoff is not None:
        body["filter"] = {"must": [{"key": "created_at", "range": {"lt": cutoff}}]}
    resp = await client.post(
        f"{base}/collections/{name}/points/count",
        headers=headers,
        json=body,
    )
    resp.raise_for_status()
    return int(resp.json()["result"]["count"])


async def _delete_expired(
    client: httpx.AsyncClient,
    base: str,
    headers: dict[str, str],
    name: str,
    cutoff: float,
) -> None:
    """filter 기반 일괄 삭제. Qdrant 가 내부적으로 처리 (batch scroll 불필요)."""
    body = {"filter": {"must": [{"key": "created_at", "range": {"lt": cutoff}}]}}
    resp = await client.post(
        f"{base}/collections/{name}/points/delete",
        headers=headers,
        json=body,
        params={"wait": "true"},
    )
    resp.raise_for_status()


async def _run() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="삭제하지 않고 대상 개수만 출력")
    mode.add_argument("--execute", action="store_true", help="실제 삭제 실행")
    parser.add_argument(
        "--ttl-days",
        type=int,
        default=None,
        help="CACHE_TTL_DAYS override (기본: env 값 또는 7)",
    )
    args = parser.parse_args()

    _load_env()

    base = os.environ.get("QDRANT_URL", "http://localhost:6333").rstrip("/")
    api_key = os.environ.get("QDRANT_API_KEY", "")
    name = os.environ.get("CACHE_COLLECTION_NAME", "semantic_cache")
    ttl_days = (
        args.ttl_days
        if args.ttl_days is not None
        else int(os.environ.get("CACHE_TTL_DAYS", "7"))
    )

    now = time.time()
    cutoff = now - ttl_days * 86400
    cutoff_human = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(cutoff))

    print(f"[config] qdrant={base}  collection={name}  ttl_days={ttl_days}")
    print(f"[config] cutoff={cutoff:.0f}  ({cutoff_human} 이전 point 삭제 대상)")

    headers = _headers(api_key)
    async with httpx.AsyncClient(http2=False, timeout=_HTTP_TIMEOUT) as client:
        try:
            total = await _count(client, base, headers, name)
            expired = await _count(client, base, headers, name, cutoff=cutoff)
        except httpx.HTTPStatusError as e:
            print(
                f"[error] Qdrant API: {e.response.status_code} {e.response.text}",
                file=sys.stderr,
            )
            return 1
        except Exception as e:
            print(f"[error] 호출 실패: {e!r}", file=sys.stderr)
            return 1

        alive = total - expired
        print(f"[count] total={total}  expired={expired}  alive={alive}")

        if args.dry_run:
            print(f"\n[dry-run] {expired} point 삭제 예정. 실행하려면 --execute")
            return 0

        if expired == 0:
            print("\n[skip] 만료된 point 없음")
            return 0

        print(f"\n[execute] {expired} point 삭제 중 ...")
        try:
            await _delete_expired(client, base, headers, name, cutoff)
        except httpx.HTTPStatusError as e:
            print(
                f"[error] delete 실패: {e.response.status_code} {e.response.text}",
                file=sys.stderr,
            )
            return 1

        after = await _count(client, base, headers, name)
        removed = total - after
        print(f"[done] before={total}  after={after}  removed={removed}")
        if removed != expired:
            # idempotent 안전망 — 동시 다른 클라이언트가 store/delete 한 경우 발생 가능.
            print(
                f"[warn] removed({removed}) != expected({expired}) — 동시 쓰기 영향 가능",
                file=sys.stderr,
            )
    return 0


def main() -> int:
    return asyncio.run(_run())


if __name__ == "__main__":
    sys.exit(main())
