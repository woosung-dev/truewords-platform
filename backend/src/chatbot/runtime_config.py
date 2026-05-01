"""R2 ChatbotRuntimeConfig — 런타임에 조립되는 불변 챗봇 설정 단일 객체.

각 Stage/Strategy/generator 가 이 객체에만 의존한다. DB 조회는
chatbot/service.build_runtime_config 팩토리가 담당.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# P0-E — 모드별 system prompt 라우팅. 5개 모드.
# Single source of truth: ``src.chat.types.AnswerMode`` (W2-③). 본 모듈은
# ChatRequest 스키마와의 일관성을 위해 alias 만 재노출한다 (Sonnet review #4).
from src.chat.types import AnswerMode  # noqa: E402,F401  (re-export)

# P1-J — 대화 마무리 템플릿 종류.
ClosingKind = Literal["prayer", "resolution", "off"]


class TierConfig(BaseModel):
    """Cascading 전략의 단일 Tier.

    score_threshold: RRF fusion 점수 (Σ1/(k+rank), 일반 0.0~0.5 범위) 의 cutoff.
    default 0.1 은 ``ChatbotService.build_runtime_config`` 의 fallback 과 동기화.
    이전에 0.75 였으나 운영 적용 0건 (dead default) 인 데다 RRF 점수대를 초과해
    실수로 인스턴스에 적용되면 검색 결과 0건 위험. 측정 분포 (2026-05-01,
    docs/dev-log/2026-05-01-cascade-distribution-measurement.md) 기반 정정.
    """

    sources: list[str]
    min_results: int = 3
    score_threshold: float = 0.1


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

    # P0-E — 모드별 system prompt override. None 또는 빈 dict 면 system_prompt 사용.
    # key: AnswerMode, value: 해당 모드 전용 system prompt
    system_prompt_by_mode: dict[str, str] | None = None

    # P1-J — 답변 마무리 템플릿 토글.
    # enable_closing=True 일 때만 closing_kind 에 따라 후속 LLM 호출.
    enable_closing: bool = False
    closing_kind: ClosingKind = "off"

    # P0-A — 자동 follow-up 추천 토글. 기본 활성 (모든 답변에 노출).
    enable_suggested_followups: bool = True


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    top_k: int = 10
    score_threshold: float = 0.0
    rerank_enabled: bool = True
    rerank_top_k: int = 10
    # PR 1 — swappable reranker Protocol. 운영 default 는 PR 8 ADR 결정 (gemini-flash 유지).
    # BGE 어댑터는 측정 후 미사용 결정으로 PR 10 에서 제거됨 (`docs/dev-log/2026-05-01-reranker-cross-encoder-ab-decision.md`).
    reranker_model: Literal["gemini-flash"] = "gemini-flash"
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
    # P1-F: 운영 투명성 — 챗봇별 신학 입장 (About 페이지 노출, 후속에서 활용).
    # 미설정 챗봇은 None → About 페이지에서 시스템 기본 카피 사용.
    theological_stance: str | None = None
