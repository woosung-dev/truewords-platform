"""queries.json 의 expected_snippets → expected_chunk_ids 자동 매칭 (PR 3 Part 2).

각 query 의 NotebookLM 인용 snippet 을 Qdrant 에서 검색해 가장 일치하는 chunk 의
``"<volume>:<chunk_index>"`` id 를 expected_chunk_ids 에 채운다.

매칭 전략 (보수적):
1. snippet 을 query 로 cascading_search (rerank 없음, source=intended_sources) top_k=20
2. 각 후보의 chunk text 에 대해 정규화된 snippet 이 substring 인지 체크
3. substring match → **high confidence** → expected_chunk_ids 에 추가
4. substring match 없음 → top-1 후보를 mid_confidence_candidates 보고서에 추가 (사용자 검수)

장점: 임베딩 검색으로 후보 좁히고 + 정확한 substring 매칭으로 false positive 최소화.

사용:
    cd backend
    uv run python scripts/match_snippets_to_chunks.py \\
        --queries tests/golden/queries.json \\
        --sources U \\
        --top-k 20

    # 저장 없이 보고서만 보기
    uv run python scripts/match_snippets_to_chunks.py --dry-run

요구 환경:
    - 로컬 또는 staging Qdrant 에 ``intended_sources`` 의 데이터가 적재되어 있어야 함
    - 예: source="U" 의 4권 자료가 main 컬렉션에 적재된 상태
    - GEMINI_API_KEY 필수 (snippet 임베딩)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Any

# scripts/ 는 패키지 아니므로 sys.path 조작 (backend/ 를 import root 로)
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def normalize_text(s: str) -> str:
    """공백/탭/개행 normalize. substring 비교 정확도 향상."""
    return re.sub(r"\s+", " ", s).strip()


def normalize_text_strict(s: str) -> str:
    """더 강한 normalize: NFC + 공백 모두 제거 + 한자 병기 괄호 제거.

    한국어 인용 (NotebookLM) vs Qdrant chunk 간 한자 병기 (한자), 줄바꿈,
    띄어쓰기 차이를 흡수.
    """
    import unicodedata
    s = unicodedata.normalize("NFC", s)
    # 한자 병기 괄호 제거 (예: '장성기(長成期)' → '장성기')
    s = re.sub(r"\([一-鿿]+\)", "", s)
    # 모든 공백 제거 (띄어쓰기, 줄바꿈, 탭, U+00A0 등)
    s = re.sub(r"\s+", "", s)
    return s.strip()


async def search_for_snippet(
    snippet: str,
    sources: list[str],
    top_k: int = 20,
    collection_name: str | None = None,
) -> list[Any]:
    """source 필터로 cascading top_k. rerank 없이 raw retrieval."""
    from src.qdrant_client import get_raw_client
    from src.search.cascading import CascadingConfig, SearchTier, cascading_search

    client = get_raw_client()
    config = CascadingConfig(
        tiers=[SearchTier(sources=sources, min_results=3, score_threshold=0.0)]
    )
    return await cascading_search(
        client, snippet, config, top_k=top_k, collection_name=collection_name,
    )


def _split_by_ellipsis(snippet: str) -> list[str]:
    """ellipsis ('...' 또는 '…') 로 split 하고 빈 fragment 제거. 길이 8자 이상만 유지."""
    fragments = re.split(r"\.{3,}|…", snippet)
    return [f.strip() for f in fragments if len(f.strip()) >= 8]


async def match_query_entry(
    query_entry: dict[str, Any],
    sources: list[str],
    top_k: int,
    collection_name: str | None = None,
    score_fallback_threshold: float = 0.95,
) -> tuple[list[str], list[dict[str, Any]]]:
    """단일 query 의 모든 snippet 매칭. (high_confidence_chunk_ids, mid_candidates).

    매칭 우선순위 (보수적 → 관대 순):
    1. ``normalize_text`` (공백 정규화) substring match → high confidence.
    2. ``normalize_text_strict`` (NFC + 한자 병기 제거 + 공백 모두 제거) substring → high.
    3. ellipsis ('...') split 후 첫 fragment 가 strict substring 으로 매칭 → high.
    4. top-1 후보의 score 가 ``score_fallback_threshold`` 이상 → high (perfect cosine).
    5. 모두 실패 → mid_candidates 에 top-1 보고서.
    """
    chunk_ids: list[str] = []
    mid_candidates: list[dict[str, Any]] = []

    for snippet_obj in query_entry.get("expected_snippets", []):
        snippet = snippet_obj.get("snippet", "")
        if not snippet:
            continue

        results = await search_for_snippet(snippet, sources, top_k, collection_name)
        norm_snippet = normalize_text(snippet)
        strict_snippet = normalize_text_strict(snippet)
        fragments = _split_by_ellipsis(snippet)
        strict_fragments = [normalize_text_strict(f) for f in fragments]

        matched = False
        # 1단계: 공백 정규화 substring
        for r in results:
            if norm_snippet and norm_snippet in normalize_text(r.text):
                chunk_id = f"{r.volume}:{r.chunk_index}"
                if chunk_id not in chunk_ids:
                    chunk_ids.append(chunk_id)
                matched = True
                break
        # 2단계: strict normalize substring
        if not matched:
            for r in results:
                if strict_snippet and strict_snippet in normalize_text_strict(r.text):
                    chunk_id = f"{r.volume}:{r.chunk_index}"
                    if chunk_id not in chunk_ids:
                        chunk_ids.append(chunk_id)
                    matched = True
                    break
        # 3단계: ellipsis fragment 매칭 — 첫 fragment 가 strict substring
        if not matched and len(strict_fragments) >= 2:
            for r in results:
                strict_chunk = normalize_text_strict(r.text)
                if strict_fragments[0] and strict_fragments[0] in strict_chunk:
                    chunk_id = f"{r.volume}:{r.chunk_index}"
                    if chunk_id not in chunk_ids:
                        chunk_ids.append(chunk_id)
                    matched = True
                    break
        # 4단계: score >= threshold 면 top-1 auto-accept
        if not matched and results and results[0].score >= score_fallback_threshold:
            top = results[0]
            chunk_id = f"{top.volume}:{top.chunk_index}"
            if chunk_id not in chunk_ids:
                chunk_ids.append(chunk_id)
            matched = True

        if not matched and results:
            top = results[0]
            mid_candidates.append({
                "snippet_preview": snippet[:80],
                "candidate_chunk_id": f"{top.volume}:{top.chunk_index}",
                "candidate_score": top.score,
                "candidate_text_preview": normalize_text(top.text)[:200],
            })

    return chunk_ids, mid_candidates


async def match_all_queries(
    queries_path: Path,
    sources: list[str],
    top_k: int,
    dry_run: bool,
    collection_name: str | None = None,
    score_fallback_threshold: float = 0.95,
) -> dict[str, Any]:
    """전체 queries.json 매칭 → 갱신 + 보고서 반환."""
    data = json.loads(queries_path.read_text(encoding="utf-8"))
    queries = data.get("queries", [])
    report: dict[str, Any] = {
        "n_queries": len(queries),
        "n_high_confidence": 0,
        "n_no_match": 0,
        "collection_name": collection_name,
        "score_fallback_threshold": score_fallback_threshold,
        "per_query": [],
    }

    for q in queries:
        chunk_ids, mid_candidates = await match_query_entry(
            q, sources, top_k, collection_name, score_fallback_threshold,
        )
        q["expected_chunk_ids"] = chunk_ids
        if chunk_ids:
            report["n_high_confidence"] += 1
        else:
            report["n_no_match"] += 1
        report["per_query"].append({
            "id": q["id"],
            "category": q.get("category"),
            "n_snippets": len(q.get("expected_snippets", [])),
            "n_chunk_ids_matched": len(chunk_ids),
            "chunk_ids": chunk_ids,
            "mid_candidates": mid_candidates,
        })

    if not dry_run:
        data["version"] = data.get("version", 1) + 1
        queries_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="queries.json snippet → chunk_id 자동 매칭"
    )
    parser.add_argument(
        "--queries", default="tests/golden/queries.json",
        help="대상 queries.json (default: tests/golden/queries.json)",
    )
    parser.add_argument(
        "--sources", default="U",
        help="cascading source filter (쉼표 구분, default: U)",
    )
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument(
        "--collection",
        default=None,
        help="Qdrant collection 명. 미지정 시 settings.collection_name (현재 malssum_poc_v5) 사용",
    )
    parser.add_argument(
        "--score-fallback-threshold",
        type=float,
        default=0.95,
        help="substring 실패 시 top-1 후보 score 가 임계값 이상이면 auto-accept (default 0.95)",
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="queries.json 갱신 없이 보고서만 출력")
    args = parser.parse_args(argv)

    sources = [s.strip() for s in args.sources.split(",") if s.strip()]
    report = asyncio.run(match_all_queries(
        Path(args.queries), sources, args.top_k, args.dry_run,
        args.collection, args.score_fallback_threshold,
    ))

    print(f"\n=== 매칭 결과 ===")
    print(f"전체 queries: {report['n_queries']}")
    print(f"high confidence (chunk_id 매칭): {report['n_high_confidence']}")
    print(f"no match (사용자 검수 필요): {report['n_no_match']}")
    print()
    for q in report["per_query"]:
        status = "✓" if q["n_chunk_ids_matched"] > 0 else "✗"
        print(f"  {status} {q['id']} ({q['category']}): "
              f"{q['n_chunk_ids_matched']}/{q['n_snippets']} matched")
        if not q["chunk_ids"] and q["mid_candidates"]:
            for c in q["mid_candidates"][:1]:
                print(f"      mid 후보: {c['candidate_chunk_id']} "
                      f"(score={c['candidate_score']:.3f})")

    if args.dry_run:
        print("\n(--dry-run) queries.json 갱신 안 함.")
    else:
        print(f"\n✓ queries.json 갱신 완료 (version bump).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
