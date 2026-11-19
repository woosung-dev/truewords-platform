"""인용 원문보기 endpoint (P0-B).

ADR-46 §C.3 — 답변 페이지 인용 카드의 "원문보기" 버튼이 호출하는 엔드포인트.
GET /api/sources/chunks/{chunk_id}?chatbot_id=... → 청크 전체 본문 + 4중 메타.

# ACL (Cross-review B1, Opus + Codex 합의)
호출자가 사용한 ``chatbot_id`` 의 search source 필터에 청크가 속해야 한다.
- chatbot_id 미지정 → 400 (정책상 인증 없는 endpoint 라도 chatbot 컨텍스트 필수)
- chatbot 미존재 → 404
- 청크의 ``source`` 가 chatbot 의 허용 source 집합 밖 → 403
- 청크 권(volume)에 원문 전체 공개 권리(content_rights status=allowed + scope_full_text)가 없음 → 403
  (인증 없는 endpoint 가 훈독 서고의 권리 정책을 우회해 이어진 본문을 내주지 않게 한다)

이로써 비공개 챗봇의 chunk 가 공개 chatbot id 로 leak 되는 것을 차단한다.
또한 chunk_id brute force 시도도 chatbot 단위 source_filter 통과 못하면 403.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.common.database import get_async_session

from app.modules.chatbot.dependencies import get_chatbot_service
from app.modules.chatbot.service import ChatbotService
from app.modules.datasource.dependencies import get_qdrant_service
from app.modules.datasource.qdrant_service import DataSourceQdrantService
from app.modules.datasource.schemas import SourceChunkDetail

chunks_router = APIRouter(
    prefix="/api/sources/chunks",
    tags=["sources"],
)


def _allowed_sources_for_chatbot(runtime_config) -> set[str]:  # type: ignore[no-untyped-def]
    """chatbot 의 search.tiers + weighted_sources 에서 허용된 source key 집합 추출."""
    allowed: set[str] = set()
    search = getattr(runtime_config, "search", None)
    if search is None:
        return allowed
    for tier in getattr(search, "tiers", []) or []:
        for s in getattr(tier, "sources", []) or []:
            if s:
                allowed.add(str(s))
    for ws in getattr(search, "weighted_sources", []) or []:
        # WeightedSourceConfig.source 또는 dict["source"]
        s = getattr(ws, "source", None) or (
            ws.get("source") if isinstance(ws, dict) else None
        )
        if s:
            allowed.add(str(s))
    return allowed


async def get_full_text_volumes(
    session: AsyncSession = Depends(get_async_session),
) -> set[str]:
    """원문 전체 공개가 허용된 권(volume) 집합 — 훈독 서고와 같은 권리 기준.

    hoondok 이 datasource 를 import 하므로 순환을 피하려고 content_rights 테이블을 직접 읽는다.
    """
    rows = await session.execute(
        text("SELECT volume FROM content_rights WHERE status = 'allowed' AND scope_full_text")
    )
    return set(rows.scalars().all())


@chunks_router.get("/{chunk_id}", response_model=SourceChunkDetail)
async def get_chunk(
    chunk_id: str,
    chatbot_id: str,
    service: DataSourceQdrantService = Depends(get_qdrant_service),
    chatbot_service: ChatbotService = Depends(get_chatbot_service),
    full_text_volumes: set[str] = Depends(get_full_text_volumes),
) -> SourceChunkDetail:
    """단일 청크 원문 조회 (P0-B 인용 원문보기 모달, chatbot ACL 적용).

    Args:
        chunk_id: Qdrant point id.
        chatbot_id: 호출 컨텍스트가 된 챗봇 id — ACL 검증 키.

    Returns:
        본문 + 4중 메타 + UI 표기 레이블.

    Raises:
        404: 청크 미존재 또는 chatbot 미존재.
        403: 청크가 chatbot 의 허용 source 집합 밖, 또는 권에 원문 공개 권리 없음.
    """
    runtime_config = await chatbot_service.build_runtime_config(chatbot_id)
    if runtime_config is None:
        raise HTTPException(status_code=404, detail="챗봇을 찾을 수 없습니다.")

    detail = await service.get_chunk_detail(chunk_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="청크를 찾을 수 없습니다.")

    allowed = _allowed_sources_for_chatbot(runtime_config)
    chunk_sources = set(detail.sources or [])
    # 청크가 chatbot 의 어떤 허용 source 와도 교집합 없으면 차단.
    if allowed and not (chunk_sources & allowed):
        raise HTTPException(
            status_code=403,
            detail="해당 청크는 이 챗봇의 검색 범위에 포함되지 않습니다.",
        )
    if detail.volume not in full_text_volumes:
        raise HTTPException(status_code=403, detail="이 권은 원문 공개 권리가 없습니다.")

    return detail
