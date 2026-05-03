"""Qdrant 기반 데이터 소스 조작 Service. 카테고리 태그 관리 + 통계 집계.

raw httpx (HTTP/1.1) 클라이언트 사용 — qdrant-client SDK HTTP/2 hang 회피.
(PR #78 진단, docs/dev-log/47 참조)
"""

import asyncio
import unicodedata
from typing import Any

from src.datasource.chunk_merge import merge_with_dedup
from src.datasource.schemas import (
    CategoryDocumentStats,
    SourceChunkDetail,
    VolumeDeleteResponse,
    VolumeInfo,
    VolumeTagResponse,
    VolumeTagsBulkResponse,
)
from src.qdrant import RawQdrantClient
from src.qdrant.filters import (
    build_filter,
    field_match,
    field_match_any,
    field_range,
)

# Qdrant facet API 결과 상한 — 카테고리 수/볼륨 수 여유분 포함.
_FACET_LIMIT = 1000


class DataSourceQdrantService:
    def __init__(
        self,
        client: RawQdrantClient,
        collection_name: str,
    ) -> None:
        self.client = client
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
                points, offset = await self.client.scroll(
                    self.collection_name,
                    scroll_filter=build_filter(must=[field_match("volume", candidate)]),
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
        """카테고리별 Qdrant 문서/청크 통계 — Facet API 기반.

        Qdrant 서버에서 group-by+count 집계를 수행하므로 전체 포인트 scroll
        없이 수백 ms로 응답. 66k 포인트 기준 0.5초 이내.

        호출 구성 (전체 N ≈ 1 + |category_keys|):
          1) source 전체 카운트 1회
          2) 각 category 별 volume facet (source 필터) — 병렬 gather
        """
        # 1) 카테고리별 chunk count
        source_facet = await self.client.facet(
            self.collection_name,
            key="source",
            limit=_FACET_LIMIT,
        )
        counts: dict[str, int] = {
            str(hit.value): int(hit.count) for hit in source_facet
        }

        # 2) 요청된 카테고리마다 volume 목록을 병렬로 조회
        async def _volumes_for_source(src: str) -> tuple[str, list[str]]:
            hits = await self.client.facet(
                self.collection_name,
                key="volume",
                facet_filter=build_filter(must=[field_match("source", src)]),
                limit=_FACET_LIMIT,
            )
            return src, sorted(str(h.value) for h in hits if h.value)

        results = await asyncio.gather(*(_volumes_for_source(k) for k in category_keys))
        volumes_map: dict[str, list[str]] = dict(results)

        return [
            CategoryDocumentStats(
                source=key,
                total_chunks=counts.get(key, 0),
                volumes=volumes_map.get(key, []),
                volume_count=len(volumes_map.get(key, [])),
            )
            for key in category_keys
        ]

    async def get_all_volumes(self) -> list[VolumeInfo]:
        """전체 volume 목록 조회 — Transfer UI용. Facet API 기반.

        구성:
          1) volume facet (필터 없음) → volume별 총 chunk_count
          2) source facet → 존재하는 source 목록
          3) 각 source 별 volume facet (source 필터) → volume-source 역매핑
          (source 수가 적어 N=1~10 정도, 전체 ~1초 이내)
        """
        # 1) 각 volume의 total chunk_count
        volume_facet = await self.client.facet(
            self.collection_name,
            key="volume",
            limit=_FACET_LIMIT,
        )
        volume_chunks: dict[str, int] = {
            str(h.value): int(h.count) for h in volume_facet if h.value
        }

        # 2) 어떤 source 값들이 존재하는지
        source_facet = await self.client.facet(
            self.collection_name,
            key="source",
            limit=_FACET_LIMIT,
        )
        sources = [str(h.value) for h in source_facet if h.value]

        # 3) source 별 volume 목록을 병렬 조회 → volume → sources 역매핑
        async def _volumes_for_source(src: str) -> tuple[str, list[str]]:
            hits = await self.client.facet(
                self.collection_name,
                key="volume",
                facet_filter=build_filter(must=[field_match("source", src)]),
                limit=_FACET_LIMIT,
            )
            return src, [str(h.value) for h in hits if h.value]

        pairs = await asyncio.gather(*(_volumes_for_source(s) for s in sources))
        volume_sources: dict[str, set[str]] = {}
        for src, vols in pairs:
            for v in vols:
                volume_sources.setdefault(v, set()).add(src)

        return sorted(
            [
                VolumeInfo(
                    volume=vol,
                    sources=sorted(volume_sources.get(vol, set())),
                    chunk_count=volume_chunks[vol],
                )
                for vol in volume_chunks
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
            points, offset = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(must=[field_match("volume", volume_name)]),
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
                if source not in sources:
                    key = frozenset(sources)
                    groups.setdefault(key, []).append(p.id)
            if offset is None:
                break

        # 그룹별로 한 번에 set_payload
        updated = 0
        for existing_sources_set, point_ids in groups.items():
            new_sources = sorted(existing_sources_set | {source})
            await self.client.set_payload(
                self.collection_name,
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
            points, offset = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(
                    must=[field_match_any("volume", list(search_terms))]
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
            await self.client.set_payload(
                self.collection_name,
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
            points, offset = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(
                    must=[field_match_any("volume", list(search_terms))]
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
            await self.client.set_payload(
                self.collection_name,
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

        return VolumeTagsBulkResponse(
            updated_volumes=updated_volumes,
            skipped_volumes=skipped,
            total_chunks_modified=updated_chunks,
        )

    async def delete_volumes(self, volumes: list[str]) -> VolumeDeleteResponse:
        """volume(파일) 단위로 Qdrant 청크를 영구 삭제한다.

        NFC/NFD 혼재 운영 데이터에 대응해 두 형태 모두 매칭 후 일괄 삭제.
        실제 존재하지 않는 volume은 skipped에 사유와 함께 기록한다.
        """
        if not volumes:
            return VolumeDeleteResponse(
                deleted_volumes=[], total_chunks_deleted=0, skipped=[]
            )

        # NFC 입력으로 정규화 (응답에 사용)
        input_nfc_to_original: dict[str, str] = {
            unicodedata.normalize("NFC", v): v for v in volumes
        }
        input_nfc_set = set(input_nfc_to_original.keys())

        # Qdrant 검색 후보: NFC + NFD 둘 다
        search_terms: set[str] = set()
        for v in volumes:
            search_terms.add(unicodedata.normalize("NFC", v))
            search_terms.add(unicodedata.normalize("NFD", v))

        # 1) 삭제 전 청크 카운트 + volume별 매칭 ID 수집 (skipped 판별용)
        volume_chunk_count: dict[str, int] = {}
        offset = None
        while True:
            points, offset = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(
                    must=[field_match_any("volume", list(search_terms))]
                ),
                with_payload=["volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol_raw = str(payload.get("volume", ""))
                vol_nfc = unicodedata.normalize("NFC", vol_raw)
                if vol_nfc not in input_nfc_set:
                    continue
                volume_chunk_count[vol_nfc] = volume_chunk_count.get(vol_nfc, 0) + 1
            if offset is None:
                break

        # 2) 매칭된 volume이 있는 입력만 실제 삭제 (NFC/NFD 모두 search_terms로 한 번에 처리)
        deleted_nfc = set(volume_chunk_count.keys())
        if deleted_nfc:
            # search_terms에는 NFD까지 포함되어 있으나 매칭 안 된 입력은 별도로 skip 처리되므로
            # 여기서는 매칭된 volume(NFC)에 대응하는 NFC + NFD 두 형태만 다시 추려 삭제 필터로 사용.
            delete_terms: list[str] = []
            for nfc in deleted_nfc:
                delete_terms.append(nfc)
                nfd = unicodedata.normalize("NFD", nfc)
                if nfd != nfc:
                    delete_terms.append(nfd)
            await self.client.delete(
                self.collection_name,
                points_selector=build_filter(
                    must=[field_match_any("volume", delete_terms)]
                ),
            )

        # 3) skipped 산출
        skipped: list[dict] = []
        for v in volumes:
            nfc = unicodedata.normalize("NFC", v)
            if nfc not in deleted_nfc:
                skipped.append({"volume": v, "reason": "Qdrant에 해당 volume 없음"})

        deleted_volumes = sorted(input_nfc_to_original[nfc] for nfc in deleted_nfc)
        total_chunks = sum(volume_chunk_count.values())

        return VolumeDeleteResponse(
            deleted_volumes=deleted_volumes,
            total_chunks_deleted=total_chunks,
            skipped=skipped,
        )

    async def remove_volume_tag(self, volume: str, source: str) -> VolumeTagResponse:
        """문서에서 카테고리 태그를 제거.

        마지막 남은 태그를 제거하면 source=[]가 되어 "미분류" 상태로 전이된다.
        이는 정상 상태이며, 다시 분류하려면 미분류 섹션에서 태그를 붙이면 된다.

        NFC/NFD 혼재 대응 (PR #24 bulk 경로와 동일 패턴):
        - search term 으로 두 정규화 형태 모두 사용.
        - scroll 결과의 volume 을 NFC 기준으로 입력과 비교해 실제 매칭 확정.
        """
        input_nfc = unicodedata.normalize("NFC", volume)
        input_nfd = unicodedata.normalize("NFD", volume)
        search_terms = (
            [input_nfc] if input_nfc == input_nfd else [input_nfc, input_nfd]
        )

        groups: dict[frozenset[str], list] = {}
        offset = None
        while True:
            points, offset = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(
                    must=[field_match_any("volume", search_terms)]
                ),
                with_payload=["source", "volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                payload = p.payload or {}
                vol_raw = payload.get("volume", "")
                # Qdrant 필터가 NFC/NFD 둘 다 매칭했으므로 NFC 기준으로 한 번 더 확인.
                if unicodedata.normalize("NFC", vol_raw) != input_nfc:
                    continue
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
            await self.client.set_payload(
                self.collection_name,
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

    async def get_chunk_detail(
        self,
        chunk_id: str,
        *,
        context_window: int = 2,
    ) -> SourceChunkDetail | None:
        """P0-B — 인용 카드 원문보기 모달용 청크 + dedup 된 연속 문맥 조회.

        같은 volume 의 chunk_index 인접 ±``context_window`` 청크들을 가져와
        suffix-prefix overlap dedup 후 **하나의 연속 본문** 으로 합쳐 반환한다.
        프론트는 ``main_offset_start..main_offset_end`` 범위만 시각 강조하면
        끊김/중복 없는 reading flow 가 자연스럽게 형성된다.

        Chunking artifact (overlap=150) 의 부산물을 백엔드에서 한 번 정리.
        ACL: 같은 volume → 동일 source 집합이므로 권한 변동 없음.

        Args:
            chunk_id: Qdrant point id.
            context_window: 메인 위/아래로 가져올 인접 청크 수 (기본 2 → 총 5).
        """
        try:
            points = await self.client.retrieve(
                self.collection_name,
                ids=[chunk_id],
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            return None
        if not points:
            return None
        payload: dict[str, Any] = points[0].payload or {}
        main_text = str(payload.get("text", ""))
        volume = str(payload.get("volume", ""))
        main_idx_raw = payload.get("chunk_index")
        main_chunk_index = (
            int(main_idx_raw) if isinstance(main_idx_raw, (int, float)) else -1
        )

        before_texts, after_texts = await self._fetch_chunk_context_texts(
            volume=volume,
            main_chunk_index=main_chunk_index,
            window=context_window,
        )

        merged = merge_with_dedup(
            main_text=main_text,
            before=before_texts,
            after=after_texts,
        )

        return SourceChunkDetail(
            chunk_id=str(points[0].id),
            text=main_text,
            volume=volume,
            sources=_coerce_sources(payload.get("source")),
            chunk_index=main_chunk_index,
            merged_text=merged.merged_text,
            main_offset_start=merged.main_offset_start,
            main_offset_end=merged.main_offset_end,
        )

    async def _fetch_chunk_context_texts(
        self,
        *,
        volume: str,
        main_chunk_index: int,
        window: int,
    ) -> tuple[list[str], list[str]]:
        """메인 청크 인접 ±window 청크 본문을 chunk_index 순서로 fetch.

        chunk_index 가 메인과 정확히 인접 (idx == main±k, k=1..window) 인 경우만
        반환 — 갭 (deletion 등) 은 dedup 시 잘못된 매칭 위험 → 갭 발견 시 그
        지점에서 stop. volume/chunk_index 비정상이면 빈 리스트 (graceful).
        """
        if not volume or main_chunk_index < 0 or window <= 0:
            return [], []

        gte = max(0, main_chunk_index - window)
        lte = main_chunk_index + window
        try:
            points, _ = await self.client.scroll(
                self.collection_name,
                scroll_filter=build_filter(
                    must=[
                        field_match("volume", volume),
                        field_range("chunk_index", gte=gte, lte=lte),
                    ]
                ),
                with_payload=["text", "chunk_index"],
                with_vectors=False,
                limit=window * 2 + 2,
            )
        except Exception:
            return [], []

        by_idx: dict[int, str] = {}
        for p in points:
            payload: dict[str, Any] = p.payload or {}
            idx_raw = payload.get("chunk_index")
            if not isinstance(idx_raw, (int, float)):
                continue
            idx = int(idx_raw)
            if idx == main_chunk_index:
                continue
            by_idx[idx] = str(payload.get("text", ""))

        # 메인에서 멀어지는 방향으로 연속(인접)인 동안만 채택 — 갭 발견 시 stop.
        before: list[str] = []
        for k in range(1, window + 1):
            idx = main_chunk_index - k
            if idx not in by_idx:
                break
            before.insert(0, by_idx[idx])
        after: list[str] = []
        for k in range(1, window + 1):
            idx = main_chunk_index + k
            if idx not in by_idx:
                break
            after.append(by_idx[idx])

        return before, after


def _coerce_sources(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return [str(s) for s in raw if s]
    return []

