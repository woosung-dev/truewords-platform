"""출력 안전 레이어 테스트 — 면책 고지, 민감 인명 필터, 안전 레이어."""

import pytest

from src.safety.output_filter import (
    DISCLAIMER,
    append_disclaimer,
    apply_safety_layer,
    filter_sensitive_names,
)


class TestAppendDisclaimer:
    """면책 고지 추가 테스트."""

    def test_appends_disclaimer_to_answer(self) -> None:
        answer = "참사랑은 자기희생적 사랑입니다."
        result = append_disclaimer(answer)
        assert DISCLAIMER in result
        assert result.startswith("참사랑은")

    def test_no_duplicate_disclaimer(self) -> None:
        answer = f"참사랑은 자기희생적 사랑입니다.\n\n---\n_{DISCLAIMER}_"
        result = append_disclaimer(answer)
        assert result.count(DISCLAIMER) == 1

    def test_disclaimer_format(self) -> None:
        answer = "답변 내용"
        result = append_disclaimer(answer)
        assert "\n\n---\n_" in result
        assert result.endswith("_")


class TestFilterSensitiveNames:
    """민감 인명 필터링 테스트."""

    def test_normal_answer_passes_through(self) -> None:
        answer = "참부모님의 축복은 가정연합의 핵심 의식입니다."
        result = filter_sensitive_names(answer)
        assert result == answer

    def test_preserves_religious_terms(self) -> None:
        answer = "원리강론에서 창조원리는 하나님의 창조 목적을 설명합니다."
        result = filter_sensitive_names(answer)
        assert "원리강론" in result
        assert "창조원리" in result


class TestApplySafetyLayer:
    """통합 안전 레이어 테스트."""

    @pytest.mark.asyncio
    async def test_applies_disclaimer(self) -> None:
        answer = "참사랑은 자기희생적 사랑입니다."
        result = await apply_safety_layer(answer)
        assert DISCLAIMER in result

    @pytest.mark.asyncio
    async def test_preserves_original_content(self) -> None:
        answer = "원리강론의 창조원리에 따르면..."
        result = await apply_safety_layer(answer)
        assert "원리강론의 창조원리에 따르면" in result

    @pytest.mark.asyncio
    async def test_empty_answer_gets_disclaimer(self) -> None:
        result = await apply_safety_layer("")
        assert DISCLAIMER in result
