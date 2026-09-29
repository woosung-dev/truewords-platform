"""말씀 서고 3계층·읽기 기록 (API-HD-023~028·053). 권리 게이트는 API-HD-016 과 같은 기준을 쓴다."""

import logging
import uuid
from collections import Counter

from fastapi import HTTPException

from app.core.config import settings
from app.modules.hoondok.display_text import to_display_text
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_schemas import (
    BulkRightsInput,
    BulkRightsResponse,
    HighlightInput,
    HighlightItem,
    HighlightPatch,
    HighlightsResponse,
    MarkInput,
    MarkItem,
    MarksResponse,
    ReadingPositionItem,
    ReadingPositionsResponse,
    SectionItem,
    SectionsResponse,
    SeriesDetailResponse,
    SeriesSummaryItem,
    SeriesSummaryResponse,
    SeriesVolume,
)
from app.modules.hoondok.library_series import label_sort_key, series_title, volume_label
from app.modules.hoondok.models import ContentRight, PassageHighlight, PassageMark, _utcnow
from app.modules.qdrant import RawQdrantClient
from app.modules.qdrant.filters import build_filter, field_match, field_match_any
from app.modules.search.hybrid import SearchResult, point_to_search_result

logger = logging.getLogger(__name__)

DEFAULT_GRADE = "R"
# 원문 뷰(API-HD-016)의 페이지 크기. journey_service.PAGE_SIZE 와 같아야 한다 — 서로 import 하면 순환이라 따로 둔다.
WORDS_PAGE_SIZE = 20
EXCERPT_CHARS = 300


def _point_id(chunk_id: str) -> str | int | None:
    """Qdrant 포인트 ID(UUID 또는 unsigned integer). 둘 다 아니면 None — 요청에 넣으면 묶음 전체가 거절된다."""
    try:
        return str(uuid.UUID(chunk_id))
    except ValueError:
        if chunk_id.isdecimal() and 0 <= int(chunk_id) < 2**64:
            return int(chunk_id)
        return None


def _clean_note(note: str | None) -> str | None:
    """메모는 앞뒤 공백을 걷고, 비었으면 메모가 없는 것(None)으로 둔다."""
    if note is None:
        return None
    return note.strip() or None


def majority_grade(grades: list[str]) -> str:
    """최빈 등급. 동률이거나 비어 있으면 가장 보수적인 R 로 둔다(계획 §2-11)."""
    if not grades:
        return DEFAULT_GRADE
    ranked = Counter(grades).most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return DEFAULT_GRADE
    return ranked[0][0]


class LibraryService:
    def __init__(self, repo: LibraryRepository, client: RawQdrantClient) -> None:
        self.repo = repo
        # 표시 목록의 발췌(API-HD-026 `excerpt=true`)만 Qdrant 를 읽는다.
        self.client = client

    # --- 권리 게이트 ---------------------------------------------------------

    async def _rights(self) -> list[ContentRight]:
        return await self.repo.list_rights()

    @staticmethod
    def _is_visible(right: ContentRight) -> bool:
        return right.status == "allowed" and (right.scope_search or right.scope_full_text)

    @staticmethod
    def _is_full_text(right: ContentRight | None) -> bool:
        """원문(full_text)까지 열린 권 — `_readable`·표시 발췌와 같은 기준. 형광펜 `readable` 이 쓴다."""
        return right is not None and right.status == "allowed" and right.scope_full_text

    async def _readable(self, volume: str) -> ContentRight:
        """원문(full_text)이 열린 권만 통과. 아니면 존재 자체를 알리지 않는 404."""
        for right in await self._rights():
            if right.volume == volume and right.status == "allowed" and right.scope_full_text:
                return right
        raise HTTPException(404, "원문을 찾을 수 없습니다")

    # --- API-HD-023 시리즈 상세 ---------------------------------------------

    async def series_detail(self, series: str) -> SeriesDetailResponse:
        rights = [
            r for r in await self._rights() if r.book_series == series and self._is_visible(r)
        ]
        if not rights:
            raise HTTPException(404, "저작물을 찾을 수 없습니다")
        counts = await self.repo.section_counts([r.volume for r in rights])
        volumes = [
            SeriesVolume(
                volume=r.volume,
                label=volume_label(r.volume, series, r.work_title),
                total_chunks=r.chunk_count,
                section_count=counts.get(r.volume, 0),
                scope_full_text=r.scope_full_text,
            )
            for r in rights
        ]
        volumes.sort(key=lambda v: label_sort_key(v.label))
        return SeriesDetailResponse(
            series=series,
            title=series_title(series),
            authority_grade=majority_grade([r.authority_grade for r in rights]),  # type: ignore[arg-type]
            volumes=volumes,
        )

    # --- API-HD-024 장 목차 --------------------------------------------------

    async def sections(self, volume: str) -> SectionsResponse:
        await self._readable(volume)
        rows = await self.repo.list_sections(volume)
        return SectionsResponse(
            volume=volume,
            sections=[
                SectionItem(
                    position=row.position,
                    level=row.level,
                    title=row.title,
                    start_chunk_index=row.start_chunk_index,
                    end_chunk_index=row.end_chunk_index,
                    spoken_on=row.spoken_on,
                    place=row.place,
                )
                for row in rows
            ],
        )

    # --- API-HD-025 이어 읽기 ------------------------------------------------

    @staticmethod
    def _label_of(
        volume: str, rights: dict[str, ContentRight]
    ) -> tuple[str, str | None, str]:
        """표시용 (work_title, series, label). 권리가 사라진 권도 목록에서는 볼륨 키로 보여 준다.

        원장은 목록 진입점에서 1회만 읽어 dict 로 넘긴다 — 행마다 전량 재조회하면 N+1 이다.
        """
        right = rights.get(volume)
        if right is None:
            return (volume, None, volume)
        series = right.book_series or None
        return (
            right.work_title,
            series,
            volume_label(volume, series or "", right.work_title),
        )

    async def _rights_by_volume(self) -> dict[str, ContentRight]:
        return {right.volume: right for right in await self._rights()}

    async def list_positions(
        self, user_id: uuid.UUID, limit: int, volume: str | None = None
    ) -> ReadingPositionsResponse:
        rows = await self.repo.list_positions(user_id, limit, volume)
        rights = await self._rights_by_volume()
        items = []
        for row in rows:
            work_title, series, label = self._label_of(row.volume, rights)
            items.append(
                ReadingPositionItem(
                    volume=row.volume,
                    chunk_index=row.chunk_index,
                    updated_at=row.updated_at,
                    work_title=work_title,
                    series=series,
                    label=label,
                )
            )
        return ReadingPositionsResponse(items=items)

    async def save_position(
        self, user_id: uuid.UUID, volume: str, chunk_index: int
    ) -> ReadingPositionItem:
        right = await self._readable(volume)
        row = await self.repo.upsert_position(user_id, volume, chunk_index)
        series = right.book_series or None
        return ReadingPositionItem(
            volume=row.volume,
            chunk_index=row.chunk_index,
            updated_at=row.updated_at,
            work_title=right.work_title,
            series=series,
            label=volume_label(volume, series or "", right.work_title),
        )

    # --- API-HD-026 단락 표시 ------------------------------------------------

    async def list_marks(
        self,
        user_id: uuid.UUID,
        volume: str | None,
        kind: str | None,
        limit: int = 200,
        excerpt: bool = False,
    ) -> MarksResponse:
        rows = await self.repo.list_marks(user_id, volume, kind, limit)
        rights = await self._rights_by_volume()
        # 요청했을 때만 Qdrant 를 부른다 — 원문 화면의 기존 호출은 DB 만 읽는다.
        excerpts = await self._excerpts(rows, rights) if excerpt else None
        items = []
        for i, row in enumerate(rows):
            work_title, series, label = self._label_of(row.volume, rights)
            item = MarkItem(
                chunk_id=row.chunk_id,
                chunk_index=row.chunk_index,
                volume=row.volume,
                kind=row.kind,  # type: ignore[arg-type]
                color=row.color,
                note=row.note,
                updated_at=row.updated_at,
                work_title=work_title,
                label=label,
            )
            if excerpts is not None:
                # 요청했을 때만 필드가 set 된다 — 라우트의 exclude_unset 이 기존 응답 모양을 지킨다.
                item.excerpt = excerpts[i]
            items.append(item)
        return MarksResponse(items=items)

    async def _excerpts(
        self, rows: list[PassageMark], rights: dict[str, ContentRight]
    ) -> list[str | None]:
        """행마다 원문 뷰(API-HD-016)가 그 단락에 보이는 display_text 앞 300자. 못 채우면 None.

        원문(full_text)이 열린 권만 채운다 — 저장 시점 스냅샷을 두지 않아 권리를 거두면 발췌도 사라진다.
        Qdrant 는 청크 묶음 retrieve 1회 + 앞 청크가 필요한 권마다 scroll 1회만 부른다(행마다 부르지 않는다).
        겹침 자르기는 chunk_display_text 와 같다 — 페이지 첫 청크는 앞 청크 없이, 나머지는 바로 앞 청크 기준.
        Qdrant 가 실패하면 목록은 그대로 내고 발췌만 모두 비운다.
        """
        excerpts: list[str | None] = [None] * len(rows)
        targets: list[tuple[int, PassageMark, str | int]] = []
        for i, row in enumerate(rows):
            right = rights.get(row.volume)
            if right is None or right.status != "allowed" or not right.scope_full_text:
                continue
            point_id = _point_id(row.chunk_id)
            if point_id is not None:
                targets.append((i, row, point_id))
        if not targets:
            return excerpts
        try:
            # 같은 청크의 북마크·형광펜은 한 번만 묻는다.
            ids = list(dict.fromkeys(point_id for _, _, point_id in targets))
            records = await self.client.retrieve(settings.collection_name, ids=ids)
            by_id = {str(record.id): point_to_search_result(record) for record in records}
            matched: dict[int, SearchResult] = {}
            for i, row, point_id in targets:
                found = by_id.get(str(point_id))
                if (
                    found is not None
                    and found.volume == row.volume
                    and isinstance(found.chunk_index, int)
                    and found.chunk_index >= 0
                ):
                    matched[i] = found
            wanted: dict[str, set[int]] = {}
            for found in matched.values():
                if found.chunk_index % WORDS_PAGE_SIZE:
                    wanted.setdefault(found.volume, set()).add(found.chunk_index - 1)
            previous: dict[tuple[str, int], str] = {}
            for volume, indices in wanted.items():
                points, _ = await self.client.scroll(
                    settings.collection_name,
                    scroll_filter=build_filter(
                        must=[
                            field_match("volume", volume),
                            field_match_any("chunk_index", sorted(indices)),
                        ]
                    ),
                    limit=len(indices),
                    with_vectors=False,
                )
                for point in points:
                    prev = point_to_search_result(point)
                    previous[(prev.volume, prev.chunk_index)] = prev.text
        except Exception as exc:
            # 예외 메시지에 공급자 URL 이 섞일 수 있어 종류만 남긴다.
            logger.warning("훈독 표시 발췌 조회 실패 — 발췌 없이 응답한다 (%s)", type(exc).__name__)
            return excerpts
        for i, found in matched.items():
            prev_text = (
                previous.get((found.volume, found.chunk_index - 1))
                if found.chunk_index % WORDS_PAGE_SIZE
                else None
            )
            excerpts[i] = to_display_text(prev_text, found.text)[:EXCERPT_CHARS].rstrip()
        return excerpts

    async def save_mark(self, user_id: uuid.UUID, chunk_id: str, data: MarkInput) -> MarkItem:
        right = await self._readable(data.volume)
        row = await self.repo.upsert_mark(
            user_id,
            chunk_id,
            data.volume,
            data.chunk_index,
            data.kind,
            data.color,
            data.note,
        )
        series = right.book_series or None
        return MarkItem(
            chunk_id=row.chunk_id,
            chunk_index=row.chunk_index,
            volume=row.volume,
            kind=row.kind,  # type: ignore[arg-type]
            color=row.color,
            note=row.note,
            updated_at=row.updated_at,
            work_title=right.work_title,
            label=volume_label(row.volume, series or "", right.work_title),
        )

    async def delete_mark(self, user_id: uuid.UUID, chunk_id: str, kind: str | None) -> None:
        await self.repo.delete_mark(user_id, chunk_id, kind)

    # --- API-HD-053 구절 형광펜 ----------------------------------------------

    @staticmethod
    def _highlight_item(
        row: PassageHighlight, work_title: str, label: str, readable: bool
    ) -> HighlightItem:
        return HighlightItem(
            id=str(row.id),
            volume=row.volume,
            chunk_id=row.chunk_id,
            start_chunk_index=row.start_chunk_index,
            start_offset=row.start_offset,
            end_chunk_index=row.end_chunk_index,
            end_offset=row.end_offset,
            quote=row.quote,
            color=row.color,
            note=row.note,
            created_at=row.created_at,
            updated_at=row.updated_at,
            work_title=work_title,
            label=label,
            readable=readable,
        )

    async def list_highlights(
        self, user_id: uuid.UUID, volume: str | None, limit: int
    ) -> HighlightsResponse:
        """권리가 닫힌 권의 형광펜도 목록에서 빼지 않는다(원문 뷰 동작 유지) — `readable` 만 false 로 알린다."""
        rows = await self.repo.list_highlights(user_id, volume, limit)
        rights = await self._rights_by_volume()
        items = []
        for row in rows:
            work_title, _series, label = self._label_of(row.volume, rights)
            readable = self._is_full_text(rights.get(row.volume))
            items.append(self._highlight_item(row, work_title, label, readable))
        return HighlightsResponse(items=items)

    async def create_highlight(self, user_id: uuid.UUID, data: HighlightInput) -> HighlightItem:
        right = await self._readable(data.volume)
        row = await self.repo.save_highlight(
            PassageHighlight(
                user_id=user_id,
                volume=data.volume,
                chunk_id=data.chunk_id,
                start_chunk_index=data.start_chunk_index,
                start_offset=data.start_offset,
                end_chunk_index=data.end_chunk_index,
                end_offset=data.end_offset,
                quote=data.quote,
                color=data.color,
                note=_clean_note(data.note),
            )
        )
        series = right.book_series or None
        return self._highlight_item(
            row,
            right.work_title,
            volume_label(row.volume, series or "", right.work_title),
            readable=True,  # _readable 을 통과했다
        )

    async def update_highlight(
        self, user_id: uuid.UUID, highlight_id: uuid.UUID, data: HighlightPatch
    ) -> HighlightItem:
        """보낸 필드만 바꾼다. 권리가 닫힌 권의 형광펜도 색·메모는 고칠 수 있다(목록과 같은 기준)."""
        row = await self.repo.get_own_highlight(user_id, highlight_id)
        if row is None:
            raise HTTPException(404, "형광펜을 찾을 수 없습니다")
        if "color" in data.model_fields_set and data.color is not None:
            row.color = data.color
        if "note" in data.model_fields_set:
            row.note = _clean_note(data.note)
        row.updated_at = _utcnow()
        row = await self.repo.save_highlight(row)
        rights = await self._rights_by_volume()
        work_title, _series, label = self._label_of(row.volume, rights)
        return self._highlight_item(
            row, work_title, label, self._is_full_text(rights.get(row.volume))
        )

    async def delete_highlight(self, user_id: uuid.UUID, highlight_id: uuid.UUID) -> None:
        await self.repo.delete_highlight(user_id, highlight_id)

    # --- API-HD-027·028 admin ------------------------------------------------

    async def bulk_update(self, data: BulkRightsInput) -> tuple[BulkRightsResponse, uuid.UUID]:
        """시리즈 전 행 갱신 후 (응답, 대표 행 id) — 감사 로그의 target_id 로 쓴다."""
        rows = [r for r in await self._rights() if r.book_series == data.book_series]
        if not rows:
            raise HTTPException(404, "저작물을 찾을 수 없습니다")
        values: dict = {
            "status": data.status,
            "scope_search": data.scope_search,
            "scope_full_text": data.scope_full_text,
            "scope_jeongseong": data.scope_jeongseong,
        }
        if data.authority_grade is not None:
            values["authority_grade"] = data.authority_grade
        updated = await self.repo.bulk_update_series(data.book_series, values)
        return BulkRightsResponse(book_series=data.book_series, updated=updated), rows[0].id

    async def series_summary(self) -> SeriesSummaryResponse:
        rows = await self.repo.series_summary()
        items = [
            SeriesSummaryItem(
                series=series,
                title=series_title(series),
                registered=registered,
                allowed=allowed,
                pending=pending,
                withdrawn=withdrawn,
                chunk_count=chunks,
            )
            for series, registered, allowed, pending, withdrawn, chunks in rows
        ]
        items.sort(key=lambda i: i.title)
        return SeriesSummaryResponse(items=items)
