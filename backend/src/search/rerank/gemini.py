"""Gemini Flash JSON 기반 Reranker 어댑터.

기존 backend/src/search/reranker.py 의 로직을 그대로 이전.
파이프라인 동작은 비트 단위로 동일해야 한다.
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
    """Re-ranking용 프롬프트 구성."""
    passages = []
    for i, r in enumerate(results):
        passages.append(f"[문단 {i+1}] (출처: {r.volume})\n{r.text}")
    passages_text = "\n\n".join(passages)
    return f"질문: {query}\n\n검색된 문단들:\n{passages_text}"


def _parse_scores(response_text: str, expected_count: int) -> list[float] | None:
    """Gemini 응답에서 점수 리스트 파싱. 실패 시 None 반환."""
    try:
        # JSON 블록 추출 (```json ... ``` 래핑 대응)
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text
            text = text.rsplit("```", 1)[0].strip()

        data = json.loads(text)
        scores = data.get("scores", [])
        if len(scores) != expected_count:
            logger.warning(
                "Rerank 점수 개수 불일치: expected=%d, got=%d",
                expected_count, len(scores),
            )
            return None
        return [float(s) for s in scores]
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as e:
        logger.warning("Rerank JSON 파싱 실패: %s", e)
        return None


class GeminiReranker:
    """Gemini Flash JSON 평가 기반 reranker. 파싱/API 실패 시 graceful degradation."""

    name = "gemini-flash"

    async def rerank(
        self,
        query: str,
        results: list[SearchResult],
        top_k: int = 10,
    ) -> list[SearchResult]:
        if not results:
            return []

        try:
            prompt = _build_rerank_prompt(query, results)
            response_text = await generate_text(
                prompt, system_instruction=RERANK_SYSTEM_PROMPT,
            )
            scores = _parse_scores(response_text, len(results))

            if scores is None:
                # 파싱 실패 → 원본 반환
                logger.warning("Rerank 파싱 실패, 원본 결과 반환")
                return results[:top_k]

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

        except Exception:
            # API 실패 등 → graceful degradation
            logger.exception("Rerank 실패, 원본 결과 반환")
            return results[:top_k]
