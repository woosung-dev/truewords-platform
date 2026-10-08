"""C3 용어 카드 검사 — 인용이 원문 그대로인지, 본문 문장마다 앵커가 붙었는지 본다.

검사 항목 (하나라도 어기면 종료 코드 1)
1. 카드 20장, 필수 필드(slug·title·heading·aliases·body·anchors), slug 중복 없음.
   heading 집합 = `c3_select_topics.py` 가 고른 20개 주제.
2. 앵커: key 는 "volume:chunk_index" 이고 덤프에 있어야 한다.
   quote 는 공백만 모두 없앤 뒤 그 chunk 본문(역시 공백 제거)의 부분 문자열이어야 한다.
3. 본문: 600자 이하, 4~8문장. 문장마다 끝에 "(1)(2)" 같은 앵커 번호가 붙고
   번호는 1..앵커 수 범위다. 모든 앵커가 한 번 이상 쓰인다. 번호 없는 문장(중간의 ". ")은 실패.
4. 별칭: 카드마다 1~6개, 공백 제거 후 2자 이상, 일반어 금지 목록에 없음,
   한 카드 안 중복 없음. 서로 다른 카드의 별칭이 같거나 한쪽이 다른 쪽에 들어 있으면 충돌.

사용:
    uv run --frozen python scripts/experiments/c3_lint_cards.py <u_chunks.jsonl> [--cards PATH]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from c3_select_topics import load_chunks, select_topics  # noqa: E402

DEFAULT_CARDS = (
    Path(__file__).resolve().parents[2] / "app/modules/chat/experiments/c3_cards.json"
)
CARD_COUNT = 20
BODY_MAX_CHARS = 600
SENTENCES_MIN, SENTENCES_MAX = 4, 8
ALIASES_MIN, ALIASES_MAX = 1, 6
ALIAS_MIN_CHARS = 2
# 거의 모든 질문에 나올 일반어 — 별칭으로 쓰면 카드가 아무 데나 붙는다.
GENERIC_ALIASES = {
    "하나님", "사랑", "예수", "예수님", "성서", "성경", "말씀", "진리", "구원", "축복",
    "재림", "부활", "타락", "죄", "원리", "섭리", "메시아", "기도", "신앙", "천국",
}
REQUIRED = ("slug", "title", "heading", "aliases", "body", "anchors")
_WS = re.compile(r"\s+")
_ANCHOR_RUN = re.compile(r"((?:\(\d+\))+)")


def norm(text: str) -> str:
    return _WS.sub("", text)


def load_dump(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    with path.open(encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            out[row["k"]] = row["text"]
    return out


def split_body(body: str) -> tuple[list[tuple[str, list[int]]], str]:
    """(문장, 앵커 번호) 목록과 마지막 앵커 뒤 남은 글."""
    parts = _ANCHOR_RUN.split(body)
    sentences = []
    for i in range(0, len(parts) - 1, 2):
        nums = [int(n) for n in re.findall(r"\d+", parts[i + 1])]
        sentences.append((parts[i].strip(), nums))
    return sentences, parts[-1].strip()


def check_body(card: dict, errors: list[str]) -> int:
    slug, body, n_anchors = card["slug"], card["body"], len(card["anchors"])
    if len(body) > BODY_MAX_CHARS:
        errors.append(f"{slug}: 본문 {len(body)}자 > {BODY_MAX_CHARS}")
    sentences, tail = split_body(body)
    if tail:
        errors.append(f"{slug}: 앵커 없는 끝 문장 {tail[:30]!r}")
    if not SENTENCES_MIN <= len(sentences) <= SENTENCES_MAX:
        errors.append(f"{slug}: 문장 {len(sentences)}개 (허용 {SENTENCES_MIN}~{SENTENCES_MAX})")
    used: set[int] = set()
    for text, nums in sentences:
        if not text or text[-1] not in ".?!":
            errors.append(f"{slug}: 문장부호로 끝나지 않은 문장 {text[-30:]!r}")
        if re.search(r"[.?!]\s", text):
            errors.append(f"{slug}: 앵커 없는 중간 문장 {text[:40]!r}")
        for n in nums:
            if not 1 <= n <= n_anchors:
                errors.append(f"{slug}: 앵커 번호 ({n}) 범위 밖 (1~{n_anchors})")
            used.add(n)
    unused = sorted(set(range(1, n_anchors + 1)) - used)
    if unused:
        errors.append(f"{slug}: 본문에서 안 쓴 앵커 {unused}")
    return len(sentences)


def check_anchors(card: dict, dump: dict[str, str], errors: list[str]) -> tuple[int, int]:
    ok = 0
    for n, anchor in enumerate(card["anchors"], 1):
        key, quote = anchor.get("key", ""), anchor.get("quote", "")
        if not re.fullmatch(r".+:\d+", key):
            errors.append(f"{card['slug']} ({n}): key 형식 오류 {key!r}")
            continue
        text = dump.get(key)
        if text is None:
            errors.append(f"{card['slug']} ({n}): 덤프에 없는 key {key}")
        elif not norm(quote):
            errors.append(f"{card['slug']} ({n}): 빈 인용")
        elif norm(quote) not in norm(text):
            errors.append(f"{card['slug']} ({n}): {key} 에 없는 인용 {quote[:40]!r}")
        else:
            ok += 1
    return ok, len(card["anchors"])


def check_aliases(cards: list[dict], errors: list[str]) -> int:
    owners: list[tuple[str, str, str]] = []  # (정규화 별칭, 원래 별칭, slug)
    for card in cards:
        aliases = card["aliases"]
        if not ALIASES_MIN <= len(aliases) <= ALIASES_MAX:
            errors.append(f"{card['slug']}: 별칭 {len(aliases)}개 (허용 {ALIASES_MIN}~{ALIASES_MAX})")
        seen: set[str] = set()
        for alias in aliases:
            a = norm(alias)
            if len(a) < ALIAS_MIN_CHARS:
                errors.append(f"{card['slug']}: 별칭 {alias!r} 이 {ALIAS_MIN_CHARS}자 미만")
            if a in GENERIC_ALIASES:
                errors.append(f"{card['slug']}: 일반어 별칭 {alias!r}")
            if a in seen:
                errors.append(f"{card['slug']}: 공백만 다른 중복 별칭 {alias!r}")
            seen.add(a)
            owners.append((a, alias, card["slug"]))
    collisions = 0
    for i, (a, alias_a, slug_a) in enumerate(owners):
        for b, alias_b, slug_b in owners[i + 1 :]:
            if slug_a != slug_b and (a in b or b in a):
                collisions += 1
                errors.append(f"별칭 충돌: {slug_a} {alias_a!r} ↔ {slug_b} {alias_b!r}")
    return collisions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dump", type=Path)
    parser.add_argument("--cards", type=Path, default=DEFAULT_CARDS)
    args = parser.parse_args()

    dump = load_dump(args.dump)
    cards = json.loads(args.cards.read_text(encoding="utf-8"))
    errors: list[str] = []

    if len(cards) != CARD_COUNT:
        errors.append(f"카드 {len(cards)}장 (필요 {CARD_COUNT})")
    for card in cards:
        missing = [k for k in REQUIRED if not card.get(k)]
        if missing:
            sys.exit(f"{card.get('slug', '?')}: 필수 필드 없음 {missing}")
    slugs = [c["slug"] for c in cards]
    if len(set(slugs)) != len(slugs):
        errors.append("slug 중복")
    topics = {t.label for t in select_topics(load_chunks(args.dump))}
    headings = {c["heading"] for c in cards}
    for label in sorted(topics - headings):
        errors.append(f"카드 없는 주제: {label}")
    for label in sorted(headings - topics):
        errors.append(f"선정 주제가 아닌 heading: {label}")

    quotes_ok = quotes_total = sentences = 0
    for card in cards:
        ok, total = check_anchors(card, dump, errors)
        quotes_ok += ok
        quotes_total += total
        sentences += check_body(card, errors)
    collisions = check_aliases(cards, errors)

    print(f"카드 {len(cards)}장 · 주제 일치 {len(topics & headings)}/{len(topics)}")
    print(f"인용 원문 일치 {quotes_ok}/{quotes_total}")
    print(f"본문 문장 {sentences}개 · 최장 본문 {max(len(c['body']) for c in cards)}자")
    print(f"별칭 {sum(len(c['aliases']) for c in cards)}개 · 충돌 {collisions}건")
    for e in errors:
        print("FAIL", e)
    print("PASS" if not errors else f"FAIL ({len(errors)}건)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
