"""원문 화면·낭독·레거시 발췌의 조회 문맥과 표시 규칙을 소유한다."""

import math
import uuid

from fastapi import HTTPException

from app.core.config import settings
from app.modules.datasource.chunk_merge import merge_with_dedup
from app.modules.hoondok.display_text import PAGE_SIZE, to_display_text
from app.modules.hoondok.journey_repository import JourneyRepository
from app.modules.hoondok.journey_schemas import WordChunk, WordsResponse
from app.modules.hoondok.library_repository import LibraryRepository
from app.modules.hoondok.library_schemas import WordSection
from app.modules.qdrant import RawQdrantClient
from app.modules.qdrant.filters import (
    build_filter,
    field_match,
    field_match_any,
    field_range,
)
from app.modules.search.exceptions import SearchFailedError
from app.modules.search.hybrid import SearchResult, point_to_search_result


def _point_id(chunk_id: str) -> str | int | None:
    try:
        return str(uuid.UUID(chunk_id))
    except ValueError:
        if chunk_id.isdecimal() and 0 <= int(chunk_id) < 2**64:
            return int(chunk_id)
        return None


class ReaderContent:
    def __init__(
        self,
        repo: JourneyRepository | LibraryRepository,
        client: RawQdrantClient,
        sections: LibraryRepository | None = None,
    ):
        self.repo, self.client, self.sections = repo, client, sections

    async def allowed(self):
        return {
            right.volume: right
            for right in await self.repo.list_rights()
            if right.status == "allowed" and right.scope_full_text
        }

    async def words(
        self,
        volume: str,
        page: int,
        chunk_id: str | None,
        section: int | None = None,
    ) -> WordsResponse:
        if volume not in await self.allowed():
            raise HTTPException(404, "원문을 찾을 수 없습니다")
        # 목차로 들어온 장은 그대로 현재 장이다 — 장 시작이 페이지 경계와 어긋나도 앞 장을 보이지 않는다.
        requested: WordSection | None = None
        try:
            if not chunk_id and section is not None:
                # chunk_id 가 우선이다 — 검색 결과 진입이 목차 선택보다 구체적이다.
                found = await self._section_by_position(volume, section)
                if found is None:
                    raise HTTPException(404, "원문 구간을 찾을 수 없습니다")
                page = found.start_chunk_index // PAGE_SIZE + 1
                requested = WordSection(
                    position=found.position, level=found.level, title=found.title
                )
            if chunk_id:
                # Qdrant ID는 UUID 또는 unsigned integer뿐이다. 잘못된 ID도 404로 통일한다.
                point_id = _point_id(chunk_id)
                if point_id is None:
                    raise HTTPException(404, "원문을 찾을 수 없습니다")
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
        current_right = (await self.allowed()).get(volume)
        if current_right is None:
            raise HTTPException(404, "원문을 찾을 수 없습니다")
        ordered = sorted(
            (point_to_search_result(p) for p in points), key=lambda r: r.chunk_index
        )
        if not ordered:
            raise HTTPException(404, "원문 구간을 찾을 수 없습니다")
        # 표시 텍스트는 바로 앞 청크와의 겹침을 잘라낸다. 페이지 첫 청크는 앞이 없다.
        chunks = [
            WordChunk(
                chunk_id=r.chunk_id,
                chunk_index=r.chunk_index,
                text=r.text,
                display_text=self._display(r, ordered[i - 1].text if i > 0 else None),
            )
            for i, r in enumerate(ordered)
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
            section=requested
            if requested is not None
            else await self._section_at(volume, chunks[0].chunk_index),
        )

    async def chunk_display_text(self, chunk_id: str) -> str | None:
        point_id = _point_id(chunk_id)
        if point_id is None:
            return None
        try:
            records = await self.client.retrieve(
                settings.collection_name, ids=[point_id]
            )
            if not records:
                return None
            current = point_to_search_result(records[0])
            if not isinstance(current.chunk_index, int) or current.chunk_index < 0:
                return None
            if current.volume not in await self.allowed():
                return None
            texts = await self._texts([current])
            return texts[(current.volume, current.chunk_id)]
        except Exception:
            raise SearchFailedError("훈독 원문 조회 실패") from None

    async def excerpt_texts(
        self, requests: list[tuple[str, str]]
    ) -> dict[tuple[str, str], str]:
        targets = [
            (volume, chunk_id, _point_id(chunk_id)) for volume, chunk_id in requests
        ]
        ids = list(
            dict.fromkeys(
                point_id for _, _, point_id in targets if point_id is not None
            )
        )
        if not ids:
            return {}
        records = await self.client.retrieve(settings.collection_name, ids=ids)
        by_id = {str(record.id): point_to_search_result(record) for record in records}
        matched = {}
        for volume, chunk_id, point_id in targets:
            found = by_id.get(str(point_id))
            if (
                found is not None
                and found.volume == volume
                and isinstance(found.chunk_index, int)
                and found.chunk_index >= 0
            ):
                matched[(volume, chunk_id)] = found
        texts = await self._texts(list(matched.values()))
        return {
            key: texts[(found.volume, found.chunk_id)] for key, found in matched.items()
        }

    async def _texts(self, chunks: list[SearchResult]) -> dict[tuple[str, str], str]:
        wanted: dict[str, set[int]] = {}
        for chunk in chunks:
            if chunk.chunk_index % PAGE_SIZE:
                wanted.setdefault(chunk.volume, set()).add(chunk.chunk_index - 1)
        previous = {}
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
                found = point_to_search_result(point)
                previous[(found.volume, found.chunk_index)] = found.text
        return {
            (chunk.volume, chunk.chunk_id): self._display(
                chunk, previous.get((chunk.volume, chunk.chunk_index - 1))
            )
            for chunk in chunks
        }

    @staticmethod
    def _display(chunk: SearchResult, previous: str | None) -> str:
        return to_display_text(
            previous if chunk.chunk_index % PAGE_SIZE else None, chunk.text
        )

    async def _section_by_position(self, volume: str, position: int):
        if self.sections is None:
            return None
        return await self.sections.get_section_by_position(volume, position)

    async def _section_at(self, volume: str, chunk_index: int) -> WordSection | None:
        if self.sections is None:
            return None
        found = await self.sections.get_section_at(volume, chunk_index)
        if found is None:
            return None
        return WordSection(
            position=found.position, level=found.level, title=found.title
        )
