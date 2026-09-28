"""오늘의 책갈피 Repository — AsyncSession 은 여기만 보유한다 (ENT-HD-019·020, PLAN-HD-012)."""

import uuid
from datetime import date

from sqlalchemy import delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.modules.hoondok.models import CardReceipt, WordCard


class CardRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # --- 카드 풀 (ENT-HD-019) -------------------------------------------------

    async def list_active(self) -> list[WordCard]:
        """오늘 카드 계산용 active 풀 전체. 순서는 pick_today_card 가 정한다."""
        result = await self.session.execute(select(WordCard).where(WordCard.status == "active"))
        return list(result.scalars().all())

    async def get(self, card_id: uuid.UUID) -> WordCard | None:
        return await self.session.get(WordCard, card_id)

    async def get_pinned(self, day: date) -> WordCard | None:
        result = await self.session.execute(select(WordCard).where(WordCard.pinned_on == day))
        return result.scalar_one_or_none()

    async def page(self, status: str | None, offset: int, limit: int) -> tuple[list[WordCard], int]:
        """admin 목록 — 최신 등록순. 전체 건수를 함께 돌려준다."""
        query = select(WordCard)
        count = select(func.count()).select_from(WordCard)
        if status is not None:
            query = query.where(WordCard.status == status)
            count = count.where(WordCard.status == status)
        total = int((await self.session.execute(count)).scalar_one())
        result = await self.session.execute(
            query.order_by(WordCard.created_at.desc(), WordCard.id).offset(offset).limit(limit)
        )
        return list(result.scalars().all()), total

    async def save_card(self, card: WordCard) -> WordCard:
        """커밋 실패(IntegrityError 포함)는 롤백 뒤 그대로 올린다 — 서비스가 409 로 바꾼다."""
        self.session.add(card)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(card)
        return card

    # --- 나의 책갈피 (ENT-HD-020) --------------------------------------------

    async def get_receipt(self, user_id: uuid.UUID, card_id: uuid.UUID) -> CardReceipt | None:
        result = await self.session.execute(
            select(CardReceipt).where(CardReceipt.user_id == user_id, CardReceipt.card_id == card_id)
        )
        return result.scalar_one_or_none()

    async def save_receipt(self, receipt: CardReceipt) -> CardReceipt:
        self.session.add(receipt)
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        await self.session.refresh(receipt)
        return receipt

    async def list_receipts(self, user_id: uuid.UUID, shared_only: bool) -> list[tuple[CardReceipt, WordCard]]:
        """본인 책갈피 중 active 카드만, 받은 날 최신순."""
        query = (
            select(CardReceipt, WordCard)
            .join(WordCard, WordCard.id == CardReceipt.card_id)
            .where(CardReceipt.user_id == user_id, WordCard.status == "active")
        )
        if shared_only:
            query = query.where(CardReceipt.shared_at.is_not(None))
        query = query.order_by(CardReceipt.received_on.desc(), WordCard.work_title, WordCard.id)
        result = await self.session.execute(query)
        return [(receipt, card) for receipt, card in result.all()]

    async def delete_for_user(self, user_id: uuid.UUID) -> None:
        """UserDataPurger 규약 — 커밋하지 않는다. 사용자 저장 커밋에 함께 묶인다."""
        await self.session.execute(delete(CardReceipt).where(CardReceipt.user_id == user_id))
