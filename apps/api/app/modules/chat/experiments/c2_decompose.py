"""C2 (Azure agentic retrieval 식) — 질의 분해 → 병렬 검색 → 앱 수준 RRF. 기본 꺼짐.

흐름
1. 분해 계획(LLM 1회, 2.5초 상한)과 원 질의 검색(운영 SearchStage 그대로, 50건)을 동시에 돌린다.
2. 하위 질의마다 같은 봇 설정(소스·가중치·임계값)으로 검색한다(각 30건, 동시에).
3. [원 질의 50, 하위 질의 30, ...] 순위 목록을 RRF(k=60)로 합친다. 하위 질의마다 상위 5건은
   먼저 자리를 잡고, 남은 자리를 점수순으로 채워 50건에서 자른다.

계획이 실패하면(시간 초과·호출 오류·파싱 실패·하위 질의 2개 미만) 이미 돌린 원 질의 검색 결과를
그대로 돌려준다. 현행 경로와 같은 결과이고, 검색을 두 번 하지 않는다(record 의 fallback=True).

하위 질의 검색은 trace 수집기를 끄고 돌린다. 후보 표(tier·병합·디버그 조회)는 원 질의 검색
기록으로만 만들고, 하위 질의 검색은 `c2.sub_search` span 하나씩만 남긴다.
rerank 는 원 질문(ctx.request.query)으로 그대로 한다 — 이 모듈은 질문을 바꾸지 않는다.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import replace
from time import perf_counter
from typing import Any

from app.core.common.gemini import MODEL_GENERATE, generate_text
from app.modules.chat.pipeline.context import ChatContext
from app.modules.chat.pipeline.stages.search import SearchStage, _to_search_config
from app.modules.chat.trace import current_trace, error_text, trace_span
from app.modules.qdrant import get_raw_client
from app.modules.search.cascading import CascadingConfig, cascading_search
from app.modules.search.hybrid import SearchResult
from app.modules.search.weighted import WeightedConfig, weighted_search

logger = logging.getLogger(__name__)

PLANNER_TIMEOUT_S = 2.5
# intent 별 하위 질의 최대 개수. 여기에 없는 intent 는 분해하지 않는다.
MAX_SUB_QUERIES: dict[str, int] = {"conceptual": 2, "reasoning": 3}
MIN_SUB_QUERIES = 2
SUB_TOP_K = 30
RRF_K = 60
GUARANTEE_PER_SUB = 5
MERGE_CAP = 50

PLANNER_SYSTEM_PROMPT = """당신은 말씀 자료 검색을 위한 질의 분해기입니다.
사용자 질문에 답하려면 따로 찾아봐야 하는 서로 다른 측면을 골라, 측면마다 검색 질의를 하나씩 만드세요.

규칙
- 하위 질의는 주어진 최대 개수를 넘기지 않습니다.
- 각 하위 질의는 원래 질문 없이도 뜻이 통하는 완결된 한국어 검색 질의입니다. "그것", "이것" 같은 지시어를 쓰지 않습니다.
- 하위 질의마다 다른 측면을 다룹니다. 예: 개념의 뜻, 근거·이유, 다른 개념과의 관계, 삶에서의 실천.
- 원래 질문을 말만 바꿔 되풀이하거나 하위 질의끼리 겹치게 쓰지 않습니다.
- 질문에 나온 핵심 용어는 그대로 쓰고, 질문에 없는 인명·권 번호·연도를 지어내지 않습니다.
- 나눌 측면이 하나뿐이면 빈 목록을 돌려줍니다.

반드시 JSON만 반환하세요: {"sub_queries": ["...", "..."]}"""

_PLAN_SPAN = "c2.plan"
_SUB_SPAN = "c2.sub_search"

Key = tuple[str, int]


def _ms(seconds: float) -> float:
    return round(seconds * 1000, 2)


def _norm(text: str) -> str:
    """공백 정규화 — 중복 판정과 검색에 같은 문자열을 쓴다."""
    return " ".join(text.split())


def _sub_queries_schema(max_n: int) -> dict:
    """JSON 모드 응답 스키마 — {"sub_queries": [string × 최대 max_n]} 만 허용한다."""
    return {
        "type": "OBJECT",
        "properties": {
            "sub_queries": {"type": "ARRAY", "items": {"type": "STRING"}, "max_items": max_n},
        },
        "required": ["sub_queries"],
    }


def _parse_sub_queries(text: str | None) -> list[str] | None:
    """응답 JSON 에서 문자열 하위 질의만 꺼낸다. 형식이 틀리면 None."""
    try:
        data = json.loads(text or "")
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("sub_queries"), list):
        return None
    return [q for q in data["sub_queries"] if isinstance(q, str)]


def _distinct(candidates: list[str], exclude: list[str]) -> list[str]:
    """빈 질의·원 질문과 같은 질의·서로 겹치는 질의를 뺀다(공백 정규화 후 비교)."""
    seen = {_norm(q) for q in exclude}
    out: list[str] = []
    for q in candidates:
        n = _norm(q)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


async def plan_sub_queries(
    query: str, intent: str, *, exclude: list[str] | None = None
) -> tuple[list[str], str]:
    """(하위 질의, 상태). 상태는 ok | timeout | error | parse_fail | too_few.

    ok 가 아니면 호출자는 분해하지 않는다. too_few 일 때도 남은 질의는 기록용으로 돌려준다.
    """
    max_n = MAX_SUB_QUERIES.get(intent, MIN_SUB_QUERIES)
    try:
        text = await asyncio.wait_for(
            generate_text(
                f"하위 질의 최대 개수: {max_n}\n\n질문: {query}",
                system_instruction=PLANNER_SYSTEM_PROMPT,
                model=MODEL_GENERATE,
                response_schema=_sub_queries_schema(max_n),
            ),
            timeout=PLANNER_TIMEOUT_S,
        )
    except TimeoutError:
        return [], "timeout"
    except Exception as exc:  # 429·네트워크 등 — 분해 없이 현행 경로로
        logger.warning("c2 planner 호출 실패 %s", type(exc).__name__)
        return [], "error"
    raw = _parse_sub_queries(text)
    if raw is None:
        return [], "parse_fail"
    subs = _distinct(raw, [query, *(exclude or [])])[:max_n]
    if len(subs) < MIN_SUB_QUERIES:
        return subs, "too_few"
    return subs, "ok"


def rrf_merge(
    ranked_lists: list[list[SearchResult]],
    *,
    k: int = RRF_K,
    guarantee: int = GUARANTEE_PER_SUB,
    cap: int = MERGE_CAP,
) -> list[SearchResult]:
    """앱 수준 RRF. ranked_lists[0] 은 원 질의, 나머지는 하위 질의 순위 목록이다.

    - 점수 = Σ 1/(k + 순위), 순위는 1부터. 같은 chunk(volume, chunk_index)는 한 목록 안에서
      처음 나온 순위만 센다.
    - 객체는 처음 본 것(원 질의 쪽 우선)을 그대로 쓰고 score 만 RRF 점수로 바꾼다.
    - 하위 질의 목록마다 상위 `guarantee` 건이 먼저 자리를 잡고, 남은 자리를 점수순으로 채운다.
    - 동점은 먼저 본 순서(원 질의 순위 → 하위 질의 순서)를 따른다.
    """
    scores: dict[Key, float] = {}
    first: dict[Key, SearchResult] = {}
    per_list: list[list[Key]] = []
    for results in ranked_lists:
        ranks: dict[Key, int] = {}  # 이 목록 안의 1부터 센 순위 (삽입 순서 = 순위 순서)
        for r in results:
            key = (r.volume, r.chunk_index)
            if key in ranks:
                continue
            ranks[key] = len(ranks) + 1
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + ranks[key])
            first.setdefault(key, r)
        per_list.append(list(ranks))

    order = sorted(scores, key=lambda key: scores[key], reverse=True)
    picked: set[Key] = set()
    for keys in per_list[1:]:
        picked.update(keys[:guarantee])
    for key in order:
        if len(picked) >= cap:
            break
        picked.add(key)
    return [replace(first[key], score=scores[key]) for key in order if key in picked]


async def _sub_search(
    query: str,
    config: WeightedConfig | CascadingConfig,
    *,
    collection_name: str | None,
    query_metadata: dict[str, int],
) -> list[SearchResult]:
    """하위 질의 1개 검색. 실패하면 빈 목록(다른 하위 질의는 계속)."""
    t = current_trace.get()
    started = perf_counter()
    error: Exception | None = None
    # 원 질의 검색 기록(tier·병합·hybrid 호출)을 덮지 않도록 이 task 안에서만 수집기를 끈다.
    token = current_trace.set(None)
    try:
        if isinstance(config, WeightedConfig):
            results = await weighted_search(
                get_raw_client(), query, config, top_k=SUB_TOP_K,
                collection_name=collection_name, query_metadata=query_metadata,
            )
        else:
            results = await cascading_search(
                get_raw_client(), query, config, top_k=SUB_TOP_K,
                collection_name=collection_name, query_metadata=query_metadata,
            )
    except Exception as exc:
        logger.warning("c2 하위 질의 검색 실패 %s", type(exc).__name__)
        error = exc
        results = []
    finally:
        current_trace.reset(token)
    if t is not None:
        t.add_span(
            _SUB_SPAN,
            "retrieval",
            started,
            status="error" if error is not None else "ok",
            input={"query": query},
            output={"n_results": len(results)},
            error=error_text(error) if error is not None else None,
        )
    return results


def _planner_llm() -> dict[str, Any] | None:
    """trace 가 남긴 planner LLM 호출의 모델·토큰 (수집기가 없으면 None)."""
    t = current_trace.get()
    if t is None:
        return None
    span = next(
        (s for s in t.spans if s.parent == _PLAN_SPAN and s.name == "gemini.generate_text"),
        None,
    )
    return dict(span.llm) if span is not None and span.llm else None


async def decomposed_search(
    ctx: ChatContext, search_stage: SearchStage
) -> tuple[list[SearchResult], dict[str, Any]] | None:
    """분해 검색 결과(최대 50)와 기록. None 이면 아무것도 하지 않았으니 호출자가 현행 검색을 쓴다.

    계획이 실패하면 원 질의 검색 결과(= 현행 경로 결과)와 fallback=True 기록을 돌려준다.
    """
    if ctx.runtime_config is None or ctx.intent not in MAX_SUB_QUERIES:
        return None
    started = perf_counter()
    query = ctx.search_query or ctx.request.query

    async def _plan() -> tuple[list[str], str, float]:
        async with trace_span(_PLAN_SPAN, "llm", input={"query": query}) as span:
            t0 = perf_counter()
            subs, status = await plan_sub_queries(query, ctx.intent, exclude=[ctx.request.query])
            if span is not None:
                span.output = {"status": status, "sub_queries": subs}
                if status in ("timeout", "error"):
                    span.status = status
            return subs, status, _ms(perf_counter() - t0)

    plan_task = asyncio.create_task(_plan())
    try:
        await search_stage.execute(ctx)  # ctx.results = 원 질의 상위 50 (운영과 같다)
    except BaseException:
        plan_task.cancel()
        raise
    sub_queries, status, planner_ms = await plan_task
    original = list(ctx.results)
    record: dict[str, Any] = {
        "sub_queries": sub_queries,
        "planner_status": status,
        "planner_ms": planner_ms,
        "llm": _planner_llm(),
    }
    if status != "ok":
        record.update(fallback=True, total_ms=_ms(perf_counter() - started))
        return original, record

    config = _to_search_config(ctx.runtime_config.search, search_stage.default_tiers)
    sub_lists = await asyncio.gather(
        *[
            _sub_search(
                q,
                config,
                collection_name=ctx.resolved_collections.main if ctx.resolved_collections else None,
                query_metadata=ctx.query_metadata,
            )
            for q in sub_queries
        ]
    )
    merged = rrf_merge([original, *sub_lists])
    original_keys = {(r.volume, r.chunk_index) for r in original}
    record.update(
        fallback=False,
        n_original=len(original),
        sub_counts=[len(results) for results in sub_lists],
        n_merged=len(merged),
        n_from_subqueries_only=sum(
            1 for r in merged if (r.volume, r.chunk_index) not in original_keys
        ),
        total_ms=_ms(perf_counter() - started),
    )
    return merged, record
