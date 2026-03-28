from src.pipeline.chunker import Chunk, chunk_text


def test_chunk_returns_chunks_with_metadata():
    text = "첫 번째 문단입니다.\n\n두 번째 문단입니다.\n\n세 번째 문단입니다."
    chunks = chunk_text(text, volume="vol_001", max_chars=30)

    assert len(chunks) > 0
    assert all(isinstance(c, Chunk) for c in chunks)
    assert all(c.volume == "vol_001" for c in chunks)
    assert all(c.chunk_index >= 0 for c in chunks)


def test_chunk_indices_are_sequential():
    text = "\n\n".join([f"문단 {i}입니다." for i in range(10)])
    chunks = chunk_text(text, volume="vol_001", max_chars=30)

    indices = [c.chunk_index for c in chunks]
    assert indices == list(range(len(chunks)))


def test_chunk_text_not_empty():
    text = "내용이 있는 문단.\n\n또 다른 내용."
    chunks = chunk_text(text, volume="vol_001", max_chars=500)

    assert all(c.text.strip() for c in chunks)


def test_single_paragraph_becomes_one_chunk():
    text = "짧은 단일 문단."
    chunks = chunk_text(text, volume="vol_002", max_chars=500)

    assert len(chunks) == 1
    assert chunks[0].text == "짧은 단일 문단."
    assert chunks[0].volume == "vol_002"


def test_empty_text_returns_empty_list():
    chunks = chunk_text("", volume="vol_001", max_chars=500)
    assert chunks == []


def test_whitespace_only_paragraphs_are_skipped():
    text = "첫 문단.\n\n   \n\n두 번째 문단."
    chunks = chunk_text(text, volume="vol_001", max_chars=500)

    texts = [c.text for c in chunks]
    assert not any(t.strip() == "" for t in texts)
