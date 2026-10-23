"""C1 find_passage 오프라인 자기검사 — 경전(source U) chunk 덤프로 위치 찾기 정확도를 잰다.

평가 질문(골든셋)을 쓰지 않는다. 덤프 본문에서 문장을 무작위로 뽑아 그대로(verbatim) 또는
조금 바꿔(띄어쓰기·한 글자 오타·문장부호 빠짐) 찾게 하고, 원래 자리를 찾는지 본다.

사용 (apps/api 에서):
    uv run --frozen python -m scripts.experiments.c1_find_passage_selftest <u_chunks.jsonl> [--n 200] [--seed 20261008]

덤프 형식: 한 줄에 JSON 하나 {"k": "volume:chunk_index", "v": volume, "i": chunk_index, "text": ...}.
판정: 반환한 위치(최대 5개) 중 하나가 같은 권이고, 정규화 좌표에서 원래 문장 구간과 절반 이상 겹치면 정답.
같은 문장이 여러 곳에 있을 수 있어 "어느 하나라도 맞음"을 기준으로 하고, 1순위 정답률도 함께 낸다.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import statistics
from pathlib import Path
from time import perf_counter

from app.modules.chat.experiments.passage_index import CorpusChunk, PassageIndex, normalize

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+")
_PUNCT = set(",.!?·:;")
_PERTURB_KINDS = ("spacing", "typo", "punct")


def _load(path: Path) -> list[CorpusChunk]:
    chunks: list[CorpusChunk] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                d = json.loads(line)
                chunks.append(CorpusChunk(volume=d["v"], chunk_index=int(d["i"]), text=d["text"]))
    return chunks


def _candidates(
    index: PassageIndex, chunks: list[CorpusChunk]
) -> list[tuple[CorpusChunk, str, tuple[int, int]]]:
    """(chunk, 원문 문장, 권 단위 정규화 좌표의 정답 구간)."""
    out: list[tuple[CorpusChunk, str, tuple[int, int]]] = []
    for c in chunks:
        span = index.chunk_span(c.volume, c.chunk_index)
        if span is None:
            continue
        chunk_norm = normalize(c.text)
        for sent in _SENT_SPLIT.split(c.text):
            sent = sent.strip()
            ns = normalize(sent)
            if not (15 <= len(ns) <= 60) or not re.search(r"[가-힣]{5}", sent):
                continue
            off = chunk_norm.find(ns)
            if off < 0:
                continue
            out.append((c, sent, (span[0] + off, span[0] + off + len(ns))))
    return out


def _perturb(sent: str, kind: str, rng: random.Random) -> tuple[str, str]:
    chars = list(sent)
    if kind == "spacing":
        t = list(sent.replace(" ", ""))
        for _ in range(2):
            t.insert(rng.randrange(1, len(t)), rng.choice([" ", "\n"]))
        return "".join(t), kind
    if kind == "punct":
        # 끝 문장부호를 빼면 원문의 부분 문자열이라 정확 일치가 된다. 안쪽 부호를 먼저 뺀다.
        pos = [i for i, ch in enumerate(chars[:-1]) if ch in _PUNCT] or [
            i for i, ch in enumerate(chars) if ch in _PUNCT
        ]
        if pos:
            del chars[rng.choice(pos)]
            return "".join(chars), kind
        kind = "punct_none_typo"  # 문장부호가 없으면 오타로 대신한다
    pos = [i for i, ch in enumerate(chars) if "가" <= ch <= "힣"]
    i = rng.choice(pos)
    new = chars[i]
    while new == chars[i]:
        new = chr(rng.randint(0xAC00, 0xD7A3))
    chars[i] = new
    return "".join(chars), kind


def _shuffle_words(sent: str, rng: random.Random) -> str | None:
    """음성 대조군 — 어절 순서를 섞은 문장. 어절이 4개 미만이면 None."""
    words = sent.split()
    if len(words) < 4:
        return None
    shuffled = words[:]
    while shuffled == words:
        rng.shuffle(shuffled)
    return " ".join(shuffled)


def _judge(index: PassageIndex, query: str, volume: str, truth: tuple[int, int]) -> dict:
    t0 = perf_counter()
    matches = index.find_passage(query, limit=5)
    ms = (perf_counter() - t0) * 1000
    need = (truth[1] - truth[0]) / 2

    def ok(m) -> bool:
        return m.volume == volume and min(m.end, truth[1]) - max(m.start, truth[0]) >= need

    correct = [m for m in matches if ok(m)]
    return {
        "ms": ms,
        "returned": bool(matches),
        "correct": bool(correct),
        "top1": bool(matches) and ok(matches[0]),
        "kind": correct[0].kind if correct else (matches[0].kind if matches else None),
    }


def _summary(rows: list[dict]) -> dict:
    n = len(rows)
    ms = sorted(r["ms"] for r in rows)
    return {
        "n": n,
        "correct_rate": round(sum(r["correct"] for r in rows) / n, 4),
        "exact_correct_rate": round(sum(r["correct"] and r["kind"] == "exact" for r in rows) / n, 4),
        "near_correct_rate": round(sum(r["correct"] and r["kind"] == "near" for r in rows) / n, 4),
        "top1_correct_rate": round(sum(r["top1"] for r in rows) / n, 4),
        "wrong_location_rate": round(sum(r["returned"] and not r["correct"] for r in rows) / n, 4),
        "miss_rate": round(sum(not r["returned"] for r in rows) / n, 4),
        "ms_mean": round(statistics.mean(ms), 2),
        "ms_p95": round(ms[int(0.95 * (n - 1))], 2),
        "ms_max": round(ms[-1], 2),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("dump", type=Path)
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=20261008)
    args = ap.parse_args()

    chunks = _load(args.dump)
    t0 = perf_counter()
    index = PassageIndex(chunks)
    build_s = perf_counter() - t0

    rng = random.Random(args.seed)
    pool = _candidates(index, chunks)
    sample = rng.sample(pool, args.n)

    verbatim = [_judge(index, sent, c.volume, truth) for c, sent, truth in sample]
    perturbed: list[dict] = []
    for i, (c, sent, truth) in enumerate(sample):
        query, kind = _perturb(sent, _PERTURB_KINDS[i % len(_PERTURB_KINDS)], rng)
        row = _judge(index, query, c.volume, truth)
        row["perturb"] = kind
        perturbed.append(row)

    # 음성 대조군: 원문 어디에도 없어야 할 문장. 무엇이든 돌려주면 거짓 양성이다.
    negatives = [q for q in (_shuffle_words(sent, rng) for _, sent, _ in sample) if q]
    false_pos = [q for q in negatives if index.find_passage(q, limit=1)]

    by_kind: dict[str, dict] = {}
    for kind in sorted({r["perturb"] for r in perturbed}):
        by_kind[kind] = _summary([r for r in perturbed if r["perturb"] == kind])
    report = {
        "corpus": {"chunks": len(chunks), "volumes": index.volumes, "build_s": round(build_s, 2)},
        "sample": {"pool": len(pool), "n": args.n, "seed": args.seed},
        "verbatim": _summary(verbatim),
        "perturbed": _summary(perturbed),
        "perturbed_by_kind": by_kind,
        "negative_shuffled": {
            "n": len(negatives),
            "false_positive_rate": round(len(false_pos) / max(len(negatives), 1), 4),
            "examples": false_pos[:3],
        },
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
