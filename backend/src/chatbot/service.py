"""챗봇 설정 Service."""

import uuid

from fastapi import HTTPException, status

from src.chatbot.models import ChatbotConfig
from src.chatbot.repository import ChatbotRepository
from src.chatbot.schemas import ChatbotConfigCreate, ChatbotConfigUpdate, SearchTiersConfig
from src.search.cascading import CascadingConfig, SearchTier
from src.search.weighted import WeightedConfig, WeightedSource

# 검색 설정 타입 유니온
SearchConfig = CascadingConfig | WeightedConfig

# 단일 기본값 상수 (DRY)
# RRF fusion 점수는 일반적으로 0.0~0.5 범위 (코사인 유사도 스케일이 아님)
DEFAULT_CASCADING_CONFIG = CascadingConfig(
    tiers=[SearchTier(sources=["A", "B", "C"], min_results=3, score_threshold=0.1)]
)
DEFAULT_RERANK_ENABLED = False
DEFAULT_QUERY_REWRITE_ENABLED = False


class ChatbotService:
    def __init__(self, repo: ChatbotRepository) -> None:
        self.repo = repo

    async def list_active(self) -> list[ChatbotConfig]:
        return await self.repo.list_active()

    async def list_all(self) -> list[ChatbotConfig]:
        return await self.repo.list_all()

    async def list_paginated(
        self, limit: int = 20, offset: int = 0
    ) -> tuple[list[ChatbotConfig], int]:
        """페이지네이션된 전체 목록 + 총 개수."""
        items = await self.repo.list_paginated(limit=limit, offset=offset)
        total = await self.repo.count_all()
        return items, total

    async def get_by_id(self, config_id: uuid.UUID) -> ChatbotConfig:
        """단건 조회. 없으면 404."""
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        return config

    async def get_search_config(
        self, chatbot_id: str | None
    ) -> tuple[SearchConfig, bool, bool]:
        """chatbot_id로 SearchConfig + rerank_enabled + query_rewrite_enabled를 조회."""
        if chatbot_id is None:
            return DEFAULT_CASCADING_CONFIG, DEFAULT_RERANK_ENABLED, DEFAULT_QUERY_REWRITE_ENABLED
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )
        search_cfg = self._parse_search_config(config.search_tiers)
        rerank_enabled = config.search_tiers.get("rerank_enabled", DEFAULT_RERANK_ENABLED)
        query_rewrite_enabled = config.search_tiers.get(
            "query_rewrite_enabled", DEFAULT_QUERY_REWRITE_ENABLED
        )
        return search_cfg, rerank_enabled, query_rewrite_enabled

    async def get_config_id(self, chatbot_id: str | None) -> uuid.UUID | None:
        """chatbot_id로 DB PK를 조회."""
        if chatbot_id is None:
            return None
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        return config.id if config else None

    async def get_system_prompt(self, chatbot_id: str | None) -> str:
        """chatbot_id의 system_prompt를 조회. None 또는 미설정/빈값은 "" 반환.

        R2 Vertical Slice — generator 의 system_prompt 파라미터로 주입.
        빈 문자열은 generator 측 fallback(DEFAULT_SYSTEM_PROMPT) 을 유도한다.

        TODO(R2 C5): RuntimeConfig.generation.system_prompt 흡수 후 제거.
        """
        if chatbot_id is None:
            return ""
        config = await self.repo.get_by_chatbot_id(chatbot_id)
        if config is None:
            return ""
        return config.system_prompt or ""

    async def build_runtime_config(
        self, chatbot_id: str | None
    ) -> "ChatbotRuntimeConfig | None":
        """ChatbotConfig → ChatbotRuntimeConfig (불변 단일 객체) 조립.

        chatbot_id is None  → None 반환 (router 측에서 시스템 기본값 분기)
        config 미존재       → HTTPException 404 (get_search_config 와 동일 정책)
        빈 system_prompt    → DEFAULT_SYSTEM_PROMPT fallback
        persona_name        → system_prompt 의 {persona} 치환
        search_tiers JSON   → SearchModeConfig + RetrievalConfig 분리
        """
        from src.chat.prompt import DEFAULT_SYSTEM_PROMPT, apply_persona
        from src.chatbot.runtime_config import (
            ChatbotRuntimeConfig,
            GenerationConfig,
            RetrievalConfig,
            SafetyConfig,
            SearchModeConfig,
            TierConfig,
        )

        if chatbot_id is None:
            return None
        record = await self.repo.get_by_chatbot_id(chatbot_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"chatbot_id '{chatbot_id}'를 찾을 수 없습니다",
            )

        raw = record.search_tiers or {}
        mode_str = raw.get("mode", "cascading")
        tiers_in = raw.get("tiers", []) or []
        tiers = [
            TierConfig(
                sources=list(t.get("sources", [])),
                min_results=t.get("min_results", 3),
                score_threshold=t.get("score_threshold", 0.1),
            )
            for t in tiers_in
        ]

        base_prompt = (record.system_prompt or "").strip() or DEFAULT_SYSTEM_PROMPT
        persona = (record.persona_name or "").strip() or None

        return ChatbotRuntimeConfig(
            chatbot_id=record.chatbot_id,
            name=record.display_name,
            search=SearchModeConfig(
                mode=mode_str,
                tiers=tiers,
                weights=raw.get("weights", {}),
                dictionary_enabled=raw.get("dictionary_enabled", False),
            ),
            generation=GenerationConfig(
                system_prompt=apply_persona(base_prompt, persona),
                persona_name=persona,
            ),
            retrieval=RetrievalConfig(
                rerank_enabled=raw.get("rerank_enabled", True),
                query_rewrite_enabled=raw.get("query_rewrite_enabled", True),
            ),
            safety=SafetyConfig(),
        )

    async def create(self, data: ChatbotConfigCreate) -> ChatbotConfig:
        existing = await self.repo.get_by_chatbot_id(data.chatbot_id)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"chatbot_id '{data.chatbot_id}' 이미 존재합니다",
            )
        # SearchTiersConfig → dict 변환 (JSONB 저장)
        dump = data.model_dump()
        dump["search_tiers"] = dump["search_tiers"] if isinstance(dump["search_tiers"], dict) else data.search_tiers.model_dump()
        config = ChatbotConfig(**dump)
        saved = await self.repo.create(config)
        await self.repo.commit()
        return saved

    async def update(
        self, config_id: uuid.UUID, data: ChatbotConfigUpdate
    ) -> ChatbotConfig:
        config = await self.repo.get_by_id(config_id)
        if config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="챗봇 설정을 찾을 수 없습니다",
            )
        updates = data.model_dump(exclude_unset=True)
        # SearchTiersConfig → dict 변환 (JSONB 저장)
        if "search_tiers" in updates and updates["search_tiers"] is not None:
            st = updates["search_tiers"]
            if not isinstance(st, dict):
                updates["search_tiers"] = data.search_tiers.model_dump()
        updated = await self.repo.update(config, updates)
        await self.repo.commit()
        return updated

    @staticmethod
    def _parse_search_config(tiers_data: dict) -> SearchConfig:
        """JSONB search_tiers → CascadingConfig | WeightedConfig 변환.

        search_mode가 "weighted"이면 WeightedConfig를, 그 외(미지정/cascading/잘못된 값)는
        CascadingConfig를 반환하여 하위 호환성을 유지한다.
        """
        mode = tiers_data.get("search_mode", "cascading")

        if mode == "weighted":
            weighted_sources = tiers_data.get("weighted_sources", [])
            sources = [
                WeightedSource(
                    source=ws["source"],
                    weight=ws.get("weight", 1.0),
                    score_threshold=ws.get("score_threshold", 0.1),
                )
                for ws in weighted_sources
            ]
            return WeightedConfig(sources=sources)

        # cascading (기본값) 또는 잘못된 mode → CascadingConfig fallback
        tiers_list = tiers_data.get("tiers", [])
        tiers = [
            SearchTier(
                sources=t["sources"],
                min_results=t.get("min_results", 3),
                score_threshold=t.get("score_threshold", 0.1),
            )
            for t in tiers_list
        ]
        return CascadingConfig(tiers=tiers)
