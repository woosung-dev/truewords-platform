"""RAG trace 수집기 — 관리자 플레이그라운드(`POST /admin/rag-trace`) 전용.

운영 함수의 시그니처를 바꾸지 않고 내부 정보(단계별 지연·후보·점수·LLM 토큰)를
모으기 위해 ``ContextVar`` 수집기 하나를 둔다.

규칙
- 운영 ``ChatService`` 는 ``current_trace`` 를 설정하지 않는다. 그래서 훅 비용은
  ``current_trace.get()`` 1회뿐이다. 모든 훅은 ``t = current_trace.get()`` 다음
  ``if t is not None:`` 안에서만 일한다(꺼져 있으면 dict 도 만들지 않는다).
- ``run_in_executor`` 는 context 를 전파하지 않는다. executor 안에는 훅을 두지
  않는다. sparse 임베딩은 ``embed_sparse_async`` 를 await 하는 호출부에서 잰다.
- ``asyncio.gather``/``wait_for`` 가 만드는 task 는 context 사본을 받는다. 수집기
  객체는 같은 것을 가리키므로 하위 task 의 기록도 한곳에 모인다.
- 이 모듈은 다른 앱 모듈을 import 하지 않는다(core.common.gemini 가 import 한다).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter
from typing import Any

# input/output dict 의 문자열 값 상한, 리스트 길이 상한, error 문자열 상한.
MAX_VALUE_CHARS = 500
MAX_LIST_ITEMS = 50
MAX_ERROR_CHARS = 200
# 예산 초과 시 이 시간 안에 취소된 span 을 timeout 으로 본다.
_TIMEOUT_MARK_WINDOW_S = 0.05

current_trace: ContextVar[TraceCollector | None] = ContextVar("current_trace", default=None)
# 지금 실행 중인 stage 이름 — Gemini 하위 호출 span 의 parent 로 쓴다.
_current_stage: ContextVar[str | None] = ContextVar("rag_trace_current_stage", default=None)


def clip(value: Any) -> Any:
    """trace input/output 값을 응답에 싣기 좋게 자른다(문자열 500자, 리스트 50개)."""
    if isinstance(value, str):
        return value if len(value) <= MAX_VALUE_CHARS else value[:MAX_VALUE_CHARS] + "…"
    if isinstance(value, dict):
        return {str(k): clip(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clip(v) for v in list(value)[:MAX_LIST_ITEMS]]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return clip(str(value))


def _error_text(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:MAX_ERROR_CHARS]


@dataclass
class SpanRecord:
    name: str
    kind: str
    start: float
    end: float | None = None
    status: str = "ok"
    parent: str | None = None
    parallel_group: str | None = None
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)
    llm: dict[str, Any] | None = None
    ttft_ms: float | None = None
    error: str | None = None


@dataclass
class HybridCall:
    """hybrid_search 1회 호출 — 디버그 조회(같은 필터 dense/sparse 50)의 재료."""

    collection: str
    source_filter: list[str] | None
    query_filter: dict | None
    prefetch_limit: int
    dense: list[float]
    sparse: tuple[list[int], list[float]]
    results: list[Any]  # list[SearchResult] — 순환 import 회피로 Any


@dataclass
class TierRecord:
    """cascading tier / weighted source / fallback relaxed 1개의 검색 결과."""

    mode: str  # cascading | weighted | fallback_relaxed
    tier_idx: int
    sources: list[str] | None
    threshold: float
    results: list[Any]  # fused 결과(threshold 적용 전) list[SearchResult]
    min_results: int | None = None
    weight: float | None = None
    stopped_here: bool = False
    error: str | None = None


@dataclass
class RerankRecord:
    query: str
    inputs: list[Any]  # list[SearchResult] — rerank 입력 순서
    scores: list[float] | None
    status: str  # ok | parse_fail | api_fail
    top_k: int


class TraceCollector:
    """요청 1건의 trace. 플레이그라운드 서비스만 만든다."""

    def __init__(self) -> None:
        self.t0 = perf_counter()
        self.spans: list[SpanRecord] = []
        self.events: list[dict[str, Any]] = []
        self.hybrid_calls: list[HybridCall] = []
        self.tiers: list[TierRecord] = []
        # cascading 설정 전체 (sources, min_results) — tier_not_reached 판정용.
        self.tier_plan: list[tuple[list[str], int]] = []
        # 병합 후 [:top_k] 자르기 전 목록과 top_k.
        self.merged: list[Any] | None = None
        self.merge_top_k: int | None = None
        self.fallback: TierRecord | None = None
        self.rerank: RerankRecord | None = None
        # 디버그 조회용 질의 벡터 (collection, dense, sparse). 첫 기록을 유지한다.
        self.query_vectors: tuple[str, list[float], tuple[list[int], list[float]]] | None = None

    # ---- span ---------------------------------------------------------------

    def ms(self, t: float) -> float:
        return round((t - self.t0) * 1000, 2)

    def add_span(
        self,
        name: str,
        kind: str,
        start: float,
        *,
        status: str = "ok",
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
        llm: dict[str, Any] | None = None,
        error: str | None = None,
    ) -> SpanRecord:
        """이미 끝난 하위 호출을 span 으로 남긴다. parent 는 현재 stage."""
        span = SpanRecord(
            name=name,
            kind=kind,
            start=start,
            end=perf_counter(),
            status=status,
            parent=_current_stage.get(),
            input=clip(input or {}),
            output=clip(output or {}),
            llm=llm,
            error=error,
        )
        self.spans.append(span)
        return span

    def event(self, name: str, **attrs: Any) -> None:
        self.events.append({"name": name, "stage": _current_stage.get(), **clip(attrs)})

    def record_llm(
        self,
        name: str,
        model: str,
        start: float,
        usage: Any = None,
        *,
        error: BaseException | None = None,
    ) -> None:
        """Gemini 호출 1회. usage 는 SDK usage_metadata(없으면 None)."""
        llm: dict[str, Any] = {
            "model": model,
            "input_tokens": getattr(usage, "prompt_token_count", None) if usage else None,
            "output_tokens": getattr(usage, "candidates_token_count", None) if usage else None,
        }
        status = "ok"
        # GeneratorExit: 소비자가 스트림을 중간에 닫음(sanitizer abort 등).
        if isinstance(error, (asyncio.CancelledError, GeneratorExit)):
            status = "cancelled"
        elif error is not None:
            status = "error"
        self.add_span(
            name,
            "llm" if "embed" not in name else "embedding",
            start,
            status=status,
            llm=llm,
            error=_error_text(error) if error is not None else None,
        )

    # ---- 검색 훅 --------------------------------------------------------------

    def record_hybrid(self, call: HybridCall, start: float) -> None:
        self.hybrid_calls.append(call)
        if self.query_vectors is None:
            self.query_vectors = (call.collection, call.dense, call.sparse)
        self.add_span(
            "qdrant.hybrid_query",
            "retrieval",
            start,
            input={"source_filter": call.source_filter, "query_filter": call.query_filter},
            output={"n_results": len(call.results)},
        )

    def record_tier(self, tier: TierRecord) -> None:
        self.tiers.append(tier)

    def record_merge(self, merged: list[Any], top_k: int) -> None:
        self.merged = list(merged)
        self.merge_top_k = top_k

    def record_fallback(
        self,
        *,
        collection: str,
        dense: list[float],
        sparse: tuple[list[int], list[float]],
        results: list[Any],
        threshold: float,
    ) -> None:
        if self.query_vectors is None:
            self.query_vectors = (collection, dense, sparse)
        self.fallback = TierRecord(
            mode="fallback_relaxed",
            tier_idx=len(self.tiers),
            sources=None,
            threshold=threshold,
            results=list(results),
        )

    def record_rerank(self, rec: RerankRecord) -> None:
        self.rerank = rec

    # ---- 시간 초과 표시 ---------------------------------------------------------

    def mark_timeout(self) -> None:
        """예산 초과 — 끝나지 않았거나 취소된 span 을 timeout 으로 바꾼다."""
        now = perf_counter()
        for span in self.spans:
            if span.end is None:
                span.end = now
                span.status = "timeout"
            # 예산 초과 직전에 취소된 span 만 바꾼다. wait_for 가 일찍 끊은
            # 호출(예: closing 0.5s 초과)은 cancelled 그대로 둔다.
            elif span.status == "cancelled" and now - span.end < _TIMEOUT_MARK_WINDOW_S:
                span.status = "timeout"


@asynccontextmanager
async def trace_span(
    name: str,
    kind: str = "stage",
    *,
    parallel_group: str | None = None,
    input: dict[str, Any] | None = None,
) -> AsyncIterator[SpanRecord | None]:
    """stage 1개를 span 으로 잰다. 수집기가 없으면 None 을 내고 아무것도 하지 않는다.

    플레이그라운드 서비스에서만 쓴다(운영 경로에는 두지 않는다).
    """
    t = current_trace.get()
    if t is None:
        yield None
        return
    span = SpanRecord(
        name=name,
        kind=kind,
        start=perf_counter(),
        parent=_current_stage.get(),
        parallel_group=parallel_group,
        input=clip(input or {}),
    )
    t.spans.append(span)
    token = _current_stage.set(name)
    try:
        yield span
    except asyncio.CancelledError:
        span.status = "cancelled"
        raise
    except BaseException as exc:
        span.status = "error"
        span.error = _error_text(exc)
        raise
    finally:
        _current_stage.reset(token)
        span.end = perf_counter()
