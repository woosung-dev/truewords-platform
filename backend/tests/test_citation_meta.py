"""인용 메타 4중 (P1-B) 테스트."""

from __future__ import annotations

from src.datasource.citation_meta import (
    CitationMeta,
    extract_meta_from_payload,
    format_citation_label,
)


class TestCitationMetaDefaults:
    def test_all_fields_optional(self) -> None:
        meta = CitationMeta()
        assert meta.volume_no is None
        assert meta.delivered_at is None
        assert meta.delivered_place is None
        assert meta.chapter_title is None

    def test_full_meta_constructs(self) -> None:
        meta = CitationMeta(
            volume_no=347,
            delivered_at="2001.07.03",
            delivered_place="청평수련소",
            chapter_title="참사랑의 길",
        )
        assert meta.volume_no == 347
        assert meta.delivered_at == "2001.07.03"


class TestExtractMetaFromPayload:
    def test_none_payload_returns_empty_meta(self) -> None:
        meta = extract_meta_from_payload(None)
        assert meta == CitationMeta()

    def test_empty_payload_returns_empty_meta(self) -> None:
        assert extract_meta_from_payload({}) == CitationMeta()

    def test_full_payload(self) -> None:
        meta = extract_meta_from_payload(
            {
                "volume_no": 347,
                "delivered_at": "2001.07.03",
                "delivered_place": "청평수련소",
                "chapter_title": "참사랑의 길",
            }
        )
        assert meta.volume_no == 347
        assert meta.delivered_place == "청평수련소"

    def test_int_coerced_from_string(self) -> None:
        meta = extract_meta_from_payload({"volume_no": "347"})
        assert meta.volume_no == 347

    def test_invalid_int_becomes_none(self) -> None:
        meta = extract_meta_from_payload({"volume_no": "not-a-number"})
        assert meta.volume_no is None

    def test_empty_string_becomes_none(self) -> None:
        meta = extract_meta_from_payload(
            {"volume_no": "", "delivered_at": "", "delivered_place": ""}
        )
        assert meta.volume_no is None
        assert meta.delivered_at is None
        assert meta.delivered_place is None

    def test_partial_payload(self) -> None:
        meta = extract_meta_from_payload(
            {"volume_no": 180, "delivered_at": "1988.06.15"}
        )
        assert meta.volume_no == 180
        assert meta.delivered_place is None
        assert meta.chapter_title is None


class TestFormatCitationLabel:
    def test_full_label(self) -> None:
        meta = CitationMeta(
            volume_no=347,
            delivered_at="2001.07.03",
            delivered_place="청평수련소",
            chapter_title="참사랑의 길",
        )
        assert (
            format_citation_label(meta)
            == "[347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]"
        )

    def test_empty_meta_returns_empty(self) -> None:
        assert format_citation_label(CitationMeta()) == ""

    def test_partial_meta_skips_missing(self) -> None:
        meta = CitationMeta(volume_no=347, chapter_title="제목")
        assert format_citation_label(meta) == "[347권 · 제목]"
