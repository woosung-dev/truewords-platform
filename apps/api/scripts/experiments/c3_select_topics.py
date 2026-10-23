"""C3 용어 카드 주제 선정 — 원리강론 절(節) 제목 중 chunk 가 가장 많은 20개.

평가 질문을 보지 않고 정하기 위한 결정적 규칙이다.

1. 덤프에서 volume == "원리강론.txt" 인 chunk 를 chunk_index 순으로 읽는다.
2. 각 줄의 NBSP 를 공백으로 바꾸고 공백을 하나로 줄인 뒤, 다음 모양만 제목으로 본다.
   - 장(章): ``제N장 <제목>`` / 절(節): ``제N절 <제목>``
   - 장·절 숫자 바로 뒤에 공백이 있어야 한다 ("제1장의 ..." 같은 본문 참조 제외).
   - 제목이 "제" 로 시작하거나 "." 을 담으면 본문 참조로 보고 제외한다
     ("제7장 제1절). 그러나 ..." 등).
   - 끝에 붙은 쪽 번호(공백 + 숫자)는 지운다. 글자마다 띄운 제목("창 조 목 적")은 붙인다.
   - 줄 전체가 "후편" 이면 그 뒤 장·절은 후편이다. 그 전은 전편이다. "후편" 줄도 경계로 쓴다.
3. chunk 는 앞뒤가 겹쳐 같은 제목이 이웃 chunk 에 두 번 나올 수 있다.
   직전 chunk 에서 이미 본 같은 제목은 건너뛴다.
4. 절의 범위 = 제목이 처음 나온 chunk 부터 다음 경계(장·절 제목 또는 "후편")가 나온 chunk 직전까지.
   마지막 절은 덤프 끝까지. 범위 길이(최소 1)가 chunk 수다.
   덤프에는 후편 제3장 본문이 한 번 더 들어 있다(chunk 646~689). 같은 라벨이 다시 나오면
   경계로만 쓰고 후보는 첫 번째 것만 둔다.
5. 절만 후보로 하고 (chunk 수 내림차순, 시작 chunk 오름차순)으로 20개를 고른다.

출력: 고른 목록과 그 목록(탭 구분 "라벨\\t시작\\t끝(제외)" 줄들)의 sha256.

사용:
    uv run --frozen python scripts/experiments/c3_select_topics.py <u_chunks.jsonl>
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

VOLUME = "원리강론.txt"
TOP_N = 20
_HEADING = re.compile(r"^제\s*(\d+)\s*(장|절)\s+(.+)$")
_TRAILING_PAGE = re.compile(r"\s+\d+$")


@dataclass(frozen=True)
class Heading:
    part: str  # 전편 | 후편
    level: str  # 편 | 장 | 절
    number: int
    title: str
    chunk_index: int


@dataclass(frozen=True)
class Topic:
    label: str
    title: str
    start: int
    end: int  # 제외

    @property
    def chunks(self) -> int:
        return max(1, self.end - self.start)


def _norm_line(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace("\xa0", " ").replace("﻿", "")).strip()


def _clean_title(raw: str) -> str:
    title = _TRAILING_PAGE.sub("", raw).strip()
    tokens = title.split(" ")
    if len(tokens) > 1 and all(len(t) == 1 for t in tokens):
        title = "".join(tokens)
    return title


def load_chunks(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if row["v"] == VOLUME:
                rows.append(row)
    return sorted(rows, key=lambda r: r["i"])


def find_headings(chunks: list[dict]) -> list[Heading]:
    headings: list[Heading] = []
    part = "전편"
    last_seen: dict[str, int] = {}
    for row in chunks:
        for raw_line in row["text"].split("\n"):
            line = _norm_line(raw_line)
            if line.replace(" ", "") == "후편":
                part = "후편"
                headings.append(Heading(part, "편", 0, "후편", row["i"]))
                continue
            m = _HEADING.match(line)
            if not m:
                continue
            raw_title = m.group(3)
            if raw_title.startswith("제") or "." in raw_title:
                continue
            title = _clean_title(raw_title)
            key = f"{part}|{m.group(2)}|{m.group(1)}|{title}"
            prev = last_seen.get(key)
            last_seen[key] = row["i"]
            if prev is not None and row["i"] - prev <= 1:
                continue  # chunk 겹침으로 다시 나온 같은 제목
            headings.append(Heading(part, m.group(2), int(m.group(1)), title, row["i"]))
    return headings


def build_topics(chunks: list[dict]) -> list[Topic]:
    headings = find_headings(chunks)
    end_of_dump = chunks[-1]["i"] + 1
    topics: list[Topic] = []
    seen: set[str] = set()
    chapter = 0
    for n, h in enumerate(headings):
        if h.level != "절":
            chapter = h.number
            continue
        end = headings[n + 1].chunk_index if n + 1 < len(headings) else end_of_dump
        label = f"{h.part} 제{chapter}장 제{h.number}절 {h.title}"
        if label in seen:
            continue  # 덤프 안 본문 반복
        seen.add(label)
        topics.append(Topic(label, h.title, h.chunk_index, end))
    return topics


def select_topics(chunks: list[dict], top_n: int = TOP_N) -> list[Topic]:
    topics = build_topics(chunks)
    return sorted(topics, key=lambda t: (-t.chunks, t.start))[:top_n]


def topics_digest(topics: list[Topic]) -> str:
    payload = "\n".join(f"{t.label}\t{t.start}\t{t.end}" for t in topics)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("사용: c3_select_topics.py <u_chunks.jsonl>")
    chunks = load_chunks(Path(sys.argv[1]))
    all_topics = build_topics(chunks)
    selected = select_topics(chunks)
    print(f"원리강론 chunk {len(chunks)}개, 절 {len(all_topics)}개 중 {len(selected)}개")
    for rank, t in enumerate(selected, 1):
        print(f"{rank:2d}. [{t.chunks:3d}] {t.start}-{t.end - 1}  {t.label}")
    print(f"sha256: {topics_digest(selected)}")


if __name__ == "__main__":
    main()
