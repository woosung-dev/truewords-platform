"""Gemini LLM 기반 Re-ranking. 검색 결과의 관련성을 재평가하여 정밀 재순위."""

import json
import logging

from app.core.common.gemini import generate_text
from app.modules.chat.trace import RerankRecord, current_trace
from app.modules.search.hybrid import SearchResult

logger = logging.getLogger(__name__)

RERANK_SYSTEM_PROMPT = """당신은 검색 결과 관련성 평가기입니다.
사용자 질문과 검색된 문단들이 주어집니다.
각 문단이 질문에 얼마나 관련 있는지 0.0~1.0 사이 점수를 매기세요.
- 1.0: 질문에 직접적으로 답하는 내용
- 0.7~0.9: 매우 관련 있는 내용
- 0.4~0.6: 부분적으로 관련
- 0.1~0.3: 약간 관련
- 0.0: 전혀 무관

반드시 JSON만 반환하세요: {"scores": [0.8, 0.3, ...]}
문단 수와 점수 수가 일치해야 합니다."""


def _build_rerank_prompt(query: str, results: list[SearchResult]) -> str:
    """Re-ranking용 프롬프트 구성."""
    passages = []
    for i, r in enumerate(results):
        passages.append(f"[문단 {i+1}] (출처: {r.volume})\n{r.text}")
    passages_text = "\n\n".join(passages)
    return f"질문: {query}\n\n검색된 문단들:\n{passages_text}"


def _scores_schema(expected_count: int) -> dict:
    """JSON 모드 응답 스키마 — {"scores": [number × 문단 수]} 만 허용한다."""
    return {
        "type": "OBJECT",
        "properties": {
            "scores": {
                "type": "ARRAY",
                "items": {"type": "NUMBER"},
                "min_items": expected_count,
                "max_items": expected_count,
            },
        },
        "required": ["scores"],
    }


def _parse_scores(response_text: str | None, expected_count: int) -> list[float] | None:
    """Gemini 응답에서 점수 리스트 파싱. 실패 시 None 반환."""
    try:
        # JSON 블록에서 추출 (```json ... ``` 래핑 대응)
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text
            text = text.rsplit("```", 1)[0].strip()

        data = json.loads(text)
        # 점수 배열만 오는 등 dict 가 아닌 JSON 도 파싱 실패다(호출 실패로 새지 않게).
        if not isinstance(data, dict):
            logger.warning("Rerank 응답이 객체가 아님: %s", type(data).__name__)
            return None
        scores = data.get("scores", [])
        if len(scores) != expected_count:
            logger.warning(
                "Rerank 점수 개수 불일치: expected=%d, got=%d",
                expected_count, len(scores),
            )
            return None
        return [float(s) for s in scores]
    except (json.JSONDecodeError, AttributeError, KeyError, TypeError, ValueError) as e:
        logger.warning("Rerank JSON 파싱 실패: %s", e)
        return None


async def rerank(
    query: str,
    results: list[SearchResult],
    top_k: int = 10,
) -> list[SearchResult]:
    """Gemini LLM으로 검색 결과 재순위. 실패 시 원본 결과 반환 (graceful degradation)."""
    if not results:
        return []

    # rag-trace 훅 — 수집기가 없으면 아래 `if t is not None` 블록은 모두 건너뛴다.
    t = current_trace.get()
    try:
        prompt = _build_rerank_prompt(query, results)
        response_text = await generate_text(
            prompt,
            system_instruction=RERANK_SYSTEM_PROMPT,
            response_schema=_scores_schema(len(results)),
        )
    except Exception:
        # API 실패(429·timeout 등) → graceful degradation
        logger.exception("Rerank 호출 실패, 원본 결과 반환")
        if t is not None:
            t.record_rerank(RerankRecord(query, list(results), None, "api_fail", top_k))
        return results[:top_k]

    scores = _parse_scores(response_text, len(results))
    if scores is None:
        # 파싱 실패 → 원본 반환
        logger.warning("Rerank 파싱 실패, 원본 결과 반환")
        if t is not None:
            t.record_rerank(RerankRecord(query, list(results), None, "parse_fail", top_k))
        return results[:top_k]

    if t is not None:
        t.record_rerank(RerankRecord(query, list(results), list(scores), "ok", top_k))

    # rerank_score 부여 + 정렬. parent_*/chunk_id 등 메타데이터는 원본에서 그대로 carry.
    reranked = [
        SearchResult(
            text=r.text,
            volume=r.volume,
            chunk_index=r.chunk_index,
            score=r.score,  # 원본 retrieval score 유지
            source=r.source,
            rerank_score=s,
            parent_text=r.parent_text,
            parent_chunk_index=r.parent_chunk_index,
            chunk_id=r.chunk_id,
        )
        for r, s in zip(results, scores)
    ]
    reranked.sort(key=lambda r: r.rerank_score or 0.0, reverse=True)
    return reranked[:top_k]
