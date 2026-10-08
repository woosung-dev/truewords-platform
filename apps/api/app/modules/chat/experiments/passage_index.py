"""C1 구절 색인 — 정규화한 본문에서 인용구의 정확·근사 위치를 찾는다.

외부 의존 없이(앱 설정·Qdrant 를 import 하지 않는다) 메모리 corpus 로 만든다.
오프라인 자기검사 스크립트와 테스트가 그대로 쓸 수 있게 하려는 것이다.

- 정규화: NFC → 한자·공백·따옴표 제거 → ``...`` 를 ``…`` 로 → 빈 괄호 ``()`` 제거.
- 같은 권의 chunk 는 chunk_index 순서로 이어 붙이고, 앞뒤 chunk 의 겹침(청킹 overlap)은
  한 번만 남긴다. 그래서 chunk 경계를 넘는 인용도 한 문자열 안에서 찾는다.
- 근사: 정규화 길이 ``NEAR_MIN_LEN`` 이상일 때만. 유사도 = 1 - 편집거리/인용 길이.
  비둘기집 원리로 후보 창을 고른 뒤(편집 d 회면 d+1 조각 중 하나는 그대로 나온다)
  Myers 비트 병렬 근사 검색으로 확인한다.
"""
from __future__ import annotations

import re
import unicodedata
from bisect import bisect_right
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

NEAR_MIN_LEN = 15
NEAR_MIN_SIM = 0.9
# 인접 chunk 겹침으로 인정할 최소 길이. 이보다 짧은 접미·접두 일치는 우연으로 본다.
_MIN_OVERLAP = 8
_MAX_OVERLAP = 400
# 조각 하나가 이보다 자주 나오면 그 조각은 후보 생성에서 뺀다(병적 반복 문자열 방어).
_MAX_PIECE_HITS = 5000
# 이어지지 않는 chunk 사이 구분자. 정규화 문자열에는 나오지 않는다.
_SEP = "\x00"

_QUOTE_CHARS = "‘’“”「」『』'\"《》〈〉"
_HANJA_CLASS = "㐀-䶿一-鿿豈-﫿"
# normalize_with_map 의 _drops() 와 같은 문자 집합이어야 한다(테스트로 고정).
_DROP_RE = re.compile(rf"[\s{_HANJA_CLASS}{re.escape(_QUOTE_CHARS)}\x00]")


def _drops(ch: str) -> bool:
    return (
        ch.isspace()
        or ch in _QUOTE_CHARS
        or ch == _SEP
        or "㐀" <= ch <= "䶿"
        or "一" <= ch <= "鿿"
        or "豈" <= ch <= "﫿"
    )


def normalize(text: str) -> str:
    """대조용 정규화 문자열."""
    s = _DROP_RE.sub("", unicodedata.normalize("NFC", text))
    return s.replace("...", "…").replace("()", "")


def normalize_with_map(text: str) -> tuple[str, list[int], str]:
    """(정규화 문자열, 각 문자의 NFC 원문 위치, NFC 원문). normalize() 와 결과가 같다."""
    nfc = unicodedata.normalize("NFC", text)
    kept = [(ch, i) for i, ch in enumerate(nfc) if not _drops(ch)]
    # str.replace 와 같은 왼쪽→오른쪽 비중첩 치환을 두 번 차례로 한다.
    dotted: list[tuple[str, int]] = []
    i = 0
    while i < len(kept):
        if kept[i][0] == "." and i + 2 < len(kept) and kept[i + 1][0] == "." and kept[i + 2][0] == ".":
            dotted.append(("…", kept[i][1]))
            i += 3
        else:
            dotted.append(kept[i])
            i += 1
    out: list[tuple[str, int]] = []
    i = 0
    while i < len(dotted):
        if dotted[i][0] == "(" and i + 1 < len(dotted) and dotted[i + 1][0] == ")":
            i += 2
        else:
            out.append(dotted[i])
            i += 1
    return "".join(ch for ch, _ in out), [p for _, p in out], nfc


def max_edits(length: int, min_sim: float = NEAR_MIN_SIM) -> int:
    """유사도 min_sim 이상으로 허용하는 최대 편집 수."""
    return int(length * (1 - min_sim) + 1e-9)


def myers_best(pattern: str, text: str) -> tuple[int, int]:
    """text 의 어떤 부분 문자열과 pattern 의 최소 편집거리와 그 끝 위치(배타).

    Myers(1999)/Hyyrö 비트 병렬 근사 검색. text 의 시작은 자유(첫 행 0)다.
    """
    m = len(pattern)
    if m == 0:
        return 0, 0
    peq: dict[str, int] = {}
    for i, ch in enumerate(pattern):
        peq[ch] = peq.get(ch, 0) | (1 << i)
    mask = (1 << m) - 1
    last = 1 << (m - 1)
    pv, mv, score = mask, 0, m
    best, best_end = m, 0
    for j, ch in enumerate(text):
        eq = peq.get(ch, 0)
        xv = eq | mv
        xh = (((eq & pv) + pv) ^ pv) | eq
        ph = mv | (~(xh | pv) & mask)
        mh = pv & xh
        if ph & last:
            score += 1
        elif mh & last:
            score -= 1
        ph = (ph << 1) & mask
        mh = (mh << 1) & mask
        pv = mh | (~(xv | ph) & mask)
        mv = ph & xv
        if score < best:
            best, best_end = score, j + 1
    return best, best_end


def _best_start(pattern: str, window: str) -> tuple[int, int]:
    """window 끝에서 끝나는 정렬 중 편집거리 최소인 시작 위치. (편집거리, 시작)."""
    qr, wr = pattern[::-1], window[::-1]
    prev = list(range(len(wr) + 1))
    for i in range(1, len(qr) + 1):
        cur = [i] + [0] * len(wr)
        qc = qr[i - 1]
        for j in range(1, len(wr) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (qc != wr[j - 1]))
        prev = cur
    m = len(pattern)
    # 편집거리가 같으면 인용 길이에 가장 가까운 구간을 고른다.
    ed, _, j_best = min((d, abs(j - m), j) for j, d in enumerate(prev))
    return ed, len(window) - j_best


def near_in(pattern: str, text: str, *, min_sim: float = NEAR_MIN_SIM) -> tuple[float, int, int] | None:
    """짧은 문자열(근거 문단 하나) 안의 근사 위치. (유사도, 시작, 끝) 또는 None."""
    m = len(pattern)
    if m < NEAR_MIN_LEN or not text:
        return None
    ed, end = myers_best(pattern, text)
    if ed > max_edits(m, min_sim):
        return None
    lo = max(0, end - m - max_edits(m, min_sim))
    ed, start = _best_start(pattern, text[lo:end])
    return 1 - ed / m, lo + start, end


@dataclass(frozen=True)
class CorpusChunk:
    volume: str
    chunk_index: int
    text: str
    chunk_id: str = ""

    @property
    def key(self) -> str:
        return f"{self.volume}:{self.chunk_index}"


@dataclass(frozen=True)
class PassageMatch:
    kind: Literal["exact", "near"]
    volume: str
    chunk_indexes: tuple[int, ...]
    similarity: float
    span: str  # 원문(NFC) 구간. 경계를 넘으면 chunk 별 구간을 이어 붙인다.
    start: int  # 권 단위 정규화 문자열 좌표
    end: int

    @property
    def keys(self) -> list[str]:
        return [f"{self.volume}:{i}" for i in self.chunk_indexes]


@dataclass
class _Volume:
    text: str
    chunks: list[CorpusChunk]
    starts: list[int]
    ends: list[int]


def _overlap(a: str, b: str) -> int:
    """a 의 접미와 b 의 접두가 같은 가장 긴 길이(_MIN_OVERLAP 미만은 0)."""
    if len(a) < _MIN_OVERLAP or len(b) < _MIN_OVERLAP:
        return 0
    tail = a[-_MAX_OVERLAP:]
    seed = b[:_MIN_OVERLAP]
    p = tail.find(seed)
    while p != -1:
        k = len(tail) - p
        if k <= len(b) and b[:k] == tail[p:]:
            return k
        p = tail.find(seed, p + 1)
    return 0


class PassageIndex:
    """권별로 이어 붙인 정규화 본문 색인. 만든 뒤에는 읽기만 한다."""

    def __init__(self, chunks: Iterable[CorpusChunk]) -> None:
        by_volume: dict[str, dict[int, CorpusChunk]] = {}
        for c in chunks:
            by_volume.setdefault(c.volume, {}).setdefault(c.chunk_index, c)
        self._chunks: dict[tuple[str, int], CorpusChunk] = {}
        self._volumes: dict[str, _Volume] = {}
        for volume in sorted(by_volume):
            vol = _Volume(text="", chunks=[], starts=[], ends=[])
            parts: list[str] = []
            cur = 0
            prev: tuple[int, str] | None = None
            for idx, chunk in sorted(by_volume[volume].items()):
                self._chunks[(volume, idx)] = chunk
                norm = normalize(chunk.text)
                if not norm:
                    continue
                k = 0
                if prev is not None:
                    if idx == prev[0] + 1:
                        k = _overlap(prev[1], norm)
                    else:
                        parts.append(_SEP)
                        cur += 1
                vol.chunks.append(chunk)
                vol.starts.append(cur - k)
                parts.append(norm[k:])
                cur += len(norm) - k
                vol.ends.append(cur)
                prev = (idx, norm)
            vol.text = "".join(parts)
            self._volumes[volume] = vol

    def __len__(self) -> int:
        return len(self._chunks)

    @property
    def volumes(self) -> list[str]:
        return list(self._volumes)

    def chunk(self, volume: str, chunk_index: int) -> CorpusChunk | None:
        return self._chunks.get((volume, chunk_index))

    def chunk_span(self, volume: str, chunk_index: int) -> tuple[int, int] | None:
        """chunk 가 권 단위 정규화 문자열에서 차지하는 구간(자기검사용)."""
        vol = self._volumes.get(volume)
        if vol is None:
            return None
        for i, c in enumerate(vol.chunks):
            if c.chunk_index == chunk_index:
                return vol.starts[i], vol.ends[i]
        return None

    # ---- 검색 -------------------------------------------------------------

    def find_passage(self, text: str, *, limit: int = 3) -> list[PassageMatch]:
        """정확 위치가 있으면 그것만, 없으면 근사 위치(유사도 높은 순)."""
        nq = normalize(text)
        if not nq:
            return []
        return self.find_exact(nq, limit=limit) or self.find_near(nq, limit=limit)

    def find_exact(self, nq: str, *, limit: int = 3) -> list[PassageMatch]:
        """nq 는 이미 정규화한 문자열."""
        out: list[PassageMatch] = []
        if not nq:
            return out
        for name, vol in self._volumes.items():
            p = vol.text.find(nq)
            while p != -1 and len(out) < limit:
                out.append(self._match("exact", name, vol, p, p + len(nq), 1.0))
                p = vol.text.find(nq, p + len(nq))
            if len(out) >= limit:
                break
        return out

    def find_near(
        self, nq: str, *, limit: int = 3, min_sim: float = NEAR_MIN_SIM
    ) -> list[PassageMatch]:
        """nq 는 이미 정규화한 문자열. 길이 NEAR_MIN_LEN 미만이면 찾지 않는다."""
        m = len(nq)
        d = max_edits(m, min_sim)
        if m < NEAR_MIN_LEN or d == 0:
            return []
        n_pieces = d + 1
        bounds = [m * i // n_pieces for i in range(n_pieces + 1)]
        found: list[tuple[int, str, int, int]] = []
        for name, vol in self._volumes.items():
            windows: list[tuple[int, int]] = []
            for i in range(n_pieces):
                piece, off = nq[bounds[i] : bounds[i + 1]], bounds[i]
                hits: list[int] = []
                p = vol.text.find(piece)
                while p != -1 and len(hits) <= _MAX_PIECE_HITS:
                    hits.append(p)
                    p = vol.text.find(piece, p + 1)
                if len(hits) > _MAX_PIECE_HITS:
                    continue
                for p in hits:
                    s = p - off
                    windows.append((max(0, s - d), min(len(vol.text), s + m + 2 * d)))
            for lo, hi in _merge(windows):
                ed, end = myers_best(nq, vol.text[lo:hi])
                if ed > d:
                    continue
                end += lo
                w_lo = max(lo, end - m - d)
                ed, start = _best_start(nq, vol.text[w_lo:end])
                found.append((ed, name, w_lo + start, end))
        found.sort()
        out: list[PassageMatch] = []
        taken: list[tuple[str, int, int]] = []
        for ed, name, a, b in found:
            if any(n == name and a < tb and ta < b for n, ta, tb in taken):
                continue
            taken.append((name, a, b))
            out.append(self._match("near", name, self._volumes[name], a, b, 1 - ed / m))
            if len(out) >= limit:
                break
        return out

    # ---- 내부 -------------------------------------------------------------

    def _match(
        self, kind: Literal["exact", "near"], name: str, vol: _Volume, a: int, b: int, sim: float
    ) -> PassageMatch:
        cover = _cover(vol, a, b)
        pieces: list[str] = []
        cursor = a
        for ci in cover:
            s, e = vol.starts[ci], vol.ends[ci]
            seg_a, seg_b = max(cursor, s), min(b, e)
            if seg_a >= seg_b:
                continue
            _norm, pos, nfc = normalize_with_map(vol.chunks[ci].text)
            pieces.append(nfc[pos[seg_a - s] : pos[seg_b - s - 1] + 1])
            cursor = seg_b
        return PassageMatch(
            kind=kind,
            volume=name,
            chunk_indexes=tuple(vol.chunks[ci].chunk_index for ci in cover),
            similarity=round(sim, 4),
            span="".join(pieces),
            start=a,
            end=b,
        )


def _merge(windows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for lo, hi in sorted(windows):
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], hi))
        else:
            merged.append((lo, hi))
    return merged


def _cover(vol: _Volume, a: int, b: int) -> list[int]:
    """[a, b) 를 품는 chunk 위치들. 한 chunk 가 다 품으면 그중 가장 앞의 것 하나."""
    i = bisect_right(vol.starts, a) - 1
    containing: list[int] = []
    j = i
    while j >= 0 and vol.ends[j] > a:
        containing.append(j)
        j -= 1
    if not containing:  # 구분자 위치 등 — 일어나지 않아야 한다
        return [max(i, 0)]
    containing.reverse()
    for c in containing:
        if vol.ends[c] >= b:
            return [c]
    cover = [containing[-1]]
    while vol.ends[cover[-1]] < b and cover[-1] + 1 < len(vol.starts):
        cover.append(cover[-1] + 1)
    return cover
