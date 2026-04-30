"""R2 ChatbotRuntimeConfig — 런타임에 조립되는 불변 챗봇 설정 단일 객체.

각 Stage/Strategy/generator 가 이 객체에만 의존한다. DB 조회는
chatbot/service.build_runtime_config 팩토리가 담당.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TierConfig(BaseModel):
    """Cascading 전략의 단일 Tier."""

    sources: list[str]
    min_results: int = 3
    score_threshold: float = 0.75


class WeightedSourceConfig(BaseModel):
    """Weighted 전략의 단일 source 설정 (source/weight/score_threshold)."""

    model_config = ConfigDict(frozen=True)

    source: str
    weight: float = 1.0
    score_threshold: float = 0.1


class SearchModeConfig(BaseModel):
    """검색 전략 선택 + 파라미터. R1 Strategy Registry 키 역할."""

    model_config = ConfigDict(frozen=True)

    mode: Literal["cascading", "weighted"]
    tiers: list[TierConfig] = Field(default_factory=list)
    weighted_sources: list[WeightedSourceConfig] = Field(default_factory=list)
    dictionary_enabled: bool = False


class GenerationConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    system_prompt: str
    persona_name: str | None = None
    model_name: Literal["gemini-2.5-flash", "gemini-2.5-pro"] = "gemini-2.5-flash"
    temperature: float = 0.7
    max_output_tokens: int = 4096


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    top_k: int = 10
    score_threshold: float = 0.0
    rerank_enabled: bool = True
    rerank_top_k: int = 10
    query_rewrite_enabled: bool = True
    fallback_enabled: bool = True
    # Phase D — IntentClassifierStage 토글. False 시 LLM 호출 없이 conceptual default 사용.
    intent_classifier_enabled: bool = True


class SafetyConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    watermark_enabled: bool = True
    pii_filter_enabled: bool = True
    max_query_length: int = 1000


class ChatbotRuntimeConfig(BaseModel):
    """런타임 시점 조립되는 불변 챗봇 설정. 각 Stage/Strategy 가 이 객체에만 의존한다."""

    model_config = ConfigDict(frozen=True)

    chatbot_id: str
    name: str
    search: SearchModeConfig
    generation: GenerationConfig
    retrieval: RetrievalConfig
    safety: SafetyConfig
