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
    """민감 인명/PII 필터링 테스트."""

    def test_normal_answer_passes_through(self) -> None:
        answer = "참부모님의 축복은 가정연합의 핵심 의식입니다."
        result = filter_sensitive_names(answer)
        assert result == answer

    def test_preserves_religious_terms(self) -> None:
        answer = "원리강론에서 창조원리는 하나님의 창조 목적을 설명합니다."
        result = filter_sensitive_names(answer)
        assert "원리강론" in result
        assert "창조원리" in result

    def test_blocks_resident_registration_number(self) -> None:
        answer = "주민번호는 800101-1234567 입니다."
        result = filter_sensitive_names(answer)
        assert "800101" not in result
        assert "개인정보" in result

    def test_blocks_korean_mobile_phone(self) -> None:
        answer = "연락처는 010-1234-5678 입니다."
        result = filter_sensitive_names(answer)
        assert "010-1234-5678" not in result
        assert "개인정보" in result

    def test_blocks_credit_card_number(self) -> None:
        answer = "카드: 1234-5678-9012-3456 결제 완료."
        result = filter_sensitive_names(answer)
        assert "1234-5678-9012-3456" not in result
        assert "개인정보" in result

    def test_volume_numbers_not_false_positive(self) -> None:
        """권 번호 (001권 ~ 615권) 같은 일반 숫자 토큰은 false positive 가 아님."""
        answer = "말씀선집 001권, 167권, 615권을 참고하세요."
        result = filter_sensitive_names(answer)
        assert result == answer

    def test_blocks_email(self) -> None:
        """audit 2차 S-6 (2026-05-15): 이메일 패턴 차단."""
        answer = "문의는 user@example.com 으로 보내주세요."
        result = filter_sensitive_names(answer)
        assert "user@example.com" not in result
        assert "개인정보" in result

    def test_blocks_korean_address(self) -> None:
        """audit 2차 S-6: 한국 주소 (시/도 + 시/군/구 + 동/읍/면) 보수적 매칭."""
        answer = "주소는 서울 강남구 역삼동 입니다."
        result = filter_sensitive_names(answer)
        assert "역삼동" not in result
        assert "개인정보" in result

    def test_blocks_full_address_with_road(self) -> None:
        """경기 + 시 + 로 형태 (도로명) 주소도 차단."""
        answer = "본부는 경기 가평군 설악로 인근입니다."
        result = filter_sensitive_names(answer)
        assert "개인정보" in result

    def test_religious_place_names_not_blocked(self) -> None:
        """종교적 지명 (시/도 prefix 없는 단순 동 이름) 은 차단 X — 본문 보존.

        패턴은 시/도 + 시/군/구 + 동/읍/면 동시 등장 시만 매칭. "역삼동" 단독 X.
        """
        answer = "본부교회는 한남동에 위치합니다. 부산 본부도 운영중."
        result = filter_sensitive_names(answer)
        # "한남동" + "부산" 등장하지만 시/도+시/구+동 패턴 동시 충족 X — 통과
        assert "한남동" in result
        assert "부산" in result


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
