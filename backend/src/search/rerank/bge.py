"""BGE cross-encoder reranker 어댑터.

HuggingFace ``sentence_transformers.CrossEncoder`` 기반. 첫 호출 시 모델 lazy load,
이후 인스턴스 재사용. 모델 로드/추론은 blocking → asyncio.to_thread 로 분리.

PR 4 시점에서는 등록만 — 실제 측정은 PR 7, default 변경은 PR 8 에서.
"""

from __future__ import annotations

import asyncio
import logging
import threading

from sentence_transformers import CrossEncoder

from src.search.hybrid import SearchResult

logger = logging.getLogger(__name__)


class BGEReranker:
    """Cross-encoder 기반 reranker. 모델 로드/predict 모두 lazy + thread-offload."""

    def __init__(self, *, model_name: str, registry_key: str) -> None:
        self.name = registry_key
        self._model_name = model_name
        self._model: CrossEncoder | None = None
        # asyncio.to_thread 는 thread pool worker 에서 실행되므로 동시 첫호출 시
        # _ensure_loaded() 가 병렬로 들어와 ~1GB 모델 중복 init 가능. threading.Lock
        # + double-check 으로 방지 (asyncio.Lock 은 같은 event loop 안에서만 유효).
        self._load_lock = threading.Lock()

    def _ensure_loaded(self) -> CrossEncoder:
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is None:  # double-check
                logger.info("loading_bge_reranker", extra={"model": self._model_name})
                self._model = CrossEncoder(self._model_name, max_length=512)
        return self._model

    async def rerank(
        self,
        query: str,
        results: list[SearchResult],
        top_k: int = 10,
    ) -> list[SearchResult]:
        if not results:
            return []

        try:
            model = await asyncio.to_thread(self._ensure_loaded)
            pairs = [(query, r.text) for r in results]
            scores = await asyncio.to_thread(model.predict, pairs)
        except Exception as exc:  # graceful degradation
            # 3rd-party tokenizer/model 예외 메시지가 사용자 query 를 echo 할 수 있어
            # str(exc) 직접 로깅 X. type 만 기록 — production log PII 누출 방지.
            logger.warning(
                "bge_rerank_failed",
                extra={"model": self._model_name, "error_type": type(exc).__name__},
            )
            # gemini.py 패턴 일관성 — graceful 시에도 top_k 슬라이싱
            return results[:top_k]

        reranked = [
            SearchResult(
                text=r.text,
                volume=r.volume,
                chunk_index=r.chunk_index,
                score=r.score,
                source=r.source,
                rerank_score=float(s),
                parent_text=r.parent_text,
                parent_chunk_index=r.parent_chunk_index,
                chunk_id=r.chunk_id,
            )
            for r, s in zip(results, scores, strict=True)
        ]
        reranked.sort(key=lambda r: r.rerank_score or 0.0, reverse=True)
        return reranked[:top_k]
