"""C1 (Fanar-Sadiq 식) — 구절 조회 + 사후 인용 게이트 + 근거 부족 거절. 기본 꺼짐.

`POST /admin/rag-trace` 의 overrides.citation_check 로만 켠다. LLM 은 게이트의 재생성 콜백 1회 외에
부르지 않고, Qdrant 는 경전(source U) 색인을 처음 한 번 scroll 로 읽기만 한다.

- passage_lookup: 질문에 따옴표 인용(정규화 15자 이상)과 위치를 묻는 말이 함께 있으면
  경전 4권 색인에서 그 구절 chunk 를 찾아 결과 맨 앞에 둔다.
- should_refuse: rerank 최고점이 REFUSAL_TAU 미만이면 생성 없이 거절한다.
- citation_gate: 답변의 인용구·[출처: …]·[n] 을 근거 문단과 대조해 고치고,
  확인 실패가 2건 이상이면 검토 메모를 붙여 딱 한 번 다시 생성한다.
"""
from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field, replace
from time import perf_counter
from typing import Any

from app.modules.chat.experiments import result_key
from app.modules.chat.experiments.passage_index import (
    NEAR_MIN_LEN,
    CorpusChunk,
    PassageIndex,
    PassageMatch,
    normalize,
)
from app.modules.qdrant import get_raw_client
from app.modules.qdrant.filters import build_filter, field_match_any
from app.modules.search.collection_resolver import resolve_collections
from app.modules.search.hybrid import SearchResult

REFUSAL_ANSWER = "말씀 자료에서 이 질문에 답할 근거를 찾지 못했습니다."

# [확인 필요] 보정 전 자리표시. rerank 점수는 0~1 이라 0.0 이면 사실상 거절하지 않는다.
REFUSAL_TAU: float = 0.0

SCRIPTURE_SOURCE = "U"
# U 4권 제목 — 『…』 같은 책 제목 표기를 인용구로 오인하지 않게 한다.
SCRIPTURE_TITLES = (
    "천성경.pdf",
    "평화경.txt",
    "원리강론.txt",
    "하늘 섭리로 본 참부모님의 위상과 가치.pdf",
)

LOOKUP_MIN_QUOTE = 15  # passage_lookup 이 보는 인용 최소 길이(정규화)
LOOKUP_MAX_MATCHES = 3
GATE_MIN_QUOTE = 8  # 게이트가 검사하는 인용 최소 길이(정규화)
REGENERATE_MIN_FAILS = 2
# 실패 인용을 뺀 뒤 문장에 남은 글자(한글·영숫자)가 이보다 적으면 문장째 지운다.
_MIN_SENTENCE_CONTENT = 20
_SCROLL_PAGE = 1000
_SCROLL_MAX_PAGES = 100

_QUOTE_PAIRS = (("‘", "’"), ("“", "”"), ("「", "」"), ("『", "』"), ('"', '"'))
# 질문은 키보드 작은따옴표('…')로 인용하는 경우가 많다. 답변에서는 아포스트로피와 헷갈려 쓰지 않는다.
_QUERY_QUOTE_PAIRS = (*_QUOTE_PAIRS, ("'", "'"))
_LOCATION_ASK_RE = re.compile(
    r"어디|출처|어느\s*(?:책|권|부분|대목|곳|장|편|말씀)|무슨\s*책|어떤\s*책"
    r"|몇\s*(?:장|절|쪽|페이지|권|편|면)"
)
_MARKER_RE = re.compile(r"\[출처\s*[:：]\s*([^\]\n]+)\]")
_REF_RE = re.compile(r"\[(\d{1,3})\]")
_SENTENCE_CUT_RE = re.compile(r"\n|[.!?。]+(?=\s)")
_CONTENT_RE = re.compile(r"[0-9A-Za-z가-힣]")
_SERIES_TITLE_RE = re.compile(r"^[가-힣A-Za-z]+\d+권$")  # 말씀선집333권 같은 권호 제목


def _quote_spans(text: str, pairs: Iterable[tuple[str, str]]) -> list[tuple[int, int, int, int]]:
    """(따옴표 포함 시작, 끝, 안쪽 시작, 안쪽 끝). 다른 인용 안에 든 인용은 뺀다."""
    spans: list[tuple[int, int, int, int]] = []
    for o, c in pairs:
        pat = re.compile(re.escape(o) + r"([^" + re.escape(c) + r"\n]{1,800})" + re.escape(c))
        for m in pat.finditer(text):
            spans.append((m.start(), m.end(), m.start(1), m.end(1)))
    spans.sort(key=lambda s: (s[0], -s[1]))
    kept: list[tuple[int, int, int, int]] = []
    for s in spans:
        if kept and s[0] < kept[-1][1]:
            continue
        kept.append(s)
    return kept


# ---------------------------------------------------------------------------
# 경전 색인 (프로세스당 한 번 적재)
# ---------------------------------------------------------------------------

CorpusLoader = Callable[[], Awaitable[list[CorpusChunk]]]


async def load_scripture_chunks() -> list[CorpusChunk]:
    """Qdrant 에서 source U chunk 를 scroll 로 읽는다. 쓰기는 하지 않는다."""
    client = get_raw_client()
    collection = resolve_collections().main
    flt = build_filter(must=[field_match_any("source", [SCRIPTURE_SOURCE])])
    chunks: list[CorpusChunk] = []
    offset: str | int | None = None
    for _ in range(_SCROLL_MAX_PAGES):
        points, offset = await client.scroll(
            collection,
            scroll_filter=flt,
            with_payload=["text", "volume", "chunk_index"],
            with_vectors=False,
            limit=_SCROLL_PAGE,
            offset=offset,
        )
        for p in points:
            payload = p.payload or {}
            text, volume, idx = payload.get("text"), payload.get("volume"), payload.get("chunk_index")
            if isinstance(text, str) and isinstance(volume, str) and isinstance(idx, int):
                chunks.append(
                    CorpusChunk(volume=volume, chunk_index=idx, text=text, chunk_id=str(p.id))
                )
        if offset is None:
            break
    return chunks


_book_loader: CorpusLoader = load_scripture_chunks
_book_index: PassageIndex | None = None
_book_lock = asyncio.Lock()


def set_book_corpus(chunks: Iterable[CorpusChunk] | None) -> None:
    """테스트·오프라인 평가용 — 메모리 corpus 로 경전 색인을 바꾼다. None 이면 다음 호출 때 다시 적재."""
    global _book_index
    _book_index = PassageIndex(chunks) if chunks is not None else None


def set_book_loader(loader: CorpusLoader | None) -> None:
    """경전 corpus 적재 함수를 바꾼다(None 이면 Qdrant 기본값). 만들어 둔 색인은 버린다."""
    global _book_loader, _book_index
    _book_loader = loader or load_scripture_chunks
    _book_index = None


async def get_book_index() -> PassageIndex:
    global _book_index
    if _book_index is not None:
        return _book_index
    async with _book_lock:
        if _book_index is None:
            _book_index = PassageIndex(await _book_loader())
    return _book_index


async def find_passage(text: str, *, limit: int = LOOKUP_MAX_MATCHES) -> list[PassageMatch]:
    """경전 4권에서 text 의 정확(없으면 근사) 위치."""
    return (await get_book_index()).find_passage(text, limit=limit)


# ---------------------------------------------------------------------------
# 1. 구절 조회
# ---------------------------------------------------------------------------


async def passage_lookup(
    query: str, results: list[SearchResult], *, sources: list[str]
) -> tuple[list[SearchResult], dict[str, Any]]:
    """인용구 위치 질문이면 그 구절(정확, 없으면 근사) chunk 를 맨 앞에 둔다. 아니면 results 를 그대로 돌려준다."""
    t0 = perf_counter()
    record: dict[str, Any] = {"routed": False}

    def done(reason: str) -> tuple[list[SearchResult], dict[str, Any]]:
        record["reason"] = reason
        record["ms"] = round((perf_counter() - t0) * 1000, 1)
        return results, record

    if SCRIPTURE_SOURCE not in sources:
        return done("no_scripture_source")
    spans = _quote_spans(query, _QUERY_QUOTE_PAIRS)
    quotes = [(normalize(query[a:b]), (s, e)) for s, e, a, b in spans]
    quotes = [(q, se) for q, se in quotes if len(q) >= LOOKUP_MIN_QUOTE]
    if not quotes:
        return done("no_quote")
    quote, (qs, qe) = max(quotes, key=lambda x: len(x[0]))
    record["quote"] = query[qs:qe][:80]
    # 위치를 묻는 말은 인용 밖에서만 찾는다(인용 안의 "어디"로 잘못 들어오지 않게).
    outside, prev = [], 0
    for s, e, _, _ in spans:
        outside.append(query[prev:s])
        prev = e
    outside.append(query[prev:])
    if not _LOCATION_ASK_RE.search(" ".join(outside)):
        return done("no_location_ask")
    try:
        index = await get_book_index()
    except Exception as exc:  # 색인 실패는 조회만 건너뛴다
        record["error"] = type(exc).__name__
        return done("index_error")
    # quote 는 이미 정규화했다(두 번 정규화하지 않는다).
    matches = index.find_exact(quote, limit=LOOKUP_MAX_MATCHES) or index.find_near(
        quote, limit=LOOKUP_MAX_MATCHES
    )
    if not matches:
        return done("miss")

    existing = {(r.volume, r.chunk_index): r for r in results}
    front: list[SearchResult] = []
    seen: set[tuple[str, int]] = set()
    for m in matches:
        for ci in m.chunk_indexes:
            k = (m.volume, ci)
            chunk = index.chunk(m.volume, ci)
            if k in seen or chunk is None:
                continue
            seen.add(k)
            if k in existing:
                front.append(replace(existing[k], rerank_score=1.0))
                continue
            front.append(
                SearchResult(
                    text=chunk.text,
                    volume=chunk.volume,
                    chunk_index=chunk.chunk_index,
                    score=1.0,
                    source=SCRIPTURE_SOURCE,
                    rerank_score=1.0,
                    chunk_id=chunk.chunk_id,
                    tags=(SCRIPTURE_SOURCE,),
                )
            )
    rest = [r for r in results if (r.volume, r.chunk_index) not in seen]
    record.update(
        routed=True,
        match=matches[0].kind,
        similarity=matches[0].similarity,
        locations=[result_key(r.volume, r.chunk_index) for r in front],
        ms=round((perf_counter() - t0) * 1000, 1),
    )
    return front + rest, record


# ---------------------------------------------------------------------------
# 2. 근거 부족 거절
# ---------------------------------------------------------------------------


def set_refusal_tau(tau: float) -> None:
    """보정한 τ 를 넣는다(환경 변수 없이). 테스트는 should_refuse(tau=) 를 써도 된다."""
    global REFUSAL_TAU
    REFUSAL_TAU = tau


def should_refuse(
    results: list[SearchResult], *, reranked: bool, tau: float | None = None
) -> tuple[bool, dict[str, Any]]:
    """rerank 최고점이 임계 τ 미만이면 거절. rerank 가 실패했으면 거절하지 않는다."""
    t = REFUSAL_TAU if tau is None else tau
    scores = [r.rerank_score for r in results if r.rerank_score is not None]
    top = max(scores) if scores else None
    refused = bool(reranked) and top is not None and top < t
    return refused, {"refused": refused, "top_score": top, "tau": t, "reranked": bool(reranked)}


# ---------------------------------------------------------------------------
# 3. 사후 인용 게이트
# ---------------------------------------------------------------------------


@dataclass
class _Item:
    kind: str  # "quote" | "marker" | "ref"
    text: str
    start: int  # 답변 안 위치 (quote: 따옴표 포함, marker/ref: 대괄호 포함)
    end: int
    verdict: str = ""
    location: str | None = None
    similarity: float | None = None
    volume: str | None = None  # quote 를 찾은 권
    inner: tuple[int, int] = (0, 0)  # quote 안쪽 구간
    replacement: str | None = None  # near: 원문으로 바꿀 안쪽 문자열
    marker_id: int = -1  # marker: 같은 대괄호의 권들을 묶는다


@dataclass
class _Check:
    raw: str
    fixed: str
    items: list[_Item] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        out = {"exact": 0, "other_evidence": 0, "near": 0, "fail": 0}
        for it in self.items:
            out[it.verdict] = out.get(it.verdict, 0) + 1
        return out

    @property
    def failed(self) -> list[_Item]:
        return [it for it in self.items if it.verdict == "fail"]


class _Books:
    """게이트 안에서 경전 색인이 필요할 때만 한 번 읽는다. 실패하면 문맥만으로 판정한다."""

    def __init__(self) -> None:
        self.index: PassageIndex | None = None
        self.error: str | None = None
        self._tried = False

    async def get(self) -> PassageIndex | None:
        if not self._tried:
            self._tried = True
            try:
                self.index = await get_book_index()
            except Exception as exc:
                self.error = type(exc).__name__
        return self.index


def _volume_keys(volume: str) -> set[str]:
    stem = os.path.splitext(volume)[0]
    return {normalize(volume).lower(), normalize(stem).lower()}


def _clean_span(span: str) -> str:
    """PDF 줄바꿈(낱말 안에서도 끊긴다)을 지우고 공백을 하나로."""
    return re.sub(r"\s+", " ", span.replace("\r", "").replace("\n", "")).strip()


def _in_order(parts: list[str], text: str) -> bool:
    pos = 0
    for p in parts:
        j = text.find(p, pos)
        if j < 0:
            return False
        pos = j + len(p)
    return True


async def _judge_quote(
    it: _Item, nq: str, ctx_index: PassageIndex, ctx_norms: list[tuple[str, str]], books: _Books
) -> None:
    """정확(근거) → 다른 근거(경전 정확) → 근사(근거, 경전) → 실패 순으로 판정해 it 에 적는다."""

    def hit(verdict: str, m: PassageMatch) -> None:
        it.verdict, it.location, it.volume = verdict, ",".join(m.keys), m.volume
        if verdict == "near":
            it.similarity, it.replacement = m.similarity, _clean_span(m.span)

    found = ctx_index.find_exact(nq, limit=1)
    if found:
        return hit("exact", found[0])
    if "…" in nq:  # 생략 부호로 줄인 인용 — 조각이 한 문단 안에 순서대로 있으면 정확으로 본다
        parts = [p for p in nq.split("…") if len(p) >= 2]
        for key, norm in ctx_norms:
            if parts and _in_order(parts, norm):
                it.verdict, it.location = "exact", key
                return None
    book = await books.get()
    if book is not None:
        found = book.find_exact(nq, limit=1)
        if found:
            return hit("other_evidence", found[0])
    if len(nq) >= NEAR_MIN_LEN:
        found = ctx_index.find_near(nq, limit=1) or (book.find_near(nq, limit=1) if book else [])
        if found:
            return hit("near", found[0])
    it.verdict = "fail"
    return None


async def _check(
    answer: str, context: list[SearchResult], ctx_index: PassageIndex, books: _Books
) -> _Check:
    items: list[_Item] = []
    ctx_norms = [(result_key(r.volume, r.chunk_index), normalize(r.text)) for r in context]
    titles: set[str] = set()
    for v in (*SCRIPTURE_TITLES, *(r.volume for r in context)):
        titles |= _volume_keys(v)

    quote_spans = _quote_spans(answer, _QUOTE_PAIRS)
    for s, e, a, b in quote_spans:
        nq = normalize(answer[a:b])
        if len(nq) < GATE_MIN_QUOTE or nq.lower() in titles or _SERIES_TITLE_RE.match(nq):
            continue
        it = _Item("quote", answer[a:b], s, e, inner=(a, b))
        await _judge_quote(it, nq, ctx_index, ctx_norms, books)
        items.append(it)

    def inside_quote(pos: int) -> bool:
        return any(s <= pos < e for s, e, _, _ in quote_spans)

    ctx_volume_keys: set[str] = set()
    for r in context:
        ctx_volume_keys |= _volume_keys(r.volume)
    # 경전에서 확인한 인용(other_evidence)의 권은 출처 표기로도 받아 준다.
    other_keys: set[str] = set()
    for it in items:
        if it.verdict == "other_evidence" and it.volume:
            other_keys |= _volume_keys(it.volume)

    for mid, m in enumerate(_MARKER_RE.finditer(answer)):
        if inside_quote(m.start()):
            continue
        for vol in (v.strip() for v in m.group(1).split(",")):
            if not vol:
                continue
            keys = _volume_keys(vol)
            if keys & ctx_volume_keys:
                verdict = "exact"
            elif keys & other_keys:
                verdict = "other_evidence"
            else:
                verdict = "fail"
            items.append(_Item("marker", vol, m.start(), m.end(), verdict, marker_id=mid))

    for m in _REF_RE.finditer(answer):
        if inside_quote(m.start()):
            continue
        n = int(m.group(1))
        ok = 1 <= n <= len(context)
        loc = result_key(context[n - 1].volume, context[n - 1].chunk_index) if ok else None
        verdict = "exact" if ok else "fail"
        items.append(_Item("ref", m.group(0), m.start(), m.end(), verdict, location=loc))

    protected = [(s, e) for s, e, _, _ in quote_spans]
    protected += [(m.start(), m.end()) for m in _MARKER_RE.finditer(answer)]
    return _Check(raw=answer, fixed=_apply(answer, items, protected), items=items)


def _sentences(text: str, protected: list[tuple[int, int]]) -> list[tuple[int, int]]:
    cuts = [0]
    for m in _SENTENCE_CUT_RE.finditer(text):
        pos = m.end()
        if any(s < pos < e for s, e in protected):
            continue
        cuts.append(pos)
    cuts.append(len(text))
    return [(a, b) for a, b in zip(cuts, cuts[1:]) if a < b]


def _followed_by_hangul(text: str, pos: int) -> bool:
    """닫는 따옴표 뒤(굵게 표시 ** 는 건너뜀)에 조사 등 한글이 붙어 있으면 문장 성분으로 박힌 인용이다."""
    while pos < len(text) and text[pos] in "*_":
        pos += 1
    return pos < len(text) and "가" <= text[pos] <= "힣"


def _content_len(text: str) -> int:
    return len(_CONTENT_RE.findall(_REF_RE.sub("", _MARKER_RE.sub("", text))))


def _apply(answer: str, items: list[_Item], protected: list[tuple[int, int]]) -> str:
    """판정대로 답변을 고친다. 실패 인용이 문장에 박혀 있으면(조사가 붙음) 문장째 지운다."""
    edits: list[tuple[int, int, str]] = []
    dropped: list[tuple[int, int]] = []
    fail_quotes = [it for it in items if it.kind == "quote" and it.verdict == "fail"]
    for a, b in _sentences(answer, protected):
        in_sent = [it for it in fail_quotes if a <= it.start < b]
        if not in_sent:
            continue
        remainder = answer[a:b]
        for it in sorted(in_sent, key=lambda x: -x.start):
            remainder = remainder[: it.start - a] + remainder[it.end - a :]
        embedded = any(_followed_by_hangul(answer, it.end) for it in in_sent)
        if embedded or _content_len(remainder) < _MIN_SENTENCE_CONTENT:
            dropped.append((a, b))
            edits.append((a, b, ""))
        else:
            edits.extend((it.start, it.end, "") for it in in_sent)

    def in_dropped(pos: int) -> bool:
        return any(a <= pos < b for a, b in dropped)

    for it in items:
        if in_dropped(it.start):
            continue
        if it.kind == "quote" and it.verdict == "near" and it.replacement:
            edits.append((it.inner[0], it.inner[1], it.replacement))
        elif it.kind == "ref" and it.verdict == "fail":
            edits.append((it.start, it.end, ""))
    markers: dict[int, list[_Item]] = {}
    for it in items:
        if it.kind == "marker" and not in_dropped(it.start):
            markers.setdefault(it.marker_id, []).append(it)
    for group in markers.values():
        if all(it.verdict != "fail" for it in group):
            continue
        keep = [it.text for it in group if it.verdict != "fail"]
        edits.append((group[0].start, group[0].end, f"[출처: {', '.join(keep)}]" if keep else ""))

    out = answer
    for s, e, rep in sorted(edits, key=lambda x: -x[0]):
        out = out[:s] + rep + out[e:]
    return _tidy(out) if edits else out


def _tidy(text: str) -> str:
    text = re.sub(r"\(\s*\)", "", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"[ \t]+([.,!?])", r"\1", text)
    text = re.sub(r"(?m)^[ \t]*(?:[-*•>]|\d+\.)[ \t]*$\n?", "", text)
    text = re.sub(r"(?m)[ \t]+$", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _regenerate_note(failed: list[_Item]) -> str:
    lines = []
    for it in failed[:10]:
        if it.kind == "quote":
            lines.append(f"- 인용 ‘{it.text[:80]}’")
        elif it.kind == "marker":
            lines.append(f"- 출처 표기 [출처: {it.text[:80]}]")
        else:
            lines.append(f"- 번호 {it.text}")
    return (
        "직전 답변의 아래 인용·출처를 말씀 문단에서 확인하지 못했습니다.\n"
        + "\n".join(lines)
        + "\n말씀 문단에 실제로 있는 문장만 그대로 인용하고, 출처는 말씀 문단의 [출처: …]에 적힌"
        " 이름만 쓰세요. 문단에 없는 문장은 따옴표로 인용하지 말고 빼세요."
    )


def _item_record(it: _Item) -> dict[str, Any]:
    rec: dict[str, Any] = {
        "type": it.kind,
        "text": it.text[:80],
        "verdict": it.verdict,
        "location": it.location,
    }
    if it.similarity is not None and it.verdict == "near":
        rec["similarity"] = it.similarity
    return rec


def _attempt(check: _Check) -> dict[str, Any]:
    return {
        "answer": check.raw,
        "counts": check.counts,
        "failed": [_item_record(it) for it in check.failed],
    }


async def citation_gate(
    answer: str,
    context: list[SearchResult],
    *,
    regenerate: Callable[[str], Awaitable[str]],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    """답변의 인용구·출처를 근거와 대조한다. (최종 답변, 판정 기록, 시도 목록).

    시도 목록은 재생성했을 때만 [첫 답변, 재생성 답변] 이고, 한 번이면 비어 있다.
    """
    t0 = perf_counter()
    ctx_index = PassageIndex(
        CorpusChunk(volume=r.volume, chunk_index=r.chunk_index, text=r.text) for r in context
    )
    books = _Books()
    first = await _check(answer, context, ctx_index, books)
    final = first
    record: dict[str, Any] = {"checked": True, "regenerated": False}
    attempts: list[dict[str, Any]] = []
    if len(first.failed) >= REGENERATE_MIN_FAILS:
        try:
            new_answer = await regenerate(_regenerate_note(first.failed))
        except Exception as exc:  # 재생성 실패면 첫 답변을 고친 것으로 끝낸다
            record["regenerate_error"] = type(exc).__name__
        else:
            if new_answer.strip():
                final = await _check(new_answer, context, ctx_index, books)
                record["regenerated"] = True
                record["first_counts"] = first.counts
                attempts = [_attempt(first), _attempt(final)]
            else:
                record["regenerate_error"] = "empty_answer"
    record["counts"] = final.counts
    record["items"] = [_item_record(it) for it in final.items]
    if books.error:
        record["book_index_error"] = books.error
    record["ms"] = round((perf_counter() - t0) * 1000, 1)
    return final.fixed, record, attempts
