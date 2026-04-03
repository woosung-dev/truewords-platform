"""문장 경계 청킹 테스트 (kss 기반)."""

from src.pipeline.chunker import chunk_text, Chunk


def test_sentence_boundary_preserves_sentences():
    """문장 중간에서 잘리지 않아야 함."""
    text = "하나님은 사랑이시다. 참부모님은 인류의 참된 부모이시다. 원리강론은 핵심 교리이다."
    chunks = chunk_text(text, volume="vol_001", max_chars=60)
    for chunk in chunks:
        # 각 청크가 온전한 문장으로 끝나야 함 (마침표로 끝남)
        assert chunk.text.rstrip().endswith(".")


def test_sentence_chunking_respects_max_chars():
    """max_chars를 크게 초과하지 않아야 함."""
    # 긴 텍스트 생성 (10개 문장)
    sentences = [f"이것은 테스트 문장 번호 {i}입니다." for i in range(10)]
    text = " ".join(sentences)
    chunks = chunk_text(text, volume="vol_001", max_chars=100)
    # 각 청크가 max_chars + 단일 문장 길이 이내
    for chunk in chunks:
        assert len(chunk.text) <= 200  # max_chars + 여유


def test_sentence_chunking_overlap():
    """오버랩: 이전 청크의 마지막 문장이 다음 청크에 포함."""
    sentences = [f"문장{i}." for i in range(10)]
    text = " ".join(sentences)
    chunks = chunk_text(text, volume="vol_001", max_chars=30, overlap_sentences=1)
    if len(chunks) >= 2:
        # 첫 번째 청크의 마지막 문장이 두 번째 청크에 포함되어야 함
        first_last_sentence = chunks[0].text.rstrip().split(".")[-2] + "."
        assert first_last_sentence.strip() in chunks[1].text


def test_chunk_has_title_date_fields():
    """Chunk에 title, date 필드가 기본값으로 존재."""
    chunks = chunk_text("테스트 텍스트.", volume="vol_001")
    assert chunks[0].title == ""
    assert chunks[0].date == ""


def test_chunk_title_date_passed_through():
    """title, date가 전달되면 Chunk에 반영."""
    chunks = chunk_text("테스트.", volume="vol_001", title="창조원리", date="1966.5.1")
    assert chunks[0].title == "창조원리"
    assert chunks[0].date == "1966.5.1"


def test_backward_compat_paragraph_chunking():
    """기존 단락 기반 호출도 여전히 동작."""
    text = "첫 번째 단락.\n\n두 번째 단락."
    chunks = chunk_text(text, volume="vol_001", max_chars=500)
    assert len(chunks) >= 1
    assert all(isinstance(c, Chunk) for c in chunks)
