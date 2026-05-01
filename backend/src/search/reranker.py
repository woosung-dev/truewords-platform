"""Gemini Flash JSON 기반 Reranker.

검색된 chunk 들에 대해 Gemini Flash 가 JSON 형식으로 0.0~1.0 score 를 매기고,
점수 내림차순으로 재정렬하여 top_k 반환. JSON 파싱 / API 실패 시 graceful
degradation (원본 결과 그대로 반환).

운영 default = gemini-flash-lite-preview (`MODEL_GENERATE`).
ADR 2026-05-01 결정으로 cross-encoder 대체 후보들 모두 임계 미달, 본 단일
구현 유지.
"""
from __future__ import annotations

import json
import logging

from src.common.gemini import generate_text
from src.search.hybrid import SearchResult

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
    passages = [
        f"[문단 {i+1}] (출처: {r.volume})\n{r.text}"
        for i, r in enumerate(results)
    ]
    passages_text = "\n\n".join(passages)
    return f"질문: {query}\n\n검색된 문단들:\n{passages_text}"


def _parse_scores(response_text: str, expected_count: int) -> list[float] | None:
    """Gemini 응답에서 점수 리스트 파싱.

    부분 응답 허용: got < expected 면 부족분에 중립값 0.5 fill (PR 7 fix).
    완전 누락 / JSON 파싱 실패 / 더 많은 score → None 반환 (graceful degradation).
    """
    try:
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text
            text = text.rsplit("```", 1)[0].strip()

        data = json.loads(text)
        scores = data.get("scores", [])
        if not isinstance(scores, list) or not scores:
            logger.warning("Rerank scores 빈 배열")
            return None
        if len(scores) > expected_count:
            logger.warning(
                "Rerank 점수 과잉: expected=%d, got=%d (overflow → fallback)",
                expected_count, len(scores),
            )
            return None
        if len(scores) < expected_count:
            logger.info(
                "Rerank 점수 부족: expected=%d, got=%d (부족분 0.5 fill)",
                expected_count, len(scores),
            )
            scores = list(scores) + [0.5] * (expected_count - len(scores))
        return [float(s) for s in scores]
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
        logger.warning("Rerank JSON 파싱 실패: %s", e)
        return None


async def rerank(
    query: str,
    results: list[SearchResult],
    top_k: int = 10,
) -> list[SearchResult]:
    """Gemini Flash 기반 reranker. 파싱/API 실패 시 graceful degradation."""
    if not results:
        return []

    try:
        prompt = _build_rerank_prompt(query, results)
        response_text = await generate_text(
            prompt, system_instruction=RERANK_SYSTEM_PROMPT,
        )
        scores = _parse_scores(response_text, len(results))

        if scores is None:
            logger.warning("Rerank 파싱 실패, 원본 결과 반환")
            return results[:top_k]

        reranked = [
            SearchResult(
                text=r.text,
                volume=r.volume,
                chunk_index=r.chunk_index,
                score=r.score,
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

    except Exception:
        logger.exception("Rerank 실패, 원본 결과 반환")
        return results[:top_k]
