"""인용 원문보기 endpoint (P0-B).

ADR-46 §C.3 — 답변 페이지 인용 카드의 "원문보기" 버튼이 호출하는 엔드포인트.
GET /api/sources/chunks/{chunk_id} → 청크 전체 본문 + 4중 메타 (CitationMeta).

인증: 본 엔드포인트는 사용자가 답변에서 직접 호출하므로 admin 인증 강제 X.
TODO(P0-B 후속): chatbot 단위 ACL — 현재 chatbot 의 카테고리 조합에 속한 청크
만 조회 가능하도록 source_filter 적용. 본 PR 은 토대만.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.datasource.dependencies import get_qdrant_service
from src.datasource.qdrant_service import DataSourceQdrantService
from src.datasource.schemas import SourceChunkDetail

chunks_router = APIRouter(
    prefix="/api/sources/chunks",
    tags=["sources"],
)


@chunks_router.get("/{chunk_id}", response_model=SourceChunkDetail)
async def get_chunk(
    chunk_id: str,
    service: DataSourceQdrantService = Depends(get_qdrant_service),
) -> SourceChunkDetail:
    """단일 청크 원문 조회 (P0-B 인용 원문보기 모달).

    chunk_id: Qdrant point id.
    응답: 본문 + 4중 메타 + UI 표기 레이블.
    """
    detail = await service.get_chunk_detail(chunk_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="청크를 찾을 수 없습니다.")
    return detail
