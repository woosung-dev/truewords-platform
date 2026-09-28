"""오늘의 책갈피 API (API-HD-047~051, PLAN-HD-012).

`/hoondok/cards/*` 는 공개(active 카드만), `/hoondok/me/cards*` 는 `hoondok_token` 이며 쓰기는 CSRF 헤더를 요구한다.
**라우트 순서 주의**: `/cards/today` 가 `/cards/{card_id}` 보다 앞에 있어야 "today" 가 UUID 로 파싱되지 않는다.
"""

import uuid

from fastapi import APIRouter, Depends, Query

from app.modules.hoondok.cards_schemas import (
    CardFilter,
    CardPublic,
    CardReceiptItem,
    MyCardsResponse,
    TodayCardResponse,
)
from app.modules.hoondok.cards_service import CardService
from app.modules.hoondok.dependencies import get_card_service
from app.modules.identity.dependencies import get_current_user, verify_csrf
from app.modules.identity.models import User

router = APIRouter(prefix="/hoondok", tags=["hoondok"])


@router.get("/cards/today", response_model=TodayCardResponse)
async def get_today_card(service: CardService = Depends(get_card_service)) -> TodayCardResponse:
    """API-HD-047 오늘(KST)의 책갈피. 고정 카드 → 없으면 active 풀 회전. 풀이 비면 card=null — 항상 200, 인증 없음."""
    return await service.get_today()


@router.get("/cards/{card_id}", response_model=CardPublic)
async def get_card(card_id: uuid.UUID, service: CardService = Depends(get_card_service)) -> CardPublic:
    """API-HD-048 카드 1장(받은 사람 화면·OG 이미지용). active 가 아니면 404, 인증 없음."""
    return await service.get_card(card_id)


@router.post(
    "/me/cards/{card_id}/receive",
    response_model=CardReceiptItem,
    dependencies=[Depends(verify_csrf)],
)
async def receive_card(
    card_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: CardService = Depends(get_card_service),
) -> CardReceiptItem:
    """API-HD-049 책갈피 받기(멱등, 받은 날은 처음 받은 KST 날짜 유지). 404 비공개 카드, 403 CSRF, 401 미인증."""
    return await service.receive(user.id, card_id)


@router.post(
    "/me/cards/{card_id}/shared",
    response_model=CardReceiptItem,
    dependencies=[Depends(verify_csrf)],
)
async def mark_card_shared(
    card_id: uuid.UUID,
    user: User = Depends(get_current_user),
    service: CardService = Depends(get_card_service),
) -> CardReceiptItem:
    """API-HD-050 건넴 표시(멱등). 받지 않은 카드면 받기도 함께 기록한다. 받은 사람 정보는 저장하지 않는다."""
    return await service.mark_shared(user.id, card_id)


@router.get("/me/cards", response_model=MyCardsResponse)
async def get_my_cards(
    filter: CardFilter | None = Query(default=None, description="shared = 건넨 책갈피만"),
    user: User = Depends(get_current_user),
    service: CardService = Depends(get_card_service),
) -> MyCardsResponse:
    """API-HD-051 나의 책갈피 — 책별 개수(책장) + 받은 날 최신순 목록. active 카드만. 401 미인증."""
    return await service.my_cards(user.id, shared_only=filter == "shared")
