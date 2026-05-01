"""옵션 F 청킹 PoC 단위 테스트.

3 청킹 방식 (sentence baseline / token1024 char-based / paragraph) 행동 검증.
"""
from scripts.chunking_poc import chunk_paragraph, chunk_sentence, chunk_token1024
from src.pipeline.chunker import Chunk


# ---------- Task 1.1: chunk_sentence (baseline wrapper) ----------

def test_chunk_sentence_returns_chunks_with_sequential_indices():
    # 단락 분리 구조 — kss가 단락 단위로 문장 분리하므로 \n\n 필요
    paragraphs = ["첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다."] * 50
    text = "\n\n".join(paragraphs)  # ~2,500자
    chunks = chunk_sentence(text, volume="테스트권", source="A")
    assert len(chunks) > 1
    assert all(isinstance(c, Chunk) for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert all(c.volume == "테스트권" for c in chunks)
    assert all(c.source == "A" for c in chunks)
    assert all(c.prefix_text == "" for c in chunks)


def test_chunk_sentence_respects_max_chars():
    # 단락 단위 텍스트 — kss가 분리 가능
    paragraphs = ["안녕하세요. 반갑습니다. 좋은 하루입니다."] * 100
    text = "\n\n".join(paragraphs)
    chunks = chunk_sentence(text, volume="t")
    # max_chars=500 기본값 + overlap → 약간 여유 두고 1000자 이하
    assert all(len(c.text) <= 1000 for c in chunks), \
        f"max chunk size: {max(len(c.text) for c in chunks)}"


# ---------- Task 1.2: chunk_token1024 (char-based sliding window) ----------

def test_chunk_token1024_chunks_size_around_2560():
    text = "가" * 10000  # 단일 문자 반복으로 명확한 길이 검증
    chunks = chunk_token1024(text, volume="t")
    assert len(chunks) >= 3
    # 마지막 청크 제외하고 모두 정확히 2560자
    for c in chunks[:-1]:
        assert len(c.text) == 2560, f"unexpected size {len(c.text)}"


def test_chunk_token1024_overlap_500():
    text = "ABCDEFGHIJ" * 500  # 5,000자
    chunks = chunk_token1024(text, volume="t")
    # 인접 청크의 마지막 500자 = 다음 청크 첫 500자
    assert len(chunks) >= 2
    assert chunks[0].text[-500:] == chunks[1].text[:500]


def test_chunk_token1024_short_text_single_chunk():
    text = "짧은 문장."
    chunks = chunk_token1024(text, volume="t")
    assert len(chunks) == 1
    assert chunks[0].text == text


# ---------- Task 1.3: chunk_paragraph (blank-line + min_chars merge) ----------

def test_chunk_paragraph_splits_on_blank_lines():
    # 각 단락 길이 200자 이상 보장 (min_chars 병합 회피)
    text = "첫 단락 내용입니다." * 30 + "\n\n" + "두 번째 단락 내용입니다." * 30
    chunks = chunk_paragraph(text, volume="t")
    assert len(chunks) == 2


def test_chunk_paragraph_merges_short_paragraphs():
    text = "짧은 단락1.\n\n짧은 단락2.\n\n" + "충분히 긴 단락입니다." * 20
    chunks = chunk_paragraph(text, volume="t")
    # 짧은 단락 두 개는 다음 단락에 병합되어 모두 min_chars=200 이상
    # (마지막 청크는 예외 가능 — 잔여)
    for i, c in enumerate(chunks[:-1] if len(chunks) > 1 else chunks):
        assert len(c.text) >= 200, f"chunk[{i}] too short: {len(c.text)}"


def test_chunk_paragraph_empty_text():
    assert chunk_paragraph("", volume="t") == []
    assert chunk_paragraph("   \n\n  ", volume="t") == []
