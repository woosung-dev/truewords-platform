"""관리자 RAG trace 플레이그라운드 라우터 — `POST /admin/rag-trace`.

질문 1건을 운영 stage 로 다시 실행하고 trace JSON 을 동기 응답으로 돌려준다.
저장하지 않는다(메시지·검색 이벤트·인용·캐시 0건). main.py 가 시연 게이트로 감싼다.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status

from app.modules.admin.dependencies import get_current_admin, verify_csrf
from app.modules.chat.dependencies import get_rag_trace_service
from app.modules.chat.trace_schemas import RagTraceRequest, RagTraceResponse
from app.modules.chat.trace_service import RagTraceService

router = APIRouter(prefix="/admin/rag-trace", tags=["admin-rag-trace"])

# VM 1대 보호 — 동시 실행 2건까지. 슬롯이 다 차 있으면 기다리지 않고 429.
_slots = asyncio.Semaphore(2)


@router.post("", response_model=RagTraceResponse, dependencies=[Depends(verify_csrf)])
async def run_rag_trace(
    data: RagTraceRequest,
    service: RagTraceService = Depends(get_rag_trace_service),
    current_admin: dict = Depends(get_current_admin),
) -> RagTraceResponse:
    if _slots.locked():
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="파이프라인 추적이 이미 2건 실행 중입니다. 잠시 후 다시 시도하세요.",
        )
    async with _slots:
        return await service.run(data)
