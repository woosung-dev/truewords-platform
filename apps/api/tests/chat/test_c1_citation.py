"""C1 실험 — 구절 색인·구절 조회·근거 부족 거절·사후 인용 게이트.

경전 corpus 는 메모리로 넣는다(Qdrant·Gemini 를 부르지 않는다).
"""
from __future__ import annotations

import random

import pytest

from app.modules.chat.experiments import c1_citation
from app.modules.chat.experiments.passage_index import (
    CorpusChunk,
    PassageIndex,
    myers_best,
    normalize,
    normalize_with_map,
)
from app.modules.search.hybrid import SearchResult

BOOK = [
    CorpusChunk(
        "원리강론.txt",
        0,
        "창조원리\n하나님은 모든 존재의 근원이시며 참사랑의 주체이십니다. 인간은 하나님의 자녀로 창조되었습니다.",
    ),
    # 0번 끝 문장과 겹친다(청킹 overlap).
    CorpusChunk(
        "원리강론.txt",
        1,
        "인간은 하나님의 자녀로 창조되었습니다. 인간은 성장기간을 거쳐 완성에 이르도록 되어 있습니다.",
    ),
    CorpusChunk(
        "천성경.pdf",
        5,
        "참사랑(眞愛)은 위하여 사는 사랑입니다. 남을 위하여 \n사는 삶이 하늘의 길입니다.",
    ),
    CorpusChunk("천성경.pdf", 6, "부모의 심정으로 자녀를 대하라는 말씀이 있습니다."),
]


@pytest.fixture(autouse=True)
def _book_corpus():
    c1_citation.set_book_corpus(BOOK)
    yield
    c1_citation.set_book_loader(None)


def _sr(chunk: CorpusChunk, *, rerank: float | None = None, source: str = "U") -> SearchResult:
    return SearchResult(
        text=chunk.text,
        volume=chunk.volume,
        chunk_index=chunk.chunk_index,
        score=0.1,
        source=source,
        rerank_score=rerank,
    )


OTHER = SearchResult(text="말씀선집 본문", volume="말씀선집 1권.pdf", chunk_index=3, score=0.2, source="A")


# ---------------------------------------------------------------------------
# 정규화 · 근사 검색 기본기
# ---------------------------------------------------------------------------


def test_normalize_drops_hanja_quotes_spaces_and_unifies_ellipsis() -> None:
    assert normalize("‘참사랑(眞愛)은’ 위하여  사는\n사랑...") == "참사랑은위하여사는사랑…"
    assert normalize("『원리강론』「창조」《말씀》〈장〉\"큰\" '작은'") == "원리강론창조말씀장큰작은"


@pytest.mark.parametrize(
    "text",
    [
        "참사랑(眞愛)은　위하여\xa0사는 사랑... 입니다",
        "( 眞 愛 )와 ((眞)) 그리고 (). . . 와 ....",
        "‘인용’ “인용” 「인용」 『인용』 《인용》 〈인용〉 '인용' \"인용\"",
    ],
)
def test_normalize_with_map_matches_normalize(text: str) -> None:
    norm, pos, nfc = normalize_with_map(text)
    assert norm == normalize(text)
    assert len(pos) == len(norm)
    assert all(nfc[p] == ch or ch == "…" for p, ch in zip(pos, norm))


def _edit_distance_substring(p: str, t: str) -> int:
    prev = [0] * (len(t) + 1)
    for i in range(1, len(p) + 1):
        cur = [i] + [0] * len(t)
        for j in range(1, len(t) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (p[i - 1] != t[j - 1]))
        prev = cur
    return min(prev)


def test_myers_matches_brute_force() -> None:
    rng = random.Random(7)
    for _ in range(300):
        p = "".join(rng.choice("가나다라") for _ in range(rng.randint(1, 12)))
        t = "".join(rng.choice("가나다라") for _ in range(rng.randint(0, 30)))
        assert myers_best(p, t)[0] == _edit_distance_substring(p, t)


# ---------------------------------------------------------------------------
# find_passage
# ---------------------------------------------------------------------------


def test_find_passage_exact_returns_location_and_original_span() -> None:
    index = PassageIndex(BOOK)
    [m] = index.find_passage("“참사랑은 위하여 사는 사랑입니다”")
    assert m.kind == "exact" and m.similarity == 1.0
    assert m.keys == ["천성경.pdf:5"]
    assert m.span == "참사랑(眞愛)은 위하여 사는 사랑입니다"


def test_find_passage_crosses_chunk_boundary() -> None:
    index = PassageIndex(BOOK)
    [m] = index.find_passage("하늘의 길입니다. 부모의 심정으로 자녀를")
    assert m.kind == "exact"
    assert m.keys == ["천성경.pdf:5", "천성경.pdf:6"]
    assert m.span == "하늘의 길입니다.부모의 심정으로 자녀를"


def test_find_passage_overlap_is_merged_once() -> None:
    index = PassageIndex(BOOK)
    # 겹친 문장 + 다음 chunk 본문 — 겹침을 두 번 이어 붙였다면 찾지 못한다.
    [m] = index.find_passage("참사랑의 주체이십니다. 인간은 하나님의 자녀로 창조되었습니다. 인간은 성장기간을")
    assert m.kind == "exact"
    assert m.keys == ["원리강론.txt:0", "원리강론.txt:1"]
    # 한 chunk 가 다 품으면 그 chunk 하나만.
    [m] = index.find_passage("인간은 하나님의 자녀로 창조되었습니다. 인간은 성장기간을")
    assert m.keys == ["원리강론.txt:1"]


def test_find_passage_near_with_one_typo() -> None:
    index = PassageIndex(BOOK)
    [m] = index.find_passage("참사랑은 위하여 사는 사람입니다.")
    assert m.kind == "near"
    assert m.similarity >= 0.9
    assert m.keys == ["천성경.pdf:5"]
    assert normalize(m.span) == normalize("참사랑은 위하여 사는 사랑입니다.")


def test_find_passage_miss_and_short_quotes_are_not_near_matched() -> None:
    index = PassageIndex(BOOK)
    assert index.find_passage("전혀 관계없는 문장으로 아무 데도 없는 내용입니다") == []
    # 정규화 15자 미만은 근사 검색을 하지 않는다.
    assert index.find_passage("참사랑은 위하여 사람") == []


# ---------------------------------------------------------------------------
# passage_lookup
# ---------------------------------------------------------------------------

LOOKUP_Q = "‘참사랑은 위하여 사는 사랑입니다. 남을 위하여’라는 말씀은 어디에 나오나요?"


@pytest.mark.asyncio
async def test_passage_lookup_routes_and_puts_found_chunk_first() -> None:
    results = [OTHER, _sr(BOOK[3], rerank=0.4)]
    out, rec = await c1_citation.passage_lookup(LOOKUP_Q, results, sources=["A", "U"])
    assert rec["routed"] is True and rec["match"] == "exact"
    assert rec["locations"] == ["천성경.pdf:5"]
    assert (out[0].volume, out[0].chunk_index) == ("천성경.pdf", 5)
    assert out[0].rerank_score == 1.0 and out[0].source == "U"
    assert out[1:] == results


@pytest.mark.asyncio
async def test_passage_lookup_dedupes_existing_result_and_keeps_rest_order() -> None:
    hit = _sr(BOOK[2], rerank=0.3)
    results = [OTHER, hit, _sr(BOOK[3], rerank=0.2)]
    out, rec = await c1_citation.passage_lookup(LOOKUP_Q, results, sources=["U"])
    assert rec["routed"] is True
    keys = [(r.volume, r.chunk_index) for r in out]
    assert keys == [("천성경.pdf", 5), ("말씀선집 1권.pdf", 3), ("천성경.pdf", 6)]
    assert out[0].rerank_score == 1.0


@pytest.mark.asyncio
async def test_passage_lookup_near_hit_routes() -> None:
    q = "“참사랑은 위하여 사는 사람입니다. 남을 위하여”는 어느 책에 있나요?"
    out, rec = await c1_citation.passage_lookup(q, [OTHER], sources=["U"])
    assert rec["routed"] is True and rec["match"] == "near"
    assert out[0].chunk_index == 5


@pytest.mark.parametrize(
    ("query", "sources", "reason"),
    [
        (LOOKUP_Q, ["A", "B"], "no_scripture_source"),
        ("‘참사랑’은 어디에 나오나요?", ["U"], "no_quote"),
        ("참사랑은 위하여 사는 사랑입니다는 어디에 나오나요?", ["U"], "no_quote"),
        ("‘참사랑은 위하여 사는 사랑입니다. 남을 위하여’의 뜻을 풀어 주세요", ["U"], "no_location_ask"),
        ("‘어디에 계시든 하나님은 우리와 함께하십니다’를 풀어 주세요", ["U"], "no_location_ask"),
        ("‘전혀 관계없는 문장으로 아무 데도 없는 내용’의 출처는?", ["U"], "miss"),
    ],
)
@pytest.mark.asyncio
async def test_passage_lookup_not_routed(query: str, sources: list[str], reason: str) -> None:
    results = [OTHER]
    out, rec = await c1_citation.passage_lookup(query, results, sources=sources)
    assert out is results
    assert rec["routed"] is False and rec["reason"] == reason


@pytest.mark.asyncio
async def test_passage_lookup_index_error_is_recorded_not_raised() -> None:
    async def broken() -> list[CorpusChunk]:
        raise ConnectionError("qdrant down")

    c1_citation.set_book_loader(broken)
    out, rec = await c1_citation.passage_lookup(LOOKUP_Q, [OTHER], sources=["U"])
    assert out == [OTHER]
    assert rec["reason"] == "index_error" and rec["error"] == "ConnectionError"


# ---------------------------------------------------------------------------
# should_refuse
# ---------------------------------------------------------------------------


def test_should_refuse_below_tau_only_when_reranked() -> None:
    low = [_sr(BOOK[0], rerank=0.2), _sr(BOOK[1], rerank=0.1)]
    refused, rec = c1_citation.should_refuse(low, reranked=True, tau=0.5)
    assert refused is True
    assert rec == {"refused": True, "top_score": 0.2, "tau": 0.5, "reranked": True}

    assert c1_citation.should_refuse([_sr(BOOK[0], rerank=0.7)], reranked=True, tau=0.5)[0] is False
    # rerank 실패(점수 없음 또는 reranked=False)면 거절하지 않는다.
    assert c1_citation.should_refuse(low, reranked=False, tau=0.5)[0] is False
    assert c1_citation.should_refuse([_sr(BOOK[0])], reranked=True, tau=0.5)[0] is False


def test_should_refuse_default_tau_placeholder_and_setter() -> None:
    zero = [_sr(BOOK[0], rerank=0.0)]
    assert c1_citation.REFUSAL_TAU == 0.0
    assert c1_citation.should_refuse(zero, reranked=True)[0] is False
    try:
        c1_citation.set_refusal_tau(0.3)
        refused, rec = c1_citation.should_refuse(zero, reranked=True)
        assert refused is True and rec["tau"] == 0.3
    finally:
        c1_citation.set_refusal_tau(0.0)


# ---------------------------------------------------------------------------
# citation_gate
# ---------------------------------------------------------------------------

CTX = [_sr(BOOK[2]), _sr(BOOK[0])]
FAKE = "전혀 없는 가짜 문장을 지어낸 인용입니다"


class _Regen:
    def __init__(self, answer: str | Exception) -> None:
        self.answer = answer
        self.notes: list[str] = []

    async def __call__(self, note: str) -> str:
        self.notes.append(note)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def _verdicts(rec: dict) -> list[tuple[str, str]]:
    return [(i["type"], i["verdict"]) for i in rec["items"]]


@pytest.mark.asyncio
async def test_gate_keeps_exact_quote_and_valid_marker() -> None:
    answer = "참부모님은 ‘참사랑은 위하여 사는 사랑입니다’라고 하셨습니다. [출처: 천성경.pdf] [1]"
    regen = _Regen("x")
    out, rec, attempts = await c1_citation.citation_gate(answer, CTX, regenerate=regen)
    assert out == answer
    assert _verdicts(rec) == [("quote", "exact"), ("marker", "exact"), ("ref", "exact")]
    assert rec["items"][0]["location"] == "천성경.pdf:5"
    assert rec["counts"]["fail"] == 0 and rec["regenerated"] is False
    assert attempts == [] and regen.notes == []


@pytest.mark.asyncio
async def test_gate_other_evidence_quote_is_kept_and_its_marker_accepted() -> None:
    answer = "원리강론에는 ‘인간은 성장기간을 거쳐 완성에 이르도록 되어 있습니다’라고 합니다. [출처: 원리강론.txt]"
    out, rec, _ = await c1_citation.citation_gate(answer, [_sr(BOOK[2])], regenerate=_Regen("x"))
    assert out == answer
    assert _verdicts(rec) == [("quote", "other_evidence"), ("marker", "other_evidence")]
    assert rec["items"][0]["location"] == "원리강론.txt:1"


@pytest.mark.asyncio
async def test_gate_near_quote_is_replaced_with_original_span() -> None:
    answer = "말씀에 ‘참사랑은 위하여 사는 사람입니다. 남을 위하여’라고 했습니다."
    out, rec, _ = await c1_citation.citation_gate(answer, CTX, regenerate=_Regen("x"))
    assert out == "말씀에 ‘참사랑(眞愛)은 위하여 사는 사랑입니다. 남을 위하여’라고 했습니다."
    assert _verdicts(rec) == [("quote", "near")]
    assert rec["items"][0]["similarity"] >= 0.9


@pytest.mark.asyncio
async def test_gate_ellipsis_quote_within_one_passage_is_exact() -> None:
    answer = "말씀에 ‘참사랑은 위하여 … 하늘의 길입니다’라고 했습니다."
    out, rec, _ = await c1_citation.citation_gate(answer, CTX, regenerate=_Regen("x"))
    assert out == answer
    assert _verdicts(rec) == [("quote", "exact")]


@pytest.mark.asyncio
async def test_gate_fail_quote_embedded_drops_sentence() -> None:
    answer = f"참부모님은 ‘{FAKE}’라고 하셨습니다. 다른 문장은 그대로 남습니다."
    regen = _Regen("x")
    out, rec, attempts = await c1_citation.citation_gate(answer, CTX, regenerate=regen)
    assert out == "다른 문장은 그대로 남습니다."
    assert _verdicts(rec) == [("quote", "fail")]
    # 실패 1건이면 재생성하지 않는다.
    assert regen.notes == [] and attempts == [] and rec["regenerated"] is False


@pytest.mark.asyncio
async def test_gate_fail_quote_standalone_removes_only_quote() -> None:
    answer = f"참사랑의 핵심은 남을 위하여 사는 삶이라는 점을 기억해야 합니다 “{FAKE}”. 끝."
    out, _rec, _ = await c1_citation.citation_gate(answer, CTX, regenerate=_Regen("x"))
    assert out == "참사랑의 핵심은 남을 위하여 사는 삶이라는 점을 기억해야 합니다. 끝."


@pytest.mark.asyncio
async def test_gate_skips_book_titles() -> None:
    answer = "『하늘 섭리로 본 참부모님의 위상과 가치』와 『말씀선집 333권』을 함께 읽으세요."
    out, rec, _ = await c1_citation.citation_gate(answer, CTX, regenerate=_Regen("x"))
    assert out == answer and rec["items"] == []


@pytest.mark.asyncio
async def test_gate_marker_and_ref_fixes() -> None:
    answer = "참사랑은 위하는 사랑입니다 [출처: 없는책.pdf, 천성경.pdf]. 성장기간이 있습니다 [출처: 원리강론]."
    out, rec, _ = await c1_citation.citation_gate(answer, CTX, regenerate=_Regen("x"))
    assert out == "참사랑은 위하는 사랑입니다 [출처: 천성경.pdf]. 성장기간이 있습니다 [출처: 원리강론]."
    assert _verdicts(rec) == [("marker", "fail"), ("marker", "exact"), ("marker", "exact")]


@pytest.mark.asyncio
async def test_gate_regenerates_exactly_once_at_two_fails() -> None:
    answer = f"설명입니다 [출처: 없는책.pdf]. 참부모님은 ‘{FAKE}’라고 하셨습니다. 근거 [3]"
    second = f"다시 씁니다 [출처: 또없는책.pdf]. 참부모님은 ‘{FAKE}’라고 하셨습니다. 남는 문장입니다."
    regen = _Regen(second)
    out, rec, attempts = await c1_citation.citation_gate(answer, CTX, regenerate=regen)
    assert len(regen.notes) == 1  # 두 번째 답도 실패 2건이지만 다시 부르지 않는다
    assert FAKE in regen.notes[0] and "없는책.pdf" in regen.notes[0] and "[3]" in regen.notes[0]
    assert rec["regenerated"] is True
    assert rec["first_counts"]["fail"] == 3 and rec["counts"]["fail"] == 2
    assert [a["answer"] for a in attempts] == [answer, second]
    assert out == "다시 씁니다. 남는 문장입니다."


@pytest.mark.asyncio
async def test_gate_regenerate_error_keeps_fixed_first_answer() -> None:
    answer = f"설명입니다 [출처: 없는책.pdf]. 참부모님은 ‘{FAKE}’라고 하셨습니다."
    regen = _Regen(RuntimeError("gemini"))
    out, rec, attempts = await c1_citation.citation_gate(answer, CTX, regenerate=regen)
    assert len(regen.notes) == 1
    assert rec["regenerate_error"] == "RuntimeError" and rec["regenerated"] is False
    assert attempts == []
    assert out == "설명입니다."


@pytest.mark.asyncio
async def test_gate_book_index_error_falls_back_to_context_only() -> None:
    async def broken() -> list[CorpusChunk]:
        raise ConnectionError("qdrant down")

    c1_citation.set_book_loader(broken)
    answer = "원리강론에는 ‘인간은 성장기간을 거쳐 완성에 이르도록 되어 있습니다’라고 합니다. 끝입니다."
    out, rec, _ = await c1_citation.citation_gate(answer, [_sr(BOOK[2])], regenerate=_Regen("x"))
    assert rec["book_index_error"] == "ConnectionError"
    assert _verdicts(rec) == [("quote", "fail")]
    assert out == "끝입니다."
