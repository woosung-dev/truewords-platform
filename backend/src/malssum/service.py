# 큐레이션된 말씀을 무작위로 1개 제공 (레드팀 시연 — 답변 화면 카드 표시용)
"""featured_malssum.json (사람이 추린 목록) 을 1회 로드해 random 선택.

의미 검색이 아니라 단순 랜덤이므로 별도 Qdrant 컬렉션·임베딩 없이 동작한다.
목록은 `backend/scripts/extract_malssum_candidates.py` 로 후보를 뽑아 사람이
선별해 채운다. 비어 있으면 get_random_malssum 이 None → UI 가 카드 미표시.
"""
from __future__ import annotations

import json
import logging
import random
from pathlib import Path

logger = logging.getLogger(__name__)

_MALSSUM_PATH = Path(__file__).parent / "featured_malssum.json"

# None = 아직 미로드. load_featured_malssum 이 1회 채운다 (lazy, 테스트는 override).
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


def get_random_malssum() -> dict | None:
    """큐레이션 목록에서 말씀 1개를 무작위 선택. 목록 비면 None.

    Returns:
        ``{"text": ..., "category": ..., "volume": ...}`` 또는 None.
    """
    items = _get_items()
    if not items:
        return None
    return random.choice(items)
