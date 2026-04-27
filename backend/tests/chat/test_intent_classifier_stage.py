"""IntentClassifierStage + classify_intent 단위 테스트.

분류 성공/실패 4xN 케이스 + Stage 의 pipeline_state 전이를 검증한다.
LLM 호출은 generate_text 를 mock 한다 (network/key 비의존).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.chat.pipeline.context import ChatContext
from src.chat.pipeline.stages.intent_classifier import IntentClassifierStage
from src.chat.pipeline.state import PipelineState
from src.chat.schemas import ChatRequest
from src.chatbot.runtime_config import (
    ChatbotRuntimeConfig,
    GenerationConfig,
    RetrievalConfig,
    SafetyConfig,
    SearchModeConfig,
)
from src.search.intent_classifier import (
    DEFAULT_INTENT,
    INTENT_LABELS,
    classify_intent,
)


def _runtime_config(*, intent_enabled: bool = True) -> ChatbotRuntimeConfig:
    return ChatbotRuntimeConfig(
        chatbot_id="t",
        name="t",
        search=SearchModeConfig(mode="cascading"),
        generation=GenerationConfig(system_prompt="sp"),
        retrieval=RetrievalConfig(intent_classifier_enabled=intent_enabled),
        safety=SafetyConfig(),
    )


# ---------- classify_intent (LLM 호출 함수) 단위 테스트 ----------


class TestClassifyIntentFunction:
    @pytest.mark.parametrize("label", list(INTENT_LABELS))
    @pytest.mark.asyncio
    async def test_returns_label_when_llm_responds_with_label(self, label) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            return_value=label,
        ):
            assert await classify_intent("질문") == label

    @pytest.mark.asyncio
    async def test_normalizes_whitespace_and_case(self) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            return_value="  Reasoning\n",
        ):
            assert await classify_intent("질문") == "reasoning"

    @pytest.mark.asyncio
    async def test_invalid_response_falls_back_to_default(self) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            return_value="알 수 없음",
        ):
            assert await classify_intent("질문") == DEFAULT_INTENT

    @pytest.mark.asyncio
    async def test_empty_response_falls_back(self) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            return_value="",
        ):
            assert await classify_intent("질문") == DEFAULT_INTENT

    @pytest.mark.asyncio
    async def test_timeout_falls_back(self) -> None:
        import asyncio

        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            side_effect=asyncio.TimeoutError(),
        ):
            assert await classify_intent("질문") == DEFAULT_INTENT

    @pytest.mark.asyncio
    async def test_exception_falls_back(self) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
            side_effect=RuntimeError("Gemini API down"),
        ):
            assert await classify_intent("질문") == DEFAULT_INTENT

    @pytest.mark.asyncio
    async def test_disabled_skips_llm_call(self) -> None:
        with patch(
            "src.search.intent_classifier.generate_text",
            new_callable=AsyncMock,
        ) as mock_llm:
            result = await classify_intent("질문", enabled=False)
        assert result == DEFAULT_INTENT
        mock_llm.assert_not_awaited()


# ---------- IntentClassifierStage 단위 테스트 ----------


class TestIntentClassifierStage:
    @pytest.mark.asyncio
    async def test_classifies_and_transitions_to_INTENT_CLASSIFIED(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="참부모님은 누구입니까?"))
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED
        ctx.runtime_config = _runtime_config()

        with patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
            return_value="factoid",
        ):
            result = await IntentClassifierStage().execute(ctx)

        assert result.intent == "factoid"
        assert result.pipeline_state == PipelineState.INTENT_CLASSIFIED

    @pytest.mark.asyncio
    async def test_force_off_env_skips_llm_and_uses_default(self, monkeypatch) -> None:
        """INTENT_CLASSIFIER_FORCE_OFF=1 환경변수 시 LLM 호출 없이 default 사용 (평가용 토글)."""
        ctx = ChatContext(request=ChatRequest(query="질문"))
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED
        ctx.runtime_config = _runtime_config(intent_enabled=True)  # chatbot 토글은 켜져 있어도

        monkeypatch.setenv("INTENT_CLASSIFIER_FORCE_OFF", "1")

        with patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
        ) as mock_classify:
            result = await IntentClassifierStage().execute(ctx)

        assert result.intent == DEFAULT_INTENT
        assert result.pipeline_state == PipelineState.INTENT_CLASSIFIED
        mock_classify.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_disabled_skips_llm_and_uses_default(self) -> None:
        ctx = ChatContext(request=ChatRequest(query="질문"))
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED
        ctx.runtime_config = _runtime_config(intent_enabled=False)

        with patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
        ) as mock_classify:
            result = await IntentClassifierStage().execute(ctx)

        assert result.intent == DEFAULT_INTENT
        assert result.pipeline_state == PipelineState.INTENT_CLASSIFIED
        mock_classify.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_no_runtime_config_still_calls_classifier(self) -> None:
        """legacy 호출(runtime_config=None) 도 graceful 처리."""
        ctx = ChatContext(request=ChatRequest(query="질문"))
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED

        with patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
            return_value="conceptual",
        ):
            result = await IntentClassifierStage().execute(ctx)

        assert result.intent == "conceptual"
        assert result.pipeline_state == PipelineState.INTENT_CLASSIFIED

    @pytest.mark.asyncio
    async def test_meta_prefills_fallback_and_transitions_to_META_TERMINATED(self) -> None:
        """Phase E — meta intent 시 ctx.answer prefill + ctx.results 비움 + META_TERMINATED."""
        from src.search.intent_classifier import META_FALLBACK_ANSWER

        ctx = ChatContext(request=ChatRequest(query="너는 누구야?"))
        ctx.pipeline_state = PipelineState.RUNTIME_RESOLVED
        ctx.runtime_config = _runtime_config()

        with patch(
            "src.chat.pipeline.stages.intent_classifier.classify_intent",
            new_callable=AsyncMock,
            return_value="meta",
        ):
            result = await IntentClassifierStage().execute(ctx)

        assert result.intent == "meta"
        assert result.answer == META_FALLBACK_ANSWER
        assert result.results == []
        assert result.pipeline_state == PipelineState.META_TERMINATED

    @pytest.mark.asyncio
    async def test_warns_when_precondition_state_wrong(self, caplog) -> None:
        ctx = ChatContext(request=ChatRequest(query="질문"))
        # Wrong prior state (should be RUNTIME_RESOLVED) — Stage 는 logger.warning 만 발생.
        ctx.pipeline_state = PipelineState.SESSION_READY
        ctx.runtime_config = _runtime_config()

        with caplog.at_level("WARNING"):
            with patch(
                "src.chat.pipeline.stages.intent_classifier.classify_intent",
                new_callable=AsyncMock,
                return_value="conceptual",
            ):
                result = await IntentClassifierStage().execute(ctx)

        assert any(
            "IntentClassifierStage" in rec.message and "precondition" in rec.message
            for rec in caplog.records
        )
        # Stage 는 강제 차단하지 않음 — 정상 전이.
        assert result.pipeline_state == PipelineState.INTENT_CLASSIFIED
