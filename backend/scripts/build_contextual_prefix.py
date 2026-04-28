"""Anthropic Contextual Retrieval prefix 생성기 (옵션 B).

615권 약 18만 청크에 50~100토큰 한국어 contextual prefix 부여.
입력: 권별 JSONL (각 줄 = {chunk_index, text, volume, ...})
출력: 권별 JSONL — 각 청크에 ``prefix_text`` 필드 추가
LLM: Gemini 2.5 Flash (단발 호출, common.gemini.generate_text 재사용)

사용 예 (1권 dry-run):
    PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \\
        --input /tmp/평화경_chunks.jsonl \\
        --output ~/Downloads/contextual_prefix_dryrun_평화경.jsonl \\
        --limit 50

사용 예 (전체 615권 디렉토리):
    PYTHONPATH=. uv run python scripts/build_contextual_prefix.py \\
        --input-dir /tmp/all_chunks_jsonl \\
        --output-dir ~/Downloads/contextual_prefixes
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from collections.abc import Iterator
from pathlib import Path

from src.common.gemini import generate_text


PROMPT_TEMPLATE = """<document>{full_doc}</document>

다음 청크를 위 전체 문서 맥락 안에 위치시키시오:
<chunk>{chunk_text}</chunk>

검색 정확도 향상을 위해 이 청크가 전체 문서의 어느 부분에 해당하는지
간결한 한국어 한두 문장으로만 답하시오. (시기/장소/주제 포함, 50~150자)
설명·머리말·꼬리말 없이 한두 문장 본문만 출력."""


def build_prompt(full_doc: str, chunk_text: str, chunk_index: int) -> str:
    """Anthropic Contextual Retrieval 프롬프트.

    chunk_index는 디버그/추적용 — 프롬프트 본문엔 포함 안 함 (Anthropic 원형 유지).
    """
    return PROMPT_TEMPLATE.format(
        full_doc=full_doc[:8000],
        chunk_text=chunk_text[:1500],
    )


def parse_prefix_response(raw: str) -> str:
    """LLM 응답을 정리 — 공백 제거, 길면 첫 두 문장으로 잘라냄."""
    text = (raw or "").strip()
    if len(text) > 400:
        # 한국어/영어 모두 마침표 기준 분할
        sents = text.split("。") if "。" in text else text.split(".")
        text = ". ".join(s.strip() for s in sents[:2] if s.strip()).strip()
        if len(text) > 400:
            text = text[:400].rstrip()
    return text


def iter_chunks_from_volume_jsonl(path: Path) -> Iterator[dict]:
    """권별 JSONL을 한 줄씩 dict로 yield (빈 줄 무시)."""
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


async def generate_prefix_for_volume(
    volume_path: Path, output: Path, limit: int | None = None
) -> None:
    chunks = list(iter_chunks_from_volume_jsonl(volume_path))
    if limit:
        chunks = chunks[:limit]
    full_doc = "\n".join(str(c.get("text", "") or "") for c in chunks)
    output.parent.mkdir(parents=True, exist_ok=True)
    n = len(chunks)
    with output.open("w", encoding="utf-8") as out_f:
        for i, c in enumerate(chunks, 1):
            prompt = build_prompt(full_doc, str(c.get("text", "") or ""), c.get("chunk_index", 0))
            try:
                raw = await generate_text(prompt, model="gemini-2.5-flash")
                c["prefix_text"] = parse_prefix_response(raw)
            except Exception as exc:
                c["prefix_text"] = ""
                c["prefix_error"] = str(exc)
            if i % 10 == 0 or i == n:
                print(f"  {i}/{n} prefix 생성 완료", flush=True)
            out_f.write(json.dumps(c, ensure_ascii=False) + "\n")
            out_f.flush()


async def _generate_one(
    chunk: dict, full_doc: str, semaphore: asyncio.Semaphore
) -> dict:
    """단일 청크 prefix 생성 — Semaphore로 동시성 제한, exception 격리.

    실패 시 chunk["prefix_text"]=""+chunk["prefix_error"]만 채우고 정상 반환.
    """
    async with semaphore:
        prompt = build_prompt(
            full_doc,
            str(chunk.get("text", "") or ""),
            chunk.get("chunk_index", 0),
        )
        try:
            raw = await generate_text(prompt, model="gemini-2.5-flash")
            chunk["prefix_text"] = parse_prefix_response(raw)
        except Exception as exc:
            chunk["prefix_text"] = ""
            chunk["prefix_error"] = str(exc)
    return chunk


async def generate_prefix_for_volume_concurrent(
    volume_path: Path,
    output: Path,
    semaphore: asyncio.Semaphore,
    limit: int | None = None,
) -> None:
    """asyncio.Semaphore + as_completed로 청크 동시 prefix 생성.

    출력 jsonl은 입력 chunk_index 순서를 보존 (as_completed 결과를 인덱스별
    버킷에 채우고 마지막에 순서대로 직렬화).
    """
    chunks = list(iter_chunks_from_volume_jsonl(volume_path))
    if limit:
        chunks = chunks[:limit]
    full_doc = "\n".join(str(c.get("text", "") or "") for c in chunks)
    output.parent.mkdir(parents=True, exist_ok=True)
    n = len(chunks)

    async def _wrapped(idx: int, chunk: dict) -> tuple[int, dict]:
        result = await _generate_one(chunk, full_doc, semaphore)
        return idx, result

    coros = [_wrapped(i, c) for i, c in enumerate(chunks)]
    results: list[dict | None] = [None] * n
    completed = 0
    for coro in asyncio.as_completed(coros):
        idx, result = await coro
        results[idx] = result
        completed += 1
        if completed % 100 == 0 or completed == n:
            print(f"  {completed}/{n} prefix 생성 완료 ({volume_path.name})", flush=True)

    with output.open("w", encoding="utf-8") as out_f:
        for r in results:
            out_f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, help="단일 권 JSONL")
    p.add_argument("--output", type=Path)
    p.add_argument("--input-dir", type=Path, help="전체 권 JSONL 디렉토리")
    p.add_argument("--output-dir", type=Path)
    p.add_argument("--limit", type=int, help="권당 처리 청크 수 (dry-run용)")
    p.add_argument(
        "--mode",
        choices=("sequential", "concurrent"),
        default="sequential",
        help="청크 처리 방식 (concurrent = asyncio.Semaphore + as_completed)",
    )
    p.add_argument(
        "--concurrency",
        type=int,
        default=20,
        help="concurrent 모드의 동시 진행 청크 상한 (paid tier 권장 20~50)",
    )
    args = p.parse_args()

    if args.input:
        if not args.output:
            raise SystemExit("--input 사용 시 --output 필요")
        if args.mode == "concurrent":
            sem = asyncio.Semaphore(args.concurrency)
            asyncio.run(
                generate_prefix_for_volume_concurrent(
                    args.input, args.output, sem, args.limit
                )
            )
        else:
            asyncio.run(generate_prefix_for_volume(args.input, args.output, args.limit))
        print(f"완료: {args.output}", flush=True)
    elif args.input_dir:
        if not args.output_dir:
            raise SystemExit("--input-dir 사용 시 --output-dir 필요")
        if args.mode == "concurrent":
            # 전권 공유 Semaphore — 마지막 권까지 균등 처리
            async def _run_all() -> None:
                sem = asyncio.Semaphore(args.concurrency)
                for vol in sorted(args.input_dir.glob("*.jsonl")):
                    out = args.output_dir / vol.name
                    if out.exists():
                        print(f"이미 처리됨, skip: {out.name}", flush=True)
                        continue
                    await generate_prefix_for_volume_concurrent(
                        vol, out, sem, args.limit
                    )
                    print(f"완료: {out}", flush=True)

            asyncio.run(_run_all())
        else:
            for vol in sorted(args.input_dir.glob("*.jsonl")):
                out = args.output_dir / vol.name
                if out.exists():
                    print(f"이미 처리됨, skip: {out.name}", flush=True)
                    continue
                asyncio.run(generate_prefix_for_volume(vol, out, args.limit))
                print(f"완료: {out}", flush=True)
    else:
        raise SystemExit("--input 또는 --input-dir 필요")
    return 0


if __name__ == "__main__":
    sys.exit(main())
