"""오늘의 책갈피 (API-HD-047~052, PLAN-HD-012).

공개 범위는 status=active 카드뿐이다. 외부 공유 권리 게이트(ContentRight)는 두지 않는다(DEC-PWA-024) —
협회가 불허하면 웹 플래그 `NEXT_PUBLIC_HOONDOK_CARDS` 를 끄거나 카드를 retired 로 바꾼다.
"""

import uuid
from collections import Counter
from collections.abc import Callable, Sequence
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.common.clock import today_kst, utcnow
from app.modules.hoondok.cards_repository import CardRepository
from app.modules.hoondok.cards_schemas import (
    CardAdminCreate,
    CardAdminItem,
    CardAdminListResponse,
    CardAdminUpdate,
    CardPublic,
    CardReceiptItem,
    CardShelf,
    MyCardsResponse,
    TodayCardResponse,
)
from app.modules.hoondok.models import CardReceipt, WordCard

PUBLIC_STATUS = "active"
PIN_CONFLICT = "그 날짜에는 이미 고정된 카드가 있어요"


def pick_today_card(cards: Sequence[WordCard], day: date) -> WordCard | None:
    """오늘 카드 결정(순수 함수). 모든 사용자에게 같은 카드다.

    1. active 중 그날 `pinned_on` 인 카드
    2. 없으면 active 풀을 (created_at, id) 로 안정 정렬해 `day.toordinal() % 풀 크기` 번째
    풀이 비면 None. 고정 카드도 다른 날에는 회전 풀에 그대로 들어간다.
    """
    active = [c for c in cards if c.status == PUBLIC_STATUS]
    if not active:
        return None
    for card in active:
        if card.pinned_on == day:
            return card
    pool = sorted(active, key=lambda c: (c.created_at, str(c.id)))
    return pool[day.toordinal() % len(pool)]


def _public(card: WordCard) -> CardPublic:
    return CardPublic.model_validate(card, from_attributes=True)


def _receipt_item(receipt: CardReceipt, card: WordCard) -> CardReceiptItem:
    return CardReceiptItem(card=_public(card), received_on=receipt.received_on, shared_at=receipt.shared_at)


class CardService:
    def __init__(self, repo: CardRepository, today_fn: Callable[[], date] = today_kst) -> None:
        self.repo = repo
        self.today_fn = today_fn

    async def today_card(self, day: date) -> WordCard | None:
        """발송기(push_sender)도 쓰는 오늘 카드 조회."""
        return pick_today_card(await self.repo.list_active(), day)

    # --- API-HD-047·048 공개 ---------------------------------------------------

    async def get_today(self) -> TodayCardResponse:
        today = self.today_fn()
        card = await self.today_card(today)
        return TodayCardResponse(date=today, card=_public(card) if card else None)

    async def _public_card(self, card_id: uuid.UUID) -> WordCard:
        """active 가 아니면(draft·retired·없음) 존재를 알리지 않는 404."""
        card = await self.repo.get(card_id)
        if card is None or card.status != PUBLIC_STATUS:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "카드를 찾을 수 없어요")
        return card

    async def get_card(self, card_id: uuid.UUID) -> CardPublic:
        return _public(await self._public_card(card_id))

    # --- API-HD-049~051 나의 책갈피 ------------------------------------------

    async def _upsert_receipt(self, user_id: uuid.UUID, card: WordCard, shared: bool) -> CardReceiptItem:
        """멱등 upsert. 동시 요청이 unique 에 걸리면 다시 읽어 같은 결과를 돌려준다."""
        receipt = await self.repo.get_receipt(user_id, card.id)
        if receipt is None:
            receipt = CardReceipt(user_id=user_id, card_id=card.id, received_on=self.today_fn())
        elif not shared or receipt.shared_at is not None:
            return _receipt_item(receipt, card)  # 바꿀 것이 없다
        if shared:
            receipt.shared_at = utcnow()
        try:
            saved = await self.repo.save_receipt(receipt)
        except IntegrityError:
            # 같은 사용자의 동시 요청이 먼저 만들었다 — 이제는 행이 있으므로 한 번 더 읽어 같은 결과로 맞춘다.
            if await self.repo.get_receipt(user_id, card.id) is None:
                raise
            return await self._upsert_receipt(user_id, card, shared)
        return _receipt_item(saved, card)

    async def receive(self, user_id: uuid.UUID, card_id: uuid.UUID) -> CardReceiptItem:
        return await self._upsert_receipt(user_id, await self._public_card(card_id), shared=False)

    async def mark_shared(self, user_id: uuid.UUID, card_id: uuid.UUID) -> CardReceiptItem:
        """건넴 표시. 받지 않은 카드면 받기도 함께 기록한다. shared_at 은 처음 건넨 시각을 유지한다."""
        return await self._upsert_receipt(user_id, await self._public_card(card_id), shared=True)

    async def my_cards(self, user_id: uuid.UUID, shared_only: bool) -> MyCardsResponse:
        rows = await self.repo.list_receipts(user_id, shared_only)
        counts = Counter(card.work_title for _, card in rows)
        shelves = [
            CardShelf(work_title=title, count=count)
            for title, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        return MyCardsResponse(shelves=shelves, items=[_receipt_item(r, c) for r, c in rows])


class CardAdminService:
    """API-HD-052 풀 관리. 본문은 불변이라 수정은 status·pinned_on 만 받는다."""

    def __init__(self, repo: CardRepository) -> None:
        self.repo = repo

    async def list(self, status_filter: str | None, page: int, page_size: int) -> CardAdminListResponse:
        cards, total = await self.repo.page(status_filter, (page - 1) * page_size, page_size)
        return CardAdminListResponse(
            items=[CardAdminItem.model_validate(c, from_attributes=True) for c in cards],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def _check_pin(self, pinned_on: date | None, card_id: uuid.UUID | None) -> None:
        if pinned_on is None:
            return
        other = await self.repo.get_pinned(pinned_on)
        if other is not None and other.id != card_id:
            raise HTTPException(status.HTTP_409_CONFLICT, PIN_CONFLICT)

    async def _save(self, card: WordCard) -> CardAdminItem:
        try:
            saved = await self.repo.save_card(card)
        except IntegrityError:
            raise HTTPException(status.HTTP_409_CONFLICT, PIN_CONFLICT) from None
        return CardAdminItem.model_validate(saved, from_attributes=True)

    async def create(self, data: CardAdminCreate) -> CardAdminItem:
        await self._check_pin(data.pinned_on, None)
        return await self._save(WordCard(**data.model_dump()))

    async def update(self, card_id: uuid.UUID, data: CardAdminUpdate) -> CardAdminItem:
        card = await self.repo.get(card_id)
        if card is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "카드를 찾을 수 없어요")
        changes = data.model_dump(exclude_unset=True)
        if changes.get("status", card.status) is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "status 는 비울 수 없어요")
        await self._check_pin(changes.get("pinned_on"), card.id)
        for key, value in changes.items():
            setattr(card, key, value)
        return await self._save(card)
