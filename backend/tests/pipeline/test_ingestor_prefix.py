"""Chunk.prefix_text가 있을 때 임베딩 입력 텍스트가 prefix + 청크 원문으로 구성되는지 검증."""
from __future__ import annotations

from src.pipeline.chunker import Chunk
from src.pipeline.ingestor import _build_text_for_embedding


def test_build_text_for_embedding_prepends_prefix_when_present() -> None:
    c = Chunk(
        text="아담과 해와는 인류의 참조상이 될 사람이었습니다.",
        volume="말씀선집 007권",
        chunk_index=1,
        source=["O"],
        title="참조상의 의미",
        date="1956년 10월 3일",
        prefix_text="이 청크는 '말씀선집 007권' 1956년 10월 강의 중 '참조상' 개념을 다룬다.",
    )
    out = _build_text_for_embedding(c)
    assert out.startswith("이 청크는")
    assert "아담과 해와는 인류의 참조상" in out
    assert out.count("\n\n") >= 1


def test_build_text_for_embedding_falls_back_to_text_when_no_prefix() -> None:
    c = Chunk(text="원문만", volume="v", chunk_index=0)
    assert _build_text_for_embedding(c) == "원문만"


def test_chunk_dataclass_has_prefix_text_default_empty() -> None:
    c = Chunk(text="t", volume="v", chunk_index=0)
    assert c.prefix_text == ""
