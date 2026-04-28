"""인용 메타 4중 (P1-B) — ADR-46 §C.3 답변 화면 인용 카드 메타.

기존 `Source` 응답은 단일 `volume` / `source` 필드만 노출했다. 답변 화면에서
`[347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]` 형식의 4중 메타를 노출하려면
chunk-level Qdrant payload 에 다음 4 필드가 채워져 있어야 한다:

- volume_no: 권 번호 (int)
- delivered_at: 일자 (ISO 문자열)
- delivered_place: 장소
- chapter_title: 챕터/제목

본 모듈은 다음을 제공한다:
1. `CitationMeta` Pydantic schema — 응답 wiring 시 재사용
2. `extract_meta_from_payload()` — Qdrant payload dict 에서 4 필드 추출
3. `format_citation_label()` — UI 표기 문자열 생성 (포맷 일관성 보장)

TODO(P1-B 후속):
- 인덱싱 파이프라인에서 4 필드 추출 로직 (volume 파일명 또는 본문 헤더에서 정규식)
- 운영자가 admin tool 로 누락 메타를 채울 수 있는 endpoint
- 기존 적재된 Qdrant payload 백필 스크립트
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CitationMeta(BaseModel):
    """인용 메타 4중. 모두 Optional — 기존 데이터 호환."""

    volume_no: int | None = Field(default=None, description="권 번호 (예: 347)")
    delivered_at: str | None = Field(
        default=None,
        description="원문 일자 (ISO 8601 또는 한국어 표기 — 예: 2001.07.03)",
    )
    delivered_place: str | None = Field(default=None, description="장소")
    chapter_title: str | None = Field(default=None, description="챕터/제목")


def extract_meta_from_payload(payload: dict[str, Any] | None) -> CitationMeta:
    """Qdrant payload dict 에서 4 필드 추출.

    payload 가 None / 누락 필드는 그대로 None 으로 둔다 (Pydantic Optional).
    """
    if not payload:
        return CitationMeta()
    return CitationMeta(
        volume_no=_coerce_int(payload.get("volume_no")),
        delivered_at=_coerce_str(payload.get("delivered_at")),
        delivered_place=_coerce_str(payload.get("delivered_place")),
        chapter_title=_coerce_str(payload.get("chapter_title")),
    )


def format_citation_label(meta: CitationMeta) -> str:
    """UI 표기 문자열 — `[347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]`.

    누락 필드는 건너뛰고 가능한 부분만 결합.
    """
    parts: list[str] = []
    if meta.volume_no is not None:
        parts.append(f"{meta.volume_no}권")
    if meta.delivered_at:
        parts.append(meta.delivered_at)
    if meta.delivered_place:
        parts.append(meta.delivered_place)
    if meta.chapter_title:
        parts.append(meta.chapter_title)
    if not parts:
        return ""
    return "[" + " · ".join(parts) + "]"


def _coerce_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_str(value: Any) -> str | None:
    if value is None or value == "":
        return None
    return str(value).strip() or None
