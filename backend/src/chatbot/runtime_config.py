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

    audit 2차 P-1 (2026-05-15, Agent B P1 9/10): 동일 파일의 다른 6개 Config 클래스
    (WeightedSourceConfig / SearchModeConfig / GenerationConfig / RetrievalConfig /
    SafetyConfig / ChatbotRuntimeConfig) 는 모두 ``frozen=True`` 인데 본 클래스만
    누락. ChatbotRuntimeConfig 가 frozen 이라도 ``tiers: list[TierConfig]`` 요소가
    mutable 이라 런타임 변형 위험 — 불변 의도 깨짐. 명시적 ``frozen=True`` 추가.
    """

    model_config = ConfigDict(frozen=True)

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
    """검색 전략 선택 + 파라미터. R1 Strategy Registry 키 역할.

    audit P1-13 (2026-05-15): `dictionary_enabled` 필드 제거. `dictionary_collection`
    동적 주입은 memory `project_terminology_blocked.md` 상 미구현 상태로 보류 중이고,
    검색 코드 (search/collection_resolver 등) 어디서도 이 플래그를 사용하지 않아
    dead config 였다. admin API schema 의 `SearchTiersConfig.dictionary_enabled` 는
    호환성 유지 차원에서 schema 에 잔존 (DB JSONB 키는 build_runtime_config 에서
    무시 — Pydantic V2 extra="ignore" default).
    """

    model_config = ConfigDict(frozen=True)

    mode: Literal["cascading", "weighted"]
    tiers: list[TierConfig] = Field(default_factory=list)
    weighted_sources: list[WeightedSourceConfig] = Field(default_factory=list)


class GenerationConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    system_prompt: str
    persona_name: str | None = None
    temperature: float = 0.7
    max_output_tokens: int = 4096

    # P1-J — 답변 마무리 템플릿 토글.
    # enable_closing=True 일 때만 closing_kind 에 따라 후속 LLM 호출.
    enable_closing: bool = False
    closing_kind: ClosingKind = "off"

    # P0-A — 자동 follow-up 추천 토글. 기본 활성 (모든 답변에 노출).
    enable_suggested_followups: bool = True

    # 레드팀 시연 — RAG-only 대조군 봇. True 면 BASE·모드모듈 전부 우회하고
    # 빈 system_instruction 으로 생성 (검색 컨텍스트 + 질문만 LLM 전달).
    raw_rag_only: bool = False


class RetrievalConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    top_k: int = 10
    score_threshold: float = 0.0
    rerank_enabled: bool = True
    rerank_top_k: int = 10
    query_rewrite_enabled: bool = True
    # 봇별 멀티턴(대화 이력) 토글. False 면 SessionStage 가 이력을 로드하지 않아
    # condense·이력 주입·후속턴 캐시 게이트가 전부 단일턴 동작으로 복귀한다.
    multiturn_enabled: bool = True
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
