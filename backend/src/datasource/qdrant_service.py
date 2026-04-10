"""Qdrant 기반 데이터 소스 조작 Service. 카테고리 태그 관리 + 통계 집계."""

import unicodedata

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue

from src.datasource.schemas import CategoryDocumentStats, VolumeInfo, VolumeTagResponse


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
