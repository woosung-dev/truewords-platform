"""FastAPI 라우트 평탄화 헬퍼 (테스트 전용).

FastAPI 0.140+ 는 ``include_router`` 결과를 ``app.routes`` 에 ``_IncludedRouter`` 로 남긴다.
포함된 라우트는 ``original_router.routes`` 에, ``include_router(dependencies=[...])`` 로 준 라우터
단위 의존성은 ``include_context.dependencies`` 에 있다(0.135 까지는 APIRoute 로 평탄화되어
``route.dependant.dependencies`` 에 들어 있었다). 게이트·CSRF 배선을 검사하는 테스트는 이 헬퍼로
``(APIRoute, 상속 Depends 목록)`` 을 순회한다. 두 버전 모두에서 동작한다.

pytest 가 ``tests/`` 를 sys.path 에 앉히므로 ``from route_helpers import ...`` 로 가져온다
(``tests`` 패키지 이름은 site-packages 의 동명 패키지와 충돌할 수 있다).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any


def _child_routes(item: Any) -> list[Any]:
    for holder in (item, getattr(item, "original_router", None), getattr(item, "router", None)):
        routes = getattr(holder, "routes", None) if holder is not None else None
        if routes:
            return list(routes)
    return []


def _own_dependencies(item: Any) -> list[Any]:
    include_context = getattr(item, "include_context", None)
    if include_context is not None:
        return list(getattr(include_context, "dependencies", None) or [])
    return list(getattr(item, "dependencies", None) or [])


def iter_api_routes(app: Any) -> Iterator[tuple[Any, list[Any]]]:
    """``(route, inherited_dependencies)`` 를 낸다. inherited 는 include_router 가 준 Depends 목록."""

    def walk(routes: list[Any], inherited: list[Any]) -> Iterator[tuple[Any, list[Any]]]:
        for item in routes:
            if hasattr(item, "endpoint"):
                yield item, inherited
                continue
            children = _child_routes(item)
            if children:
                yield from walk(children, inherited + _own_dependencies(item))

    yield from walk(list(app.routes), [])


def dependency_callables(route: Any, inherited: list[Any]) -> set[Any]:
    """route 에 실제로 적용되는 의존성 callable 집합 (라우터 상속 + route 자체 + dependant)."""
    calls: set[Any] = set()
    for dep in inherited:
        calls.add(getattr(dep, "dependency", dep))
    for dep in getattr(route, "dependencies", None) or []:
        calls.add(getattr(dep, "dependency", dep))
    dependant = getattr(route, "dependant", None)
    for sub in getattr(dependant, "dependencies", None) or []:
        calls.add(getattr(sub, "call", None))
    calls.discard(None)
    return calls
