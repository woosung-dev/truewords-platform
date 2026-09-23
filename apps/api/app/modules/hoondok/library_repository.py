"""말씀 서고 Repository — AsyncSession 은 여기만 보유한다 (ENT-HD-010~012, PLAN-HD-007)."""

import uuid
from collections.abc import Sequence

from sqlalchemy import case, delete, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import (
    ContentRight,
    PassageMark,
    ReadingPosition,
    VolumeSection,
    _utcnow,
)


class LibraryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 권리 원장 집계 (ENT-HD-005) ----------------------------------------

    async def list_rights(self) -> list[ContentRight]:
        result = await self.session.execute(
            select(ContentRight)
            .order_by(ContentRight.volume)
            .execution_options(populate_existing=True)
        )
        return list(result.scalars().all())

    async def series_summary(self) -> list[tuple[str, int, int, int, int, int | None]]:
        """시리즈별 (key, registered, allowed, pending, withdrawn, chunk_count 합) — 1 쿼리.

        `chunk_count` 가 전부 NULL 이면 SUM 도 NULL 이라 미집계와 0 을 구분할 수 있다.
        """
        counted = func.count()
        result = await self.session.execute(
            select(
                ContentRight.book_series,
                counted,
                func.sum(_flag(ContentRight.status, "allowed")),
                func.sum(_flag(ContentRight.status, "pending")),
                func.sum(_flag(ContentRight.status, "withdrawn")),
                func.sum(ContentRight.chunk_count),
            )
            .where(ContentRight.book_series.is_not(None), ContentRight.book_series != "")
            .group_by(ContentRight.book_series)
        )
        rows: list[tuple[str, int, int, int, int, int | None]] = []
        for series, registered, allowed, pending, withdrawn, chunks in result.all():
            rows.append(
                (
                    str(series),
                    int(registered),
                    int(allowed or 0),
                    int(pending or 0),
                    int(withdrawn or 0),
                    None if chunks is None else int(chunks),
                )
            )
        return rows

    async def bulk_update_series(self, series: str, values: dict) -> int:
        """시리즈 전 행을 한 번에 갱신하고 갱신 건수를 돌려준다. 0 건이면 커밋하지 않는다."""
        result = await self.session.execute(
            update(ContentRight)
            .where(ContentRight.book_series == series)
            .values(**values, updated_at=_utcnow())
        )
        updated = int(result.rowcount or 0)
        if updated == 0:
            await self.session.rollback()
            return 0
        await self.session.commit()
        return updated

    # --- 장 목차 (ENT-HD-010) ------------------------------------------------

    async def list_sections(self, volume: str) -> list[VolumeSection]:
        result = await self.session.execute(
            select(VolumeSection)
            .where(VolumeSection.volume == volume)
            .order_by(VolumeSection.position)
        )
        return list(result.scalars().all())

    async def section_counts(self, volumes: Sequence[str]) -> dict[str, int]:
        """권별 장 수 — 목록 화면이 권마다 질의하지 않도록 1 쿼리로 모은다."""
        if not volumes:
            return {}
        result = await self.session.execute(
            select(VolumeSection.volume, func.count())
            .where(VolumeSection.volume.in_(list(volumes)))
            .group_by(VolumeSection.volume)
        )
        return {str(volume): int(count) for volume, count in result.all()}

    async def get_section_by_position(self, volume: str, position: int) -> VolumeSection | None:
        result = await self.session.execute(
            select(VolumeSection).where(
                VolumeSection.volume == volume, VolumeSection.position == position
            )
        )
        return result.scalar_one_or_none()

    async def get_section_at(self, volume: str, chunk_index: int) -> VolumeSection | None:
        """해당 청크를 품는 구간. 편(level 1)과 장(level 2)이 겹치면 더 좁은 level 2 를 고른다."""
        result = await self.session.execute(
            select(VolumeSection)
            .where(
                VolumeSection.volume == volume,
                VolumeSection.start_chunk_index <= chunk_index,
                VolumeSection.end_chunk_index >= chunk_index,
            )
            .order_by(VolumeSection.level.desc(), VolumeSection.position.desc())
            .limit(1)
        )
        return result.scalars().first()

    async def replace_auto_sections(self, volume: str, rows: list[VolumeSection]) -> None:
        """추출 스크립트(트랙 D)용 — `origin='auto'` 행만 교체하고 수기(`manual`) 행은 보존한다."""
        try:
            await self.session.execute(
                delete(VolumeSection).where(
                    VolumeSection.volume == volume, VolumeSection.origin == "auto"
                )
            )
            for row in rows:
                self.session.add(row)
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise

    # --- 이어 읽기 (ENT-HD-011) ---------------------------------------------

    async def list_positions(
        self, user_id: uuid.UUID, limit: int, volume: str | None = None
    ) -> list[ReadingPosition]:
        statement = select(ReadingPosition).where(ReadingPosition.user_id == user_id)
        if volume is not None:
            statement = statement.where(ReadingPosition.volume == volume)
        result = await self.session.execute(
            statement.order_by(ReadingPosition.updated_at.desc()).limit(limit)
        )
        return list(result.scalars().all())

    async def upsert_position(
        self, user_id: uuid.UUID, volume: str, chunk_index: int
    ) -> ReadingPosition:
        result = await self.session.execute(
            select(ReadingPosition).where(
                ReadingPosition.user_id == user_id, ReadingPosition.volume == volume
            )
        )
        position = result.scalar_one_or_none()
        if position is None:
            position = ReadingPosition(user_id=user_id, volume=volume, chunk_index=chunk_index)
        else:
            position.chunk_index = chunk_index
            position.updated_at = _utcnow()
        return await self._save(position)

    # --- 단락 표시 (ENT-HD-012) ---------------------------------------------

    async def list_marks(
        self,
        user_id: uuid.UUID,
        volume: str | None = None,
        kind: str | None = None,
        limit: int = 200,
    ) -> list[PassageMark]:
        statement = select(PassageMark).where(PassageMark.user_id == user_id)
        if volume is not None:
            statement = statement.where(PassageMark.volume == volume)
        if kind is not None:
            statement = statement.where(PassageMark.kind == kind)
        result = await self.session.execute(
            statement.order_by(PassageMark.updated_at.desc()).limit(limit)
        )
        return list(result.scalars().all())

    async def upsert_mark(
        self,
        user_id: uuid.UUID,
        chunk_id: str,
        volume: str,
        chunk_index: int,
        kind: str,
        color: int | None,
        note: str | None,
    ) -> PassageMark:
        """`(user, chunk_id, kind)` 로 찾아 갱신한다 — 남의 표시는 조건에서 걸러져 건드릴 수 없다."""
        result = await self.session.execute(
            select(PassageMark).where(
                PassageMark.user_id == user_id,
                PassageMark.chunk_id == chunk_id,
                PassageMark.kind == kind,
            )
        )
        mark = result.scalar_one_or_none()
        if mark is None:
            mark = PassageMark(
                user_id=user_id,
                chunk_id=chunk_id,
                volume=volume,
                chunk_index=chunk_index,
                kind=kind,
                color=color,
                note=note,
            )
        else:
            mark.volume, mark.chunk_index = volume, chunk_index
            mark.color, mark.note = color, note
            mark.updated_at = _utcnow()
        return await self._save(mark)

    async def delete_mark(self, user_id: uuid.UUID, chunk_id: str, kind: str | None) -> None:
        """본인 표시만 지운다. 없어도 조용히 지나간다(DELETE 는 멱등)."""
        statement = delete(PassageMark).where(
            PassageMark.user_id == user_id, PassageMark.chunk_id == chunk_id
        )
        if kind is not None:
            statement = statement.where(PassageMark.kind == kind)
        await self.session.execute(statement)
        await self.session.commit()

    # --- 계정 삭제 (API-HD-011) ---------------------------------------------

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """UserDataPurger 규약 — 커밋하지 않는다. 사용자 저장 커밋에 함께 묶인다."""
        await self.session.execute(
            delete(PassageMark).where(PassageMark.user_id == user_id)
        )
        await self.session.execute(
            delete(ReadingPosition).where(ReadingPosition.user_id == user_id)
        )

    async def _save[T: (ReadingPosition, PassageMark)](self, row: T) -> T:
        self.session.add(row)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(row)
        return row


def _flag(column, value: str):
    """SQLite·PG 양쪽에서 같은 결과를 내는 조건부 집계(1/0)."""
    return case((column == value, 1), else_=0)
