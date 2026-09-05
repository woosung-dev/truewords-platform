# 레드팀 시연 — 기존 Qdrant 컬렉션에서 짧은 말씀 후보 추출 + AI 주제 태깅 (큐레이션 1단계)
"""featured_malssum.json 을 채우기 위한 후보 추출 스크립트.

기존 운영 컬렉션(malssum_poc_v5)을 raw httpx scroll 로 훑어, source 카테고리별로
지정 길이 범위의 짧은 본문을 모은 뒤, 각 말씀을 **LLM 으로 주제(테마)** 분류해
``category`` 에 태깅한다(위로/교리/실천/가정/참사랑 등). 런타임의 답변-말씀 주제
매칭이 이 ``category`` 를 사용한다. 사람이 후보를 검토해 원하는 항목만 남겨
`app/modules/malssum/featured_malssum.json` 으로 옮기면 된다. (--no-theme 로 태깅 생략 가능)

말씀 노출은 별도 임베딩/컬렉션 없이 JSON + 주제 매칭으로 동작한다.

실행 예:
    uv run python scripts/extract_malssum_candidates.py \
        --categories O,B,M --per-category 30 \
        --out scripts/featured_malssum.candidates.json

카테고리 키: L 원리강론 / M 3대경전 / N 자서전 / O 말씀선집 / B 어머니말씀 /
            P 참부모론 / Q 통일사상요강 (app/modules/pipeline/metadata.py 기준)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

import httpx

# 프로젝트 루트(apps/api/)를 sys.path 에 추가 — `python scripts/...` 직접 실행 호환.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.modules.malssum.service import MALSSUM_THEMES  # noqa: E402


# source 키 → 읽기 쉬운 출처 이름 (metadata.py 카테고리 매핑 기준)
_SOURCE_LABELS = {
    "B": "어머님 말씀",
    "M": "3대 경전",
    "N": "자서전",
    "O": "말씀선집",
    "L": "원리강론",
    "P": "참부모론",
    "Q": "통일사상요강",
}


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if settings.qdrant_api_key:
        h["api-key"] = settings.qdrant_api_key.get_secret_value()
    return h


# 카드용 완결 본문만 — 제목/페이지 인용 조각/파일명 leak 제외, 문장 종결로 끝나야 함.
_PAGE_REF = re.compile(r"\(\d+-\d+")
_FILE_LEAK = re.compile(r"\.(txt|pdf|hwp)", re.IGNORECASE)
_SENT_END = re.compile(
    r"(다|요|까|라|죠|네|군요|십시오|하라|드립니다|아멘)[\"'’」』\)\s.!?]*$"
)


def _is_card_worthy(text: str) -> bool:
    t = text.strip()
    if _PAGE_REF.search(t) or _FILE_LEAK.search(t):
        return False  # RAG 청크 인용 조각 / 헤더 leak
    return bool(_SENT_END.search(t))  # 한국어 문장 종결로 끝나는 완결 본문만


_VOL_EXT = re.compile(r"\.(txt|pdf|hwpx?|docx?|pptx?)$", re.IGNORECASE)


def _clean_volume(volume: str) -> str:
    """volume 끝의 파일 확장자 제거 (예: '천성경.pdf' → '천성경')."""
    return _VOL_EXT.sub("", volume.strip())


async def _scroll_category(
    client: httpx.AsyncClient,
    base: str,
    collection: str,
    category: str,
    *,
    min_len: int,
    max_len: int,
    scan_limit: int,
) -> list[dict]:
    """단일 카테고리(source)를 scroll 하며 길이 범위 본문을 수집."""
    collected: list[dict] = []
    offset = None
    scanned = 0
    while scanned < scan_limit:
        body: dict = {
            "limit": 256,
            "with_payload": True,
            "with_vector": False,
            "filter": {"must": [{"key": "source", "match": {"any": [category]}}]},
        }
        if offset is not None:
            body["offset"] = offset
        resp = await client.post(
            f"{base}/collections/{collection}/points/scroll",
            headers=_headers(),
            json=body,
        )
        resp.raise_for_status()
        result = resp.json().get("result", {})
        points = result.get("points", [])
        if not points:
            break
        for p in points:
            payload = p.get("payload", {})
            text = str(payload.get("text", "")).strip()
            if min_len <= len(text) <= max_len and _is_card_worthy(text):
                collected.append(
                    {
                        "text": text,
                        "source": _SOURCE_LABELS.get(category, category),  # 읽기 쉬운 출처
                        "category": category,  # 주제 — 아래 theming 이 덮어씀(--no-theme 시 source 키 유지)
                        "volume": _clean_volume(str(payload.get("volume", ""))),
                    }
                )
        scanned += len(points)
        offset = result.get("next_page_offset")
        if offset is None:
            break
    return collected


async def _batch_tag_themes(items: list[dict], themes: list[str], batch: int = 25) -> None:
    """말씀들을 batch 단위로 한 번에 LLM 분류 → item['category'] 에 주제 기록.

    개별 호출(1말씀=1요청) 은 free-tier 15 RPM 에 막히므로 묶어서 호출한다.
    파싱 실패/미분류 항목은 '기타'. batch 사이에 잠깐 sleep 으로 RPM 추가 보호.
    """
    from app.core.common.gemini import generate_text  # noqa: PLC0415

    for start in range(0, len(items), batch):
        chunk = items[start : start + batch]
        listing = "\n".join(f"{i + 1}. {it['text'][:200]}" for i, it in enumerate(chunk))
        prompt = (
            "다음 말씀들을 각각 가장 어울리는 '주제' 로 분류하세요. "
            f"주제는 반드시 다음 중 하나만 사용: {', '.join(themes)}.\n"
            "출력은 각 줄에 '번호: 주제' 형식으로만. 예: 1: 위로\n\n"
            f"{listing}\n\n분류 결과:"
        )
        try:
            raw = await generate_text(prompt) or ""
        except Exception as exc:  # noqa: BLE001
            print(f"  주제 분류 실패 (batch {start}~) — 기타 처리: {exc}")
            for it in chunk:
                it["category"] = "기타"
            continue
        parsed: dict[int, str] = {}
        for line in raw.splitlines():
            m = re.match(r"\s*(\d+)\s*[:.)]\s*(.+)", line)
            if not m:
                continue
            idx = int(m.group(1)) - 1
            theme = next((t for t in themes if t in m.group(2)), None)
            if 0 <= idx < len(chunk) and theme:
                parsed[idx] = theme
        for i, it in enumerate(chunk):
            it["category"] = parsed.get(i, "기타")
        if start + batch < len(items):
            await asyncio.sleep(4)  # RPM 추가 여유


async def main() -> None:
    parser = argparse.ArgumentParser(description="짧은 말씀 후보 추출 (레드팀 시연)")
    parser.add_argument(
        "--categories",
        default="O,B,M",
        help="추출할 source 카테고리 키 (쉼표 구분). 예: O,B,M",
    )
    parser.add_argument("--per-category", type=int, default=30, help="카테고리당 후보 수")
    parser.add_argument("--min-len", type=int, default=50, help="본문 최소 글자 수")
    parser.add_argument("--max-len", type=int, default=300, help="본문 최대 글자 수")
    parser.add_argument(
        "--scan-limit",
        type=int,
        default=20000,
        help="카테고리당 최대 scroll 포인트 수 (성능 가드)",
    )
    parser.add_argument(
        "--no-theme",
        action="store_true",
        help="AI 주제 태깅 생략 (category 를 source 키로 둠). 기본은 LLM 으로 주제 태깅.",
    )
    parser.add_argument(
        "--out",
        default="scripts/featured_malssum.candidates.json",
        help="후보 JSON 저장 경로",
    )
    args = parser.parse_args()

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    base = settings.qdrant_url.rstrip("/")
    collection = settings.collection_name

    print(f"컬렉션: {collection} @ {base}")
    print(f"카테고리: {categories} / 길이 {args.min_len}~{args.max_len}자")

    out: list[dict] = []
    async with httpx.AsyncClient(http2=False, timeout=60.0) as client:
        for cat in categories:
            pool = await _scroll_category(
                client,
                base,
                collection,
                cat,
                min_len=args.min_len,
                max_len=args.max_len,
                scan_limit=args.scan_limit,
            )
            # 다양성을 위해 풀에서 무작위 표본 추출 (풀이 작으면 전체).
            picked = (
                random.sample(pool, args.per_category)
                if len(pool) > args.per_category
                else pool
            )
            out.extend(picked)
            print(f"  [{cat}] 풀 {len(pool)}개 → 후보 {len(picked)}개")

    # AI 주제 태깅 — 말씀들을 batch 로 묶어 LLM 분류 (free-tier 15 RPM 회피).
    # 식구님 "AI 로 카테고리별 말씀 세트 생성" 구상 반영. 런타임 매칭도 이 주제를 씀.
    if not args.no_theme and out:
        print(f"\nAI 주제 태깅 중... ({len(out)}개, 테마={MALSSUM_THEMES})")
        await _batch_tag_themes(out, MALSSUM_THEMES)
        dist = Counter(it["category"] for it in out)
        print(f"  주제 분포: {dict(dist)}")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\n총 {len(out)}개 후보 저장 → {out_path}")
    print("검토 후 원하는 항목만 남겨 app/modules/malssum/featured_malssum.json 으로 옮기세요.")


if __name__ == "__main__":
    asyncio.run(main())
