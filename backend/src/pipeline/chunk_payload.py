"""Qdrant 청크 payload 단일 진실 원점 (R3 PoC).

두 ingest 경로 (pipeline/ingestor.py, pipeline/batch_service.py) 가 동일 스키마로
적재하고, 두 search 경로 (search/hybrid.py, search/fallback.py) 가 동일 스키마로
읽기 위한 Pydantic 모델. v0 legacy payload (payload_version 미존재 + extra 필드)
와의 호환을 위해 extra="ignore", 모델 자체는 frozen=True 로 고정.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class QdrantChunkPayload(BaseModel):
    """Qdrant point.payload 단일 스키마 (v1)."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    payload_version: int = 1
    text: str
    volume: str
    chunk_index: int
    source: list[str]
    title: str = ""
    date: str = ""
