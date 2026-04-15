"""Qdrant 기반 데이터 소스 조작 Service. 카테고리 태그 관리 + 통계 집계."""

import time
import unicodedata

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

from src.datasource.schemas import (
    CategoryDocumentStats,
    VolumeInfo,
    VolumeTagResponse,
    VolumeTagsBulkResponse,
)

# 전체 컬렉션 스캔 결과를 일정 시간 캐시한다.
# 무료 Qdrant Cloud 티어에서 66k+ 포인트 scroll 시 30~60초 소요되어 첫 호출만 비용,
# 이후엔 캐시로 즉시 응답.  태그 변경 등 쓰기 작업이 있을 때 명시적으로 무효화.
_SCAN_CACHE_TTL_SEC = 60.0


class DataSourceQdrantService:
    # 클래스 레벨 캐시 (인스턴스마다 새로 만들어지지 않도록)
    _category_stats_cache: list[CategoryDocumentStats] | None = None
    _category_stats_cache_at: float = 0.0
    _all_volumes_cache: list[VolumeInfo] | None = None
    _all_volumes_cache_at: float = 0.0

    @classmethod
    def invalidate_caches(cls) -> None:
        """태그 변경 후 호출하여 캐시를 무효화."""
        cls._category_stats_cache = None
        cls._all_volumes_cache = None
    def __init__(
        self,
        async_client: AsyncQdrantClient,
        sync_client: QdrantClient,
        collection_name: str,
    ) -> None:
        self.async_client = async_client
        self.sync_client = sync_client
        self.collection_name = collection_name

    async def get_volume_snapshot(self, volume: str) -> tuple[list[str], int]:
        """특정 volume의 (sources, chunk_count) 조회.

        NFC/NFD 두 형태를 모두 조회해 과거 적재 데이터까지 포함해서 집계한다.
        중복 적재 감지용.
        """
        import unicodedata as _u

        volume_nfc = _u.normalize("NFC", volume)
        volume_nfd = _u.normalize("NFD", volume)
        candidates = [volume_nfc] if volume_nfc == volume_nfd else [volume_nfc, volume_nfd]

        sources: set[str] = set()
        chunk_count = 0
        for candidate in candidates:
            offset = None
            while True:
                points, offset = await self.async_client.scroll(
                    collection_name=self.collection_name,
                    scroll_filter=Filter(
                        must=[FieldCondition(key="volume", match=MatchValue(value=candidate))]
                    ),
                    with_payload=["source"],
                    with_vectors=False,
                    limit=1000,
                    offset=offset,
                )
                for p in points:
                    chunk_count += 1
                    payload = p.payload or {}
                    raw = payload.get("source", [])
                    if isinstance(raw, str):
                        if raw:
                            sources.add(raw)
                    else:
                        sources.update(raw)
                if offset is None:
                    break

        return sorted(sources), chunk_count

    async def get_category_stats(
        self, category_keys: set[str]
    ) -> list[CategoryDocumentStats]:
        """카테고리별 Qdrant 문서/청크 통계 — 전체 포인트 1회 순회.

        결과는 클래스 레벨 캐시에 60초 보관 (Qdrant Cloud 무료 티어 대응).
        category_keys 와 무관하게 모든 source 통계를 캐시한 뒤, 호출 시 요청된
        keys 만 필터하여 반환한다.
        """
        cls = type(self)
        now = time.monotonic()
        cached = cls._category_stats_cache
        if cached is not None and now - cls._category_stats_cache_at < _SCAN_CACHE_TTL_SEC:
            cached_keys = {s.source for s in cached}
            if category_keys.issubset(cached_keys):
                return [s for s in cached if s.source in category_keys]

        counts: dict[str, int] = {}
        volumes_map: dict[str, set[str]] = {}

        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                sources = p.payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                vol = p.payload.get("volume", "")
                for src in sources:
                    counts[src] = counts.get(src, 0) + 1
                    if vol:
                        volumes_map.setdefault(src, set()).add(vol)
            if offset is None:
                break

        # 캐시는 모든 source(요청 외 포함) 보관 — 다른 호출이 다른 keys 요청해도 재사용
        all_sources = set(counts) | category_keys
        full_stats = [
            CategoryDocumentStats(
                source=key,
                total_chunks=counts.get(key, 0),
                volumes=sorted(volumes_map.get(key, set())),
                volume_count=len(volumes_map.get(key, set())),
            )
            for key in all_sources
        ]
        cls._category_stats_cache = full_stats
        cls._category_stats_cache_at = now
        return [s for s in full_stats if s.source in category_keys]

    def get_all_volumes(self) -> list[VolumeInfo]:
        """전체 volume 목록 조회 — Transfer UI용. (동기 클라이언트 사용)

        결과는 60초간 클래스 레벨 캐시 (Qdrant Cloud 무료 티어 대응).
        태그 변경 작업 후엔 invalidate_caches()로 무효화한다.
        """
        cls = type(self)
        now = time.monotonic()
        cached = cls._all_volumes_cache
        if cached is not None and now - cls._all_volumes_cache_at < _SCAN_CACHE_TTL_SEC:
            return cached

        volume_map: dict[str, dict] = {}
        offset = None

        while True:
            points, next_offset = self.sync_client.scroll(
                collection_name=self.collection_name,
                limit=1000,
                offset=offset,
                with_payload=["volume", "source"],
                with_vectors=False,
            )

            if not points:
                break

            for point in points:
                payload = point.payload or {}
                volume = payload.get("volume", "")
                if not volume:
                    continue

                raw_source = payload.get("source", [])
                if isinstance(raw_source, str):
                    sources = [raw_source] if raw_source else []
                else:
                    sources = list(raw_source) if raw_source else []

                if volume not in volume_map:
                    volume_map[volume] = {"sources": set(), "chunk_count": 0}

                volume_map[volume]["sources"].update(sources)
                volume_map[volume]["chunk_count"] += 1

            offset = next_offset
            if offset is None:
                break

        result = sorted(
            [
                VolumeInfo(
                    volume=vol,
                    sources=sorted(info["sources"]),
                    chunk_count=info["chunk_count"],
                )
                for vol, info in volume_map.items()
            ],
            key=lambda v: v.volume,
        )
        cls._all_volumes_cache = result
        cls._all_volumes_cache_at = now
        return result

    async def add_volume_tag(self, volume: str, source: str) -> VolumeTagResponse:
        """문서에 카테고리 태그를 추가. 이미 있으면 무시."""
        # macOS NFD 정규화
        volume_name = unicodedata.normalize("NFD", volume)

        # 해당 volume의 모든 청크 조회 → 같은 source 조합끼리 그룹핑
        groups: dict[frozenset[str], list] = {}
        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchValue(value=volume_name))]
                ),
                with_payload=["source"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                sources = p.payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source not in sources:
                    key = frozenset(sources)
                    groups.setdefault(key, []).append(p.id)
            if offset is None:
                break

        # 그룹별로 한 번에 set_payload
        updated = 0
        for existing_sources_set, point_ids in groups.items():
            new_sources = sorted(existing_sources_set | {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated += len(point_ids)

        final_sources = sorted(
            {source} | {s for fs in groups for s in fs}
        ) if groups else [source]

        if updated:
            type(self).invalidate_caches()

        return VolumeTagResponse(
            volume=volume,
            updated_sources=final_sources,
            updated_chunks=updated,
        )

    async def add_volume_tags_bulk(
        self, volumes: list[str], source: str
    ) -> VolumeTagsBulkResponse:
        """여러 volume에 동일 source 태그를 한 번의 scroll로 추가.

        Qdrant 내부 volume 페이로드가 NFC/NFD 혼재 가능 (과거 ingest 코드가 NFD,
        최근 코드는 NFC 저장). 검색어는 두 형태 모두 제공, 매칭 비교는 NFC canonical.
        """
        # 입력 NFC → 원본 매핑 (응답용)
        input_nfc_to_original: dict[str, str] = {
            unicodedata.normalize("NFC", v): v for v in volumes
        }
        input_nfc_set = set(input_nfc_to_original.keys())

        # Qdrant 검색 후보: NFC + NFD 둘 다
        search_terms: set[str] = set()
        for v in volumes:
            search_terms.add(unicodedata.normalize("NFC", v))
            search_terms.add(unicodedata.normalize("NFD", v))

        groups: dict[tuple[str, frozenset[str]], list] = {}
        volumes_seen_nfc: set[str] = set()

        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchAny(any=list(search_terms)))]
                ),
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol_raw = payload.get("volume", "")
                vol_nfc = unicodedata.normalize("NFC", vol_raw)
                if vol_nfc not in input_nfc_set:
                    continue
                volumes_seen_nfc.add(vol_nfc)
                sources = payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source in sources:
                    continue  # 이미 태그 존재
                key = (vol_nfc, frozenset(sources))
                groups.setdefault(key, []).append(p.id)
            if offset is None:
                break

        updated_chunks = 0
        updated_nfc: set[str] = set()
        for (vol_nfc, existing_sources), point_ids in groups.items():
            new_sources = sorted(existing_sources | {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated_chunks += len(point_ids)
            updated_nfc.add(vol_nfc)

        updated_volumes = sorted(input_nfc_to_original[v] for v in updated_nfc)
        skipped: list[dict] = []
        for v in volumes:
            nfc = unicodedata.normalize("NFC", v)
            if nfc not in volumes_seen_nfc:
                skipped.append({"volume": v, "reason": "Qdrant에 해당 volume 없음"})
            elif nfc not in updated_nfc:
                skipped.append({"volume": v, "reason": "이미 태그가 있음"})

        if updated_chunks:
            type(self).invalidate_caches()

        return VolumeTagsBulkResponse(
            updated_volumes=updated_volumes,
            skipped_volumes=skipped,
            total_chunks_modified=updated_chunks,
        )

    async def remove_volume_tags_bulk(
        self, volumes: list[str], source: str
    ) -> VolumeTagsBulkResponse:
        """여러 volume에서 동일 source 태그를 한 번의 scroll로 제거.

        마지막 남은 태그를 제거하면 해당 volume은 source=[] 즉 "미분류"가 된다.
        이는 업로드 파이프라인이 `source=""` 업로드를 허용하는 것과 일관된
        정상 상태이며, Admin UI도 `sources.length === 0` volume을 "미분류"
        섹션으로 노출하므로 데이터 유실이 아니다.

        NFC/NFD 혼재 대응은 add_volume_tags_bulk와 동일.
        """
        input_nfc_to_original: dict[str, str] = {
            unicodedata.normalize("NFC", v): v for v in volumes
        }
        input_nfc_set = set(input_nfc_to_original.keys())

        search_terms: set[str] = set()
        for v in volumes:
            search_terms.add(unicodedata.normalize("NFC", v))
            search_terms.add(unicodedata.normalize("NFD", v))

        groups: dict[frozenset[str], list] = {}
        volumes_seen_nfc: set[str] = set()
        updated_nfc: set[str] = set()

        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchAny(any=list(search_terms)))]
                ),
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol_raw = payload.get("volume", "")
                vol_nfc = unicodedata.normalize("NFC", vol_raw)
                if vol_nfc not in input_nfc_set:
                    continue
                volumes_seen_nfc.add(vol_nfc)
                sources = payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source not in sources:
                    continue  # 태그 없으면 skip
                groups.setdefault(frozenset(sources), []).append(p.id)
                updated_nfc.add(vol_nfc)
            if offset is None:
                break

        updated_chunks = 0
        for existing_sources, point_ids in groups.items():
            new_sources = sorted(existing_sources - {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated_chunks += len(point_ids)

        skipped: list[dict] = []
        for v in volumes:
            nfc = unicodedata.normalize("NFC", v)
            if nfc not in volumes_seen_nfc:
                skipped.append({"volume": v, "reason": "Qdrant에 해당 volume 없음"})
            elif nfc not in updated_nfc:
                skipped.append({"volume": v, "reason": "이미 태그가 없음"})

        updated_volumes = sorted(input_nfc_to_original[v] for v in updated_nfc)

        if updated_chunks:
            type(self).invalidate_caches()

        return VolumeTagsBulkResponse(
            updated_volumes=updated_volumes,
            skipped_volumes=skipped,
            total_chunks_modified=updated_chunks,
        )

    async def remove_volume_tag(self, volume: str, source: str) -> VolumeTagResponse:
        """문서에서 카테고리 태그를 제거.

        마지막 남은 태그를 제거하면 source=[]가 되어 "미분류" 상태로 전이된다.
        이는 정상 상태이며, 다시 분류하려면 미분류 섹션에서 태그를 붙이면 된다.
        """
        # macOS NFD 정규화
        volume_name = unicodedata.normalize("NFD", volume)

        groups: dict[frozenset[str], list] = {}
        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchValue(value=volume_name))]
                ),
                with_payload=["source"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                sources = payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source in sources:
                    groups.setdefault(frozenset(sources), []).append(p.id)
            if offset is None:
                break

        # 그룹별로 한 번에 set_payload
        updated = 0
        final_sources_set: set[str] = set()
        for existing_sources_set, point_ids in groups.items():
            new_sources = sorted(existing_sources_set - {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated += len(point_ids)
            final_sources_set.update(new_sources)

        if updated:
            type(self).invalidate_caches()

        return VolumeTagResponse(
            volume=volume,
            updated_sources=sorted(final_sources_set) if final_sources_set else [],
            updated_chunks=updated,
        )
