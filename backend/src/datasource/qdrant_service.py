"""Qdrant 기반 데이터 소스 조작 Service. 카테고리 태그 관리 + 통계 집계."""

import unicodedata

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchAny, MatchValue

from src.datasource.schemas import (
    CategoryDocumentStats,
    VolumeInfo,
    VolumeTagResponse,
    VolumeTagsBulkResponse,
)


class DataSourceQdrantService:
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
        """카테고리별 Qdrant 문서/청크 통계 — 전체 포인트 1회 순회."""
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
                    if src in category_keys:
                        counts[src] = counts.get(src, 0) + 1
                        if vol:
                            volumes_map.setdefault(src, set()).add(vol)
            if offset is None:
                break

        return [
            CategoryDocumentStats(
                source=key,
                total_chunks=counts.get(key, 0),
                volumes=sorted(volumes_map.get(key, set())),
                volume_count=len(volumes_map.get(key, set())),
            )
            for key in category_keys
        ]

    def get_all_volumes(self) -> list[VolumeInfo]:
        """전체 volume 목록 조회 — Transfer UI용. (동기 클라이언트 사용)"""
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

        return sorted(
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

        return VolumeTagResponse(
            volume=volume,
            updated_sources=final_sources,
            updated_chunks=updated,
        )

    async def add_volume_tags_bulk(
        self, volumes: list[str], source: str
    ) -> VolumeTagsBulkResponse:
        """여러 volume에 동일 source 태그를 한 번의 scroll로 추가.

        기존 단일 volume add를 N번 반복하면 각 call마다 scroll이 발생하지만,
        bulk는 `MatchAny`로 전체 volume을 한 번에 scroll 후 메모리에서 grouping해
        최소한의 set_payload로 처리한다.
        """
        volume_names = [unicodedata.normalize("NFD", v) for v in volumes]
        volume_name_set = set(volume_names)

        # (volume, frozenset(sources)) 기준으로 그룹핑 — set_payload를 그룹별 1회로 압축
        groups: dict[tuple[str, frozenset[str]], list] = {}
        volumes_seen: set[str] = set()

        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchAny(any=volume_names))]
                ),
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol = payload.get("volume", "")
                if vol not in volume_name_set:
                    continue
                volumes_seen.add(vol)
                sources = payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source in sources:
                    continue  # 이미 태그 존재, skip
                key = (vol, frozenset(sources))
                groups.setdefault(key, []).append(p.id)
            if offset is None:
                break

        updated_chunks = 0
        updated_volumes_set: set[str] = set()
        for (vol, existing_sources), point_ids in groups.items():
            new_sources = sorted(existing_sources | {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated_chunks += len(point_ids)
            updated_volumes_set.add(vol)

        # volume_name(NFD) → 원본 입력 이름으로 복원 매핑
        nfd_to_input = {unicodedata.normalize("NFD", v): v for v in volumes}
        updated_volumes = sorted(nfd_to_input[v] for v in updated_volumes_set if v in nfd_to_input)

        skipped = []
        for v in volumes:
            nfd = unicodedata.normalize("NFD", v)
            if nfd not in volumes_seen:
                skipped.append({"volume": v, "reason": "Qdrant에 해당 volume 없음"})
            elif nfd not in updated_volumes_set:
                skipped.append({"volume": v, "reason": "이미 태그가 있음"})

        return VolumeTagsBulkResponse(
            updated_volumes=updated_volumes,
            skipped_volumes=skipped,
            total_chunks_modified=updated_chunks,
        )

    async def remove_volume_tags_bulk(
        self, volumes: list[str], source: str
    ) -> VolumeTagsBulkResponse:
        """여러 volume에서 동일 source 태그를 한 번의 scroll로 제거.

        마지막 태그인 경우 해당 volume은 스킵하고 skipped_volumes에 기록.
        """
        volume_names = [unicodedata.normalize("NFD", v) for v in volumes]
        volume_name_set = set(volume_names)

        # volume별 (sources_by_point) 수집 후, 마지막 태그 검사 → 그룹 빌드
        volume_points: dict[str, list[tuple[str, frozenset[str]]]] = {}
        volumes_seen: set[str] = set()

        offset = None
        while True:
            points, offset = await self.async_client.scroll(
                collection_name=self.collection_name,
                scroll_filter=Filter(
                    must=[FieldCondition(key="volume", match=MatchAny(any=volume_names))]
                ),
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol = payload.get("volume", "")
                if vol not in volume_name_set:
                    continue
                volumes_seen.add(vol)
                sources = payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source not in sources:
                    continue  # 태그 없으면 skip
                volume_points.setdefault(vol, []).append((p.id, frozenset(sources)))
            if offset is None:
                break

        nfd_to_input = {unicodedata.normalize("NFD", v): v for v in volumes}
        skipped: list[dict] = []
        updated_volumes_set: set[str] = set()
        groups: dict[frozenset[str], list] = {}

        for vol, point_entries in volume_points.items():
            # volume의 어느 point라도 마지막 태그면 해당 volume 전체 스킵
            has_single = any(len(fs) <= 1 for _, fs in point_entries)
            if has_single:
                skipped.append({
                    "volume": nfd_to_input.get(vol, vol),
                    "reason": "마지막 카테고리 태그라 제거 불가",
                })
                continue
            for point_id, fs in point_entries:
                groups.setdefault(fs, []).append(point_id)
            updated_volumes_set.add(vol)

        updated_chunks = 0
        for existing_sources, point_ids in groups.items():
            new_sources = sorted(existing_sources - {source})
            await self.async_client.set_payload(
                collection_name=self.collection_name,
                payload={"source": new_sources},
                points=point_ids,
            )
            updated_chunks += len(point_ids)

        for v in volumes:
            nfd = unicodedata.normalize("NFD", v)
            if nfd not in volumes_seen:
                skipped.append({"volume": v, "reason": "Qdrant에 해당 volume 없음"})
            elif nfd not in volume_points:
                skipped.append({"volume": v, "reason": "이미 태그가 없음"})

        updated_volumes = sorted(nfd_to_input[v] for v in updated_volumes_set if v in nfd_to_input)

        return VolumeTagsBulkResponse(
            updated_volumes=updated_volumes,
            skipped_volumes=skipped,
            total_chunks_modified=updated_chunks,
        )

    async def remove_volume_tag(self, volume: str, source: str) -> VolumeTagResponse:
        """문서에서 카테고리 태그를 제거. 마지막 태그는 제거 불가."""
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
                sources = p.payload.get("source", [])
                if isinstance(sources, str):
                    sources = [sources]
                if source in sources:
                    if len(sources) <= 1:
                        raise ValueError(
                            "마지막 카테고리 태그는 제거할 수 없습니다. 최소 1개 카테고리가 필요합니다."
                        )
                    key = frozenset(sources)
                    groups.setdefault(key, []).append(p.id)
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

        return VolumeTagResponse(
            volume=volume,
            updated_sources=sorted(final_sources_set) if final_sources_set else [],
            updated_chunks=updated,
        )
