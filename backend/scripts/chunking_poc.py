"""옵션 F 청킹 PoC — 3 방식 비교 (sentence / token1024 / paragraph).

가설: prefix가 검색 정확도를 회귀시킨 이유는 청크 자체가 짧고 정보 밀도 낮음 → 청킹을 재설계하면
prefix 없이도 검색 정확도 향상 가능.

prefix_text는 항상 빈 문자열로 유지.
"""
from __future__ import annotations

import argparse
import re
import statistics
from pathlib import Path

from src.pipeline.chunker import Chunk, chunk_text


# token-based 청킹 파라미터: Korean ~2.5 chars/token 근사
TOKEN_CHUNK_CHARS = 2560  # ~1024 token
TOKEN_OVERLAP_CHARS = 500  # ~200 token

# paragraph 청킹 파라미터
PARAGRAPH_MIN_CHARS = 200
PARAGRAPH_MAX_CHARS = 3000  # 초과 단락은 token1024 fallback


def chunk_sentence(
    text: str,
    volume: str,
    source: str = "",
    title: str = "",
    date: str = "",
) -> list[Chunk]:
    """Baseline 청킹 — 기존 sentence-based kss (max_chars=500, overlap_sentences=2)."""
    return chunk_text(
        text=text,
        volume=volume,
        max_chars=500,
        source=source,
        title=title,
        date=date,
        overlap_sentences=2,
    )


def chunk_token1024(
    text: str,
    volume: str,
    source: str = "",
    title: str = "",
    date: str = "",
) -> list[Chunk]:
    """Char-based sliding window — chunk_size=2560, overlap=500. Token splitter 근사."""
    if not text.strip():
        return []
    if len(text) <= TOKEN_CHUNK_CHARS:
        return [Chunk(
            text=text,
            volume=volume,
            chunk_index=0,
            source=source,
            title=title,
            date=date,
        )]
    chunks: list[Chunk] = []
    step = TOKEN_CHUNK_CHARS - TOKEN_OVERLAP_CHARS
    idx = 0
    pos = 0
    while pos < len(text):
        end = min(pos + TOKEN_CHUNK_CHARS, len(text))
        chunks.append(Chunk(
            text=text[pos:end],
            volume=volume,
            chunk_index=idx,
            source=source,
            title=title,
            date=date,
        ))
        idx += 1
        if end == len(text):
            break
        pos += step
    return chunks


def chunk_paragraph(
    text: str,
    volume: str,
    source: str = "",
    title: str = "",
    date: str = "",
) -> list[Chunk]:
    """빈 줄(\\n\\n+) 기준 단락 분할. min_chars=200 미만은 다음 단락과 병합. max_chars=3000 초과는 token1024 fallback."""
    parts = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    if not parts:
        return []
    # 짧은 단락 병합
    merged: list[str] = []
    buf = ""
    for p in parts:
        buf = f"{buf}\n\n{p}" if buf else p
        if len(buf) >= PARAGRAPH_MIN_CHARS:
            merged.append(buf)
            buf = ""
    if buf:
        if merged:
            merged[-1] = f"{merged[-1]}\n\n{buf}"
        else:
            merged.append(buf)
    # max_chars 초과 단락은 token1024 분할
    chunks: list[Chunk] = []
    idx = 0
    for m in merged:
        if len(m) <= PARAGRAPH_MAX_CHARS:
            chunks.append(Chunk(
                text=m, volume=volume, chunk_index=idx,
                source=source, title=title, date=date,
            ))
            idx += 1
        else:
            sub = chunk_token1024(m, volume=volume, source=source, title=title, date=date)
            for s in sub:
                chunks.append(Chunk(
                    text=s.text, volume=volume, chunk_index=idx,
                    source=source, title=title, date=date,
                ))
                idx += 1
    return chunks


def chunk_stats(chunks: list[Chunk]) -> dict:
    if not chunks:
        return {"count": 0}
    sizes = [len(c.text) for c in chunks]
    return {
        "count": len(chunks),
        "mean": round(statistics.mean(sizes), 1),
        "median": int(statistics.median(sizes)),
        "stdev": round(statistics.stdev(sizes), 1) if len(sizes) > 1 else 0,
        "min": min(sizes),
        "max": max(sizes),
    }


METHODS = {
    "sentence": chunk_sentence,
    "token1024": chunk_token1024,
    "paragraph": chunk_paragraph,
}


def main():
    parser = argparse.ArgumentParser(description="옵션 F 청킹 PoC CLI")
    parser.add_argument("--input", required=True, help="raw text 파일 경로 (예: ~/Downloads/평화경.txt)")
    parser.add_argument("--volume", required=True, help="권 이름")
    parser.add_argument("--source", default="A", help="source 코드 (default A)")
    parser.add_argument("--method", choices=list(METHODS.keys()), required=True)
    parser.add_argument("--dry-run", action="store_true", help="청크 통계만 출력")
    parser.add_argument("--collection", help="ingest 대상 컬렉션 (--ingest 시 필수)")
    parser.add_argument("--ingest", action="store_true", help="실제 적재")
    args = parser.parse_args()

    text = Path(args.input).expanduser().read_text(encoding="utf-8")
    chunks = METHODS[args.method](
        text, volume=args.volume, source=args.source, title=args.volume,
    )
    print(f"method={args.method} {chunk_stats(chunks)}")

    if args.dry_run or not args.ingest:
        return

    if not args.collection:
        parser.error("--ingest requires --collection")

    # ingest 모드 — 지연 import (test 시 무관 모듈 로드 회피)
    from src.pipeline.ingestor import ingest_chunks
    from src.qdrant_client import get_client

    client = get_client()
    result = ingest_chunks(
        client=client,
        collection_name=args.collection,
        chunks=chunks,
        title=args.volume,
    )
    print(f"ingested: {result}")


if __name__ == "__main__":
    main()
