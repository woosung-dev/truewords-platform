# 큐레이션된 말씀을 답변 주제에 맞춰 1개 제공 (레드팀 시연 — 답변 화면 카드 표시용)
"""featured_malssum.json (사람이 추린 목록) 을 1회 로드해 말씀 1개 선택.

각 항목의 ``category`` 필드는 '주제(테마)' 다 (위로/교리/실천/가정/참사랑 등).
``pick_malssum_for_answer`` 가 답변을 LLM 으로 주제 분류해 해당 주제 말씀 중
무작위 1개를 고른다 (주제 미매칭/풀 작으면 전체 무작위 fallback).

별도 Qdrant 컬렉션·임베딩 없이 동작한다. 목록은
`apps/api/scripts/extract_malssum_candidates.py` 가 후보 추출 + AI 주제 태깅으로
만들고 사람이 선별해 채운다. 비어 있으면 None → UI 가 카드 미표시.
"""
from __future__ import annotations

import json
import logging
import random
from pathlib import Path

logger = logging.getLogger(__name__)

_MALSSUM_PATH = Path(__file__).parent / "featured_malssum.json"

# None = 아직 미로드. 첫 _get_items() 호출이 1회 채운다 (lazy, 테스트는 _items override).
_items: list[dict] | None = None


def _load_from_disk() -> list[dict]:
    """JSON 로드 + text 있는 항목만 필터. 파일 없음/파싱 실패 시 빈 목록."""
    try:
        with _MALSSUM_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        logger.warning("featured_malssum.json 로드 실패 — 카드 비활성: %s", exc)
        return []
    if not isinstance(data, list):
        logger.warning("featured_malssum.json 형식 오류 (list 아님) — 카드 비활성")
        return []
    return [d for d in data if isinstance(d, dict) and str(d.get("text", "")).strip()]


def _get_items() -> list[dict]:
    global _items
    if _items is None:
        _items = _load_from_disk()
    return _items


def _normalize(item: dict) -> dict:
    """키를 항상 3개로 정규화 — 손수 편집된 JSON 이 category/volume 을 빠뜨려도
    동기(Pydantic coerce) 경로와 SSE(raw dict) 경로의 payload 키가 일치하도록."""
    return {
        "text": str(item.get("text", "")),
        "category": str(item.get("category", "")),
        "source": str(item.get("source", "")),
        "volume": str(item.get("volume", "")),
    }


# ── 답변 주제 매칭 (LLM 분류 → 해당 주제 말씀) ──────────────────────────────
# `category` 필드 값이 곧 '주제(테마)'다. 큐레이션 스크립트가 AI 로 태깅하고,
# 런타임은 답변을 같은 주제 어휘로 분류해 그 주제 풀에서 무작위 1개를 고른다.
MALSSUM_THEMES: list[str] = ["위로", "교리", "실천", "가정", "참사랑"]


def _available_themes() -> list[str]:
    """현재 큐레이션 풀에 실재하는 주제(category 값) 목록."""
    return sorted(
        {str(i.get("category", "")).strip() for i in _get_items() if str(i.get("category", "")).strip()}
    )


async def _classify_theme(answer_text: str, themes: list[str]) -> str | None:
    """답변을 themes 중 하나로 LLM 분류 (fast 모델). 실패/미매칭 시 None."""
    if not answer_text.strip() or not themes:
        return None
    prompt = (
        "다음은 종교 상담 AI 의 답변입니다. 이 답변의 핵심 정서·주제에 가장 어울리는 "
        "'말씀 주제' 를 아래 목록에서 정확히 하나만 골라 그 단어만 출력하세요. "
        "목록에 없는 단어는 쓰지 마세요.\n\n"
        f"주제 목록: {', '.join(themes)}\n\n"
        f"답변:\n{answer_text[:1500]}\n\n"
        "가장 어울리는 주제 (목록 중 하나, 단어만):"
    )
    from app.core.common.gemini import generate_text  # 지연 import — 순환/테스트 격리

    try:
        raw = (await generate_text(prompt) or "").strip()
    except Exception as exc:  # noqa: BLE001 — 분류 실패는 무작위 fallback 으로 흡수
        logger.warning("말씀 주제 분류 실패 — 무작위 fallback: %s", exc)
        return None
    for t in themes:
        if t in raw:
            return t
    return None


async def pick_malssum_for_answer(answer_text: str) -> dict | None:
    """답변 주제에 맞는 말씀 1개 선택.

    LLM 이 답변을 주제로 분류 → 해당 주제 말씀 중 무작위. 분류 실패 / 해당 주제
    말씀 없음 → 전체 풀 무작위 fallback. 풀 비면 None (카드 미표시).
    """
    items = _get_items()
    if not items:
        return None
    theme = await _classify_theme(answer_text, _available_themes())
    pool = [i for i in items if str(i.get("category", "")).strip() == theme] if theme else []
    if not pool:
        pool = items  # fallback: 전체 무작위
    return _normalize(random.choice(pool))
