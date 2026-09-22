"""말씀 서고 3계층·읽기 기록 (API-HD-023~028). 권리 게이트는 API-HD-016 과 같은 기준을 쓴다."""

import uuid
from collections import Counter

from fastapi import HTTPException

from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_schemas import (
    BulkRightsInput,
    BulkRightsResponse,
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
from app.modules.hoondok.models import ContentRight

DEFAULT_GRADE = "R"


def majority_grade(grades: list[str]) -> str:
    """최빈 등급. 동률이거나 비어 있으면 가장 보수적인 R 로 둔다(계획 §2-11)."""
    if not grades:
        return DEFAULT_GRADE
    ranked = Counter(grades).most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return DEFAULT_GRADE
    return ranked[0][0]


class LibraryService:
    def __init__(self, repo: LibraryRepository) -> None:
        self.repo = repo

    # --- 권리 게이트 ---------------------------------------------------------

    async def _rights(self) -> list[ContentRight]:
        return await self.repo.list_rights()

    @staticmethod
    def _is_visible(right: ContentRight) -> bool:
        return right.status == "allowed" and (right.scope_search or right.scope_full_text)

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

    async def _label_of(self, volume: str) -> tuple[str, str | None, str]:
        """표시용 (work_title, series, label). 권리가 사라진 권도 목록에서는 볼륨 키로 보여 준다."""
        for right in await self._rights():
            if right.volume == volume:
                series = right.book_series or None
                return (
                    right.work_title,
                    series,
                    volume_label(volume, series or "", right.work_title),
                )
        return (volume, None, volume)

    async def list_positions(
        self, user_id: uuid.UUID, limit: int, volume: str | None = None
    ) -> ReadingPositionsResponse:
        rows = await self.repo.list_positions(user_id, limit, volume)
        items = []
        for row in rows:
            work_title, series, label = await self._label_of(row.volume)
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
        self, user_id: uuid.UUID, volume: str | None, kind: str | None
    ) -> MarksResponse:
        rows = await self.repo.list_marks(user_id, volume, kind)
        items = []
        for row in rows:
            work_title, series, label = await self._label_of(row.volume)
            items.append(
                MarkItem(
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
            )
        return MarksResponse(items=items)

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
