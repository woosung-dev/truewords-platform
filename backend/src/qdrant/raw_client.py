"""Raw httpx 기반 Qdrant REST 클라이언트 (HTTP/1.1 강제).

qdrant-client SDK 의 HTTP/2 경로가 Cloudflare Tunnel + Cloud Run 환경에서
60초 ConnectTimeout 으로 hang 하는 문제를 회피한다. (PR #78 진단,
PR #83 cache 적용 검증 완료)

호출처:
- ``backend/src/search/hybrid.py`` 등 검색 모듈 (PR-B 이후)
- ``backend/src/cache/service.py`` (이미 inline 작성, 향후 일원화 가능)
- ``backend/src/datasource/qdrant_service.py`` admin (PR-D 이후)

설계:
- HTTP/1.1 강제 (``http2=False``) — Tunnel + Cloud Run 호환성
- ``QdrantPoint`` dataclass 로 SDK ``ScoredPoint`` attribute access 호환
- ``RawQdrantClient`` 인스턴스는 stateless — base URL/api-key 만 보유
- 매 호출마다 ``httpx.AsyncClient`` 생성 (cache/service.py 와 동일 패턴)

상세: ``docs/dev-log/47-qdrant-sdk-http2-permanent-fix.md``
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from src.config import settings

logger = logging.getLogger(__name__)

# search 등 일반 호출용 timeout. cold start 흡수 + Vercel 60s proxy 대비.
_DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


@dataclass(frozen=True)
class QdrantPoint:
    """Qdrant 검색 결과 단일 포인트 wrapper.

    SDK ``qdrant_client.models.ScoredPoint`` 와 호환되는 attribute access 제공
    (``point.score``, ``point.payload``, ``point.id``). 검색 결과 변환 함수
    (``point_to_search_result``) 가 SDK 객체 / raw dict 차이 없이 동작.
    """

    id: str | int
    score: float
    payload: dict[str, Any] | None
    vector: dict[str, Any] | list[float] | None = None
    version: int | None = None

    @classmethod
    def from_dict(cls, data: dict) -> QdrantPoint:
        return cls(
            id=data["id"],
            score=float(data.get("score", 0.0)),
            payload=data.get("payload"),
            vector=data.get("vector"),
            version=data.get("version"),
        )


@dataclass(frozen=True)
class FacetHit:
    """Qdrant facet API 결과 단일 항목.

    SDK ``qdrant_client.models.FacetValueHit`` 와 동등 (``hit.value``, ``hit.count``).
    """

    value: str | int | bool | None
    count: int

    @classmethod
    def from_dict(cls, data: dict) -> FacetHit:
        return cls(value=data.get("value"), count=int(data.get("count", 0)))


class RawQdrantClient:
    """Cloudflare Tunnel 환경 호환 Qdrant REST 클라이언트.

    qdrant-client SDK 의존성 없이 ``httpx.AsyncClient(http2=False)`` 로
    Qdrant REST API 직접 호출. cache/service.py PR #83 패턴을 일반화한 모듈.
    """

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout: httpx.Timeout | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """settings 또는 명시적 인자로 클라이언트 구성.

        Args:
            base_url: Qdrant REST URL. None 이면 ``settings.qdrant_url`` 사용.
            api_key: Qdrant API key. None 이면 ``settings.qdrant_api_key`` 사용.
            timeout: httpx.Timeout. None 이면 기본값(15s/5s connect).
            transport: 테스트용 ``httpx.MockTransport`` 주입. 프로덕션에서는 None.
        """
        self._base = (base_url or settings.qdrant_url).rstrip("/")
        if api_key is not None:
            self._api_key = api_key
        elif settings.qdrant_api_key:
            self._api_key = settings.qdrant_api_key.get_secret_value()
        else:
            self._api_key = ""
        self._timeout = timeout or _DEFAULT_TIMEOUT
        self._transport = transport

    @property
    def _headers(self) -> dict[str, str]:
        return {"api-key": self._api_key, "Content-Type": "application/json"}

    def _client(self) -> httpx.AsyncClient:
        kwargs: dict = {"http2": False, "timeout": self._timeout}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(**kwargs)

    # ---- 내부 헬퍼 ----------------------------------------------------------

    async def _post(self, path: str, body: dict) -> dict:
        async with self._client() as client:
            resp = await client.post(
                f"{self._base}{path}", headers=self._headers, json=body
            )
            resp.raise_for_status()
            return resp.json()

    async def _put(self, path: str, body: dict) -> dict:
        async with self._client() as client:
            resp = await client.put(
                f"{self._base}{path}", headers=self._headers, json=body
            )
            resp.raise_for_status()
            return resp.json()

    # ---- search ----------------------------------------------------------

    async def query_points(
        self,
        collection_name: str,
        *,
        query: list[float] | dict | None = None,
        using: str | None = None,
        prefetch: list[dict] | None = None,
        query_filter: dict | None = None,
        score_threshold: float | None = None,
        limit: int = 10,
        with_payload: bool = True,
        with_vectors: bool = False,
    ) -> list[QdrantPoint]:
        """Qdrant ``POST /collections/{name}/points/query`` 호출.

        Args:
            collection_name: 컬렉션명.
            query: 단일 검색 벡터(list) 또는 fusion 객체(dict). prefetch 와
                함께 사용 시 fusion(예: ``{"fusion": "rrf"}``) 전달.
            using: 단일 vector 검색 시 vector 이름 (예: ``"dense"``). prefetch
                기반 fusion 검색 시에는 None.
            prefetch: ``Prefetch`` dict 리스트. dense + sparse fusion 검색용.
            query_filter: ``Filter`` dict (``filters.build_filter`` 결과).
            score_threshold: 이 점수 미만 결과 제외.
            limit: 반환 결과 수.
            with_payload: payload 포함 여부.
            with_vectors: vector 포함 여부.

        Returns:
            점수 내림차순 ``QdrantPoint`` 리스트.

        Raises:
            httpx.HTTPStatusError: 4xx/5xx 응답.
            httpx.TimeoutException: 타임아웃.
        """
        body: dict = {
            "limit": limit,
            "with_payload": with_payload,
            "with_vector": with_vectors,
        }
        if query is not None:
            body["query"] = query
        if using is not None:
            body["using"] = using
        if prefetch is not None:
            body["prefetch"] = prefetch
        if query_filter is not None:
            body["filter"] = query_filter
        if score_threshold is not None:
            body["score_threshold"] = score_threshold

        result = await self._post(
            f"/collections/{collection_name}/points/query", body
        )
        points = result.get("result", {}).get("points", [])
        return [QdrantPoint.from_dict(p) for p in points]

    async def query_batch_points(
        self,
        collection_name: str,
        searches: list[dict],
    ) -> list[list[QdrantPoint]]:
        """Qdrant ``POST /collections/{name}/points/query/batch``. 검색 N건 배치 실행.

        Args:
            collection_name: 컬렉션명.
            searches: 각 검색 요청 body 리스트 (query_points 와 동일 형식).

        Returns:
            각 검색별 ``QdrantPoint`` 리스트의 리스트.
        """
        result = await self._post(
            f"/collections/{collection_name}/points/query/batch",
            {"searches": searches},
        )
        batches = result.get("result", [])
        return [
            [QdrantPoint.from_dict(p) for p in batch.get("points", [])]
            for batch in batches
        ]

    # ---- write -----------------------------------------------------------

    async def upsert(
        self,
        collection_name: str,
        points: list[dict],
        *,
        wait: bool = True,
    ) -> dict:
        """Qdrant ``PUT /collections/{name}/points``. point 업서트.

        Args:
            collection_name: 컬렉션명.
            points: ``{"id": ..., "vector": ..., "payload": ...}`` 리스트.
            wait: 동기 처리 대기 여부 (기본 True).

        Returns:
            응답 ``result`` dict (예: ``{"operation_id": ..., "status": "completed"}``).
        """
        path = f"/collections/{collection_name}/points"
        if wait:
            path += "?wait=true"
        result = await self._put(path, {"points": points})
        return result.get("result", {})

    # ---- admin scroll / facet / set_payload / delete --------------------

    async def scroll(
        self,
        collection_name: str,
        *,
        scroll_filter: dict | None = None,
        with_payload: bool | list[str] = True,
        with_vectors: bool = False,
        limit: int = 1000,
        offset: str | int | None = None,
    ) -> tuple[list[QdrantPoint], str | int | None]:
        """Qdrant ``POST /collections/{name}/points/scroll``. 페이징 조회.

        SDK ``async_client.scroll(collection_name=, scroll_filter=, ...)`` 와
        동등한 시그니처. ``next_offset`` 이 ``None`` 이면 페이지 끝.

        Returns:
            (``QdrantPoint`` 리스트, 다음 offset).
        """
        body: dict = {
            "limit": limit,
            "with_payload": with_payload,
            "with_vector": with_vectors,
        }
        if scroll_filter is not None:
            body["filter"] = scroll_filter
        if offset is not None:
            body["offset"] = offset

        result = await self._post(
            f"/collections/{collection_name}/points/scroll", body
        )
        data = result.get("result", {})
        points = [QdrantPoint.from_dict(p) for p in data.get("points", [])]
        next_offset = data.get("next_page_offset")
        return points, next_offset

    async def retrieve(
        self,
        collection_name: str,
        *,
        ids: list[str | int],
        with_payload: bool | list[str] = True,
        with_vectors: bool = False,
    ) -> list[QdrantPoint]:
        """Qdrant ``POST /collections/{name}/points``. ID 리스트로 다수 포인트 조회.

        SDK ``async_client.retrieve(collection_name=, ids=, ...)`` 와 동등.
        ``score`` 는 검색 결과가 아니므로 응답에 없음 — ``QdrantPoint.from_dict``
        가 0.0 으로 fallback 처리.
        """
        body: dict = {
            "ids": ids,
            "with_payload": with_payload,
            "with_vector": with_vectors,
        }
        result = await self._post(
            f"/collections/{collection_name}/points", body
        )
        records = result.get("result", [])
        return [QdrantPoint.from_dict(r) for r in records]

    async def facet(
        self,
        collection_name: str,
        *,
        key: str,
        facet_filter: dict | None = None,
        limit: int = 100,
        exact: bool = False,
    ) -> list[FacetHit]:
        """Qdrant ``POST /collections/{name}/facet``. group-by + count 집계.

        SDK ``async_client.facet(collection_name=, key=, facet_filter=, ...)`` 와
        동등. ``hit.value`` / ``hit.count`` attribute access.
        """
        body: dict = {"key": key, "limit": limit, "exact": exact}
        if facet_filter is not None:
            body["filter"] = facet_filter

        result = await self._post(
            f"/collections/{collection_name}/facet", body
        )
        hits = result.get("result", {}).get("hits", [])
        return [FacetHit.from_dict(h) for h in hits]

    async def set_payload(
        self,
        collection_name: str,
        *,
        payload: dict,
        points: list[str | int],
        wait: bool = True,
    ) -> dict:
        """Qdrant ``POST /collections/{name}/points/payload``. payload 부분 갱신.

        SDK ``async_client.set_payload(collection_name=, payload=, points=)`` 동등.
        """
        path = f"/collections/{collection_name}/points/payload"
        if wait:
            path += "?wait=true"
        result = await self._post(path, {"payload": payload, "points": points})
        return result.get("result", {})

    async def delete(
        self,
        collection_name: str,
        *,
        points_selector: dict | list[str | int],
        wait: bool = True,
    ) -> dict:
        """Qdrant ``POST /collections/{name}/points/delete``. 포인트 삭제.

        ``points_selector`` 는 ID 리스트 또는 ``filter`` dict.
        SDK ``async_client.delete(collection_name=, points_selector=)`` 동등.
        """
        path = f"/collections/{collection_name}/points/delete"
        if wait:
            path += "?wait=true"
        if isinstance(points_selector, list):
            body: dict = {"points": points_selector}
        else:
            body = {"filter": points_selector}
        result = await self._post(path, body)
        return result.get("result", {})

    async def count(
        self,
        collection_name: str,
        *,
        count_filter: dict | None = None,
        exact: bool = True,
    ) -> int:
        """Qdrant ``POST /collections/{name}/points/count``. 포인트 카운트.

        SDK ``async_client.count(collection_name=)`` 와 동등. ``exact=True`` 시
        정확 카운트(느림), ``False`` 시 추정.
        """
        body: dict = {"exact": exact}
        if count_filter is not None:
            body["filter"] = count_filter
        result = await self._post(
            f"/collections/{collection_name}/points/count", body
        )
        return int(result.get("result", {}).get("count", 0))

    # ---- collection mgmt -------------------------------------------------

    async def collection_exists(self, collection_name: str) -> bool:
        """컬렉션 존재 여부 확인 (``GET /collections``)."""
        async with self._client() as client:
            resp = await client.get(
                f"{self._base}/collections", headers=self._headers
            )
            resp.raise_for_status()
            existing = resp.json().get("result", {}).get("collections", [])
            return any(c.get("name") == collection_name for c in existing)
