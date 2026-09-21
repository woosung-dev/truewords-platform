"""신규 훈독 기능의 권리 게이트. 기존 채팅·편성에는 적용하지 않는다."""

import math
import uuid
from collections.abc import Awaitable, Callable
from datetime import date, timedelta
from typing import Literal

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.modules.datasource.chunk_merge import merge_with_dedup
from app.modules.hoondok.candidates import filter_results
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_schemas import (
    ContentRightInput,
    JeongseongTodayResponse,
    LibraryItem,
    LibraryResponse,
    WordChunk,
    WordSearchResponse,
    WordSearchResult,
    WordsResponse,
)
from app.modules.hoondok.models import ContentRight, JeongseongReading, _utcnow
from app.modules.hoondok.repository import JeongseongRepository
from app.modules.hoondok.schemas import DailyReadingPublic
from app.modules.hoondok.service import today_kst
from app.modules.qdrant import RawQdrantClient
from app.modules.qdrant.filters import build_filter, field_match, field_range
from app.modules.search.exceptions import SearchFailedError
from app.modules.search.hybrid import (
    SearchResult,
    hybrid_search,
    point_to_search_result,
)

PAGE_SIZE = 20


class JourneyService:
    def __init__(
        self,
        repo: JourneyRepository,
        client: RawQdrantClient,
        periods: JeongseongRepository,
        today_fn: Callable[[], date] = today_kst,
        search_fn: Callable[..., Awaitable[list[SearchResult]]] = hybrid_search,
    ) -> None:
        self.repo, self.client, self.periods = repo, client, periods
        self.today_fn, self.search_fn = today_fn, search_fn

    async def allowed(
        self, scope: Literal["scope_search", "scope_full_text", "scope_jeongseong"]
    ) -> dict[str, ContentRight]:
        return {
            r.volume: r
            for r in await self.repo.list_rights()
            if r.status == "allowed" and getattr(r, scope)
        }

    async def list_rights(self) -> list[ContentRight]:
        return await self.repo.list_rights()

    async def save_right(
        self, data: ContentRightInput, right_id: uuid.UUID | None = None
    ) -> ContentRight:
        right = await self.repo.get_right(right_id) if right_id else ContentRight()
        if right is None:
            raise HTTPException(404, "권리 기록을 찾을 수 없습니다")
        for key, value in data.model_dump().items():
            setattr(right, key, value)
        right.updated_at = _utcnow()
        try:
            return await self.repo.save_right(right)
        except IntegrityError:
            raise HTTPException(409, "이미 등록된 저작물입니다") from None

    async def library(self) -> LibraryResponse:
        rights = {
            r.volume: r
            for r in await self.repo.list_rights()
            if r.status == "allowed" and (r.scope_search or r.scope_full_text)
        }
        return LibraryResponse(
            items=[
                LibraryItem(
                    volume=r.volume,
                    work_title=r.work_title,
                    scope_search=r.scope_search,
                    scope_full_text=r.scope_full_text,
                    source_keys=r.source_keys,
                    book_series=r.book_series,
                    authority_grade=r.authority_grade,
                )
                for r in rights.values()
            ]
        )

    async def _search(
        self, query: str, volumes: list[str], limit: int
    ) -> list[SearchResult]:
        if not volumes:
            return []
        try:
            return await self.search_fn(
                self.client, query, top_k=limit, volume_filter=volumes
            )
        except Exception:
            # 예외 메시지에 사용자 검색어나 공급자 URL이 포함될 수 있어 기록하지 않는다.
            raise SearchFailedError("훈독 검색 실패") from None

    async def search(self, query: str, limit: int) -> WordSearchResponse:
        if not query.strip():
            raise HTTPException(422, "검색어를 입력해 주세요")
        results = await self._search(
            query.strip(), list(await self.allowed("scope_search")), limit
        )
        rights = await self.allowed("scope_search")
        return WordSearchResponse(
            results=[
                WordSearchResult(
                    chunk_id=r.chunk_id,
                    chunk_index=r.chunk_index,
                    text=r.text,
                    volume=r.volume,
                    score=r.score,
                    work_title=rights[r.volume].work_title,
                    authority_grade=rights[r.volume].authority_grade,
                    can_read_full_text=rights[r.volume].scope_full_text,
                )
                for r in results
                if r.volume in rights
            ]
        )

    async def words(
        self, volume: str, page: int, chunk_id: str | None
    ) -> WordsResponse:
        if volume not in await self.allowed("scope_full_text"):
            raise HTTPException(404, "원문을 찾을 수 없습니다")
        try:
            if chunk_id:
                # Qdrant ID는 UUID 또는 unsigned integer뿐이다. 잘못된 ID도 404로 통일한다.
                try:
                    point_id: str | int = str(uuid.UUID(chunk_id))
                except ValueError:
                    if not chunk_id.isdecimal() or not 0 <= int(chunk_id) < 2**64:
                        raise HTTPException(404, "원문을 찾을 수 없습니다") from None
                    point_id = int(chunk_id)
                records = await self.client.retrieve(
                    settings.collection_name, ids=[point_id]
                )
                if not records or (records[0].payload or {}).get("volume") != volume:
                    raise HTTPException(404, "원문을 찾을 수 없습니다")
                index = (records[0].payload or {}).get("chunk_index")
                if not isinstance(index, int) or index < 0:
                    raise HTTPException(404, "원문을 찾을 수 없습니다")
                page = index // PAGE_SIZE + 1
            volume_filter = build_filter(must=[field_match("volume", volume)])
            total = await self.client.count(
                settings.collection_name, count_filter=volume_filter, exact=True
            )
            if total == 0 or page > math.ceil(total / PAGE_SIZE):
                raise HTTPException(404, "원문 구간을 찾을 수 없습니다")
            points, _ = await self.client.scroll(
                settings.collection_name,
                scroll_filter=build_filter(
                    must=[
                        field_match("volume", volume),
                        field_range(
                            "chunk_index",
                            gte=(page - 1) * PAGE_SIZE,
                            lt=page * PAGE_SIZE,
                        ),
                    ]
                ),
                limit=PAGE_SIZE,
                with_vectors=False,
            )
        except HTTPException:
            raise
        except Exception:
            raise SearchFailedError("훈독 원문 조회 실패") from None
        current_right = (await self.allowed("scope_full_text")).get(volume)
        if current_right is None:
            raise HTTPException(404, "원문을 찾을 수 없습니다")
        ordered = sorted(
            (point_to_search_result(p) for p in points), key=lambda r: r.chunk_index
        )
        if not ordered:
            raise HTTPException(404, "원문 구간을 찾을 수 없습니다")
        chunks = [
            WordChunk(chunk_id=r.chunk_id, chunk_index=r.chunk_index, text=r.text)
            for r in ordered
        ]
        body = merge_with_dedup(
            main_text=chunks[0].text, before=[], after=[c.text for c in chunks[1:]]
        ).merged_text
        return WordsResponse(
            volume=volume,
            work_title=current_right.work_title,
            authority_grade=current_right.authority_grade,
            page=page,
            page_size=PAGE_SIZE,
            total_chunks=total,
            total_pages=math.ceil(total / PAGE_SIZE),
            chunks=chunks,
            body=body,
        )

    async def today(self, user_id: uuid.UUID) -> JeongseongTodayResponse:
        today = self.today_fn()
        period = await self.periods.get_active(user_id)
        if period is None or today >= period.started_on + timedelta(
            days=period.duration_days
        ):
            return JeongseongTodayResponse(
                date=today, status="none", reason="no_period"
            )
        period_id = period.id
        if today < period.started_on:
            return JeongseongTodayResponse(
                date=today, status="none", reason="upcoming", period_id=period_id
            )
        reading = await self.repo.get_reading(period_id, today)
        if reading is None:
            results = await self._search(
                period.topic, list(await self.allowed("scope_jeongseong")), 300
            )
            rights = await self.allowed("scope_jeongseong")
            # 외부 검색은 잠금 없이 한 번만 한다. 저장 경쟁 판정은 기간 잠금 안에서 한다.
            if not await self.repo.lock_active_period(period_id):
                await self.repo.release()
                return JeongseongTodayResponse(
                    date=today, status="none", reason="no_period"
                )
            winner = await self.repo.get_reading(period_id, today)
            if winner is not None:
                reading = winner
            else:
                previous = await self.repo.list_readings(period_id)
                used_ids = {r.chunk_id for r in previous}
                used_bodies = {"".join(r.body.split()) for r in previous}
                eligible = [
                    r
                    for r in results
                    if r.volume in rights
                    and r.chunk_id not in used_ids
                    and "".join(r.text.split()) not in used_bodies
                ]
                candidates = filter_results(eligible, min_len=50, max_len=300, limit=1)
                if not candidates:
                    await self.repo.release()
                    return JeongseongTodayResponse(
                        date=today,
                        status="none",
                        reason="no_candidates",
                        period_id=period_id,
                    )
                candidate = candidates[0]
                result = next(
                    r for r in eligible if r.chunk_id == candidate["chunk_id"]
                )
                # 카테고리 이름을 화자로 추정하지 않는다. 원문에 확인된 메타가 없으면 미확인.
                current_period = await self.periods.get_active(user_id)
                if current_period is None or current_period.id != period_id:
                    await self.repo.release()
                    return JeongseongTodayResponse(
                        date=today, status="none", reason="no_period"
                    )
                reading = await self.repo.save_reading(
                    JeongseongReading(
                        period_id=period_id,
                        reading_date=today,
                        volume=result.volume,
                        chunk_id=result.chunk_id,
                        body=result.text,
                        title=candidate["suggested_title"],
                        work_title=rights[result.volume].work_title,
                        authority_grade=rights[result.volume].authority_grade,
                    )
                )
        current_period = await self.periods.get_active(user_id)
        if reading is None or current_period is None or current_period.id != period_id:
            return JeongseongTodayResponse(
                date=today, status="none", reason="no_period"
            )
        if reading.volume not in await self.allowed("scope_jeongseong"):
            return JeongseongTodayResponse(
                date=today,
                status="withdrawn",
                reason="rights_withdrawn",
                period_id=period_id,
            )
        return JeongseongTodayResponse(
            date=today,
            status="available",
            period_id=period_id,
            reading=DailyReadingPublic(
                id=reading.id,
                reading_date=today,
                title=reading.title,
                body=reading.body,
                speaker=reading.speaker,
                spoken_on=reading.spoken_on,
                work_title=reading.work_title,
                edition=reading.edition,
                authority_grade=reading.authority_grade,
                review_status="unverified",
                estimated_minutes=reading.estimated_minutes,
            ),
        )
