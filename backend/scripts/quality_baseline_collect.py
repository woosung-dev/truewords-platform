"""품질 기준선 200건 수집. staging 프로비저닝 후 실행.

사용:
    uv run python scripts/quality_baseline_collect.py --dry-run
    uv run python scripts/quality_baseline_collect.py --execute --api-base https://<staging>.run.app
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Literal

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

CATALOG_PATH = Path(__file__).resolve().parent / "data" / "baseline_questions.jsonl"
DEFAULT_OUTPUT_DIR = BACKEND_DIR / "reports"

Category = Literal["doctrine", "practice", "adversarial", "out_of_scope", "variation"]


@dataclass(frozen=True)
class BaselineQuestion:
    id: str
    query: str
    category: Category
    source: str


def load_catalog(path: Path = CATALOG_PATH) -> list[BaselineQuestion]:
    items: list[BaselineQuestion] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
            items.append(BaselineQuestion(**data))
        except Exception as e:
            raise RuntimeError(f"{path}:{line_no} 파싱 실패: {e}") from e
    return items


import httpx  # noqa: E402


@dataclass(frozen=True)
class CollectionResult:
    id: str
    query: str
    category: str
    status_code: int
    answer: str
    citations_count: int
    session_id: str | None
    latency_ms: int
    error: str = ""


async def call_chat_api(
    client: httpx.AsyncClient,
    *,
    api_base: str,
    question: BaselineQuestion,
) -> CollectionResult:
    url = f"{api_base.rstrip('/')}/chat"
    started = time.perf_counter()
    try:
        resp = await client.post(
            url,
            json={"query": question.query, "chatbot_id": None, "session_id": None},
            timeout=30.0,
        )
    except Exception as e:
        latency = int((time.perf_counter() - started) * 1000)
        return CollectionResult(
            id=question.id, query=question.query, category=question.category,
            status_code=0, answer="", citations_count=0, session_id=None,
            latency_ms=latency, error=str(e),
        )
    latency = int((time.perf_counter() - started) * 1000)
    if resp.status_code != 200:
        return CollectionResult(
            id=question.id, query=question.query, category=question.category,
            status_code=resp.status_code, answer="", citations_count=0,
            session_id=None, latency_ms=latency,
            error=(getattr(resp, "text", "") or "")[:500],
        )
    data = resp.json()
    return CollectionResult(
        id=question.id, query=question.query, category=question.category,
        status_code=200,
        answer=data.get("answer", ""),
        citations_count=len(data.get("sources", []) or []),
        session_id=data.get("session_id"),
        latency_ms=latency,
    )


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--execute", action="store_true")
    parser.add_argument("--api-base", help="Chat API base URL (execute 필수)")
    parser.add_argument("--rate-per-sec", type=float, default=1.0)
    parser.add_argument("--limit", type=int, default=None, help="카탈로그 상위 N건만")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args(argv)
    if args.execute and not args.api_base:
        parser.error("--execute 에는 --api-base 가 필요합니다.")
    return args


async def _run(
    *,
    api_base: str,
    rate_per_sec: float,
    limit: int | None,
    output: Path,
) -> int:
    items = load_catalog()
    if limit:
        items = items[:limit]

    output.parent.mkdir(parents=True, exist_ok=True)
    failures = 0
    sleep_s = 1.0 / max(rate_per_sec, 0.01)
    async with httpx.AsyncClient() as client:
        with output.open("w", encoding="utf-8") as f:
            for q in items:
                r = await call_chat_api(client, api_base=api_base, question=q)
                f.write(json.dumps(asdict(r), ensure_ascii=False) + "\n")
                f.flush()
                if r.status_code != 200:
                    failures += 1
                await asyncio.sleep(sleep_s)
    print(f"수집 완료: {len(items)} 건, 실패 {failures} — {output}")
    return 0 if failures == 0 else 2


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.dry_run:
        items = load_catalog()
        print(f"[dry-run] 카탈로그 {len(items)} 건 검증 완료. --execute --api-base <URL> 로 실행.")
        return 0
    output = args.output or (
        DEFAULT_OUTPUT_DIR / f"baseline_{time.strftime('%Y%m%d_%H%M%S')}.jsonl"
    )
    return asyncio.run(
        _run(
            api_base=args.api_base,
            rate_per_sec=args.rate_per_sec,
            limit=args.limit,
            output=output,
        )
    )


if __name__ == "__main__":
    sys.exit(main())
