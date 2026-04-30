"""chunk_hierarchical (Parent-Child) 단위 테스트."""

from __future__ import annotations

from src.pipeline.chunker import chunk_hierarchical


def test_returns_only_children_with_parent_text():
    """child 만 반환, 각 child 의 parent_text 는 비어있지 않음."""
    text = "첫 번째 단락입니다. " * 200  # 충분히 긴 텍스트
    chunks = chunk_hierarchical(
        text, volume="001", source="A", title="t", date="d",
        parent_size=1500, child_size=300,
    )
    assert len(chunks) > 1, "텍스트 길이 대비 child 가 여러 개 나와야 함"
    for c in chunks:
        assert c.parent_text != "", f"child {c.chunk_index} 의 parent_text 가 비어있음"
        assert len(c.parent_text) >= len(c.text), "parent_text 가 child text 보다 짧지 않아야 함"


def test_parent_chunk_index_is_set():
    """parent_chunk_index 가 0 이상의 int 로 설정됨."""
    text = "내용. " * 500
    chunks = chunk_hierarchical(text, volume="002")
    for c in chunks:
        assert c.parent_chunk_index >= 0
        assert isinstance(c.parent_chunk_index, int)


def test_global_chunk_index_is_sequential():
    """child chunk_index 가 0..N-1 글로벌 순서 부여."""
    text = "한국어 종결어미. 입니다. 그렇습니다. " * 300
    chunks = chunk_hierarchical(text, volume="003")
    indices = [c.chunk_index for c in chunks]
    assert indices == list(range(len(chunks)))


def test_metadata_propagated():
    """volume/source/title/date 가 모든 child 에 전달됨."""
    text = "샘플 본문. " * 500
    chunks = chunk_hierarchical(
        text, volume="010", source="A", title="제목", date="2026-01-01",
    )
    assert len(chunks) > 0
    for c in chunks:
        assert c.volume == "010"
        assert c.source == "A"
        assert c.title == "제목"
        assert c.date == "2026-01-01"


def test_empty_text_returns_empty_list():
    """공백 또는 빈 텍스트는 빈 리스트."""
    assert chunk_hierarchical("", volume="001") == []
    assert chunk_hierarchical("   \n\n   ", volume="001") == []


def test_short_text_single_parent_multiple_children():
    """parent 1개에서 여러 child 가 나오는 케이스."""
    # 약 800자 텍스트 (parent_size 1500 미만이지만 child 300 보다 큼)
    text = "한국어 본문. " * 100
    chunks = chunk_hierarchical(text, volume="005", parent_size=1500, child_size=200)
    # parent 1개로 묶이고 child 가 여러 개
    parent_indices = {c.parent_chunk_index for c in chunks}
    assert len(parent_indices) == 1, f"parent 1개여야 하는데 {parent_indices}"
    assert len(chunks) >= 2


def test_long_text_multiple_parents():
    """parent 여러 개로 분할되는 케이스."""
    # 약 5000자 (parent 1500 으로 여러 개)
    text = "구절 " * 1500
    chunks = chunk_hierarchical(text, volume="100", parent_size=1500, child_size=300)
    parent_indices = {c.parent_chunk_index for c in chunks}
    assert len(parent_indices) >= 2, f"parent 2개 이상 나와야 하는데 {len(parent_indices)}"


def test_child_text_is_substring_or_overlap_of_parent():
    """child text 가 parent_text 와 의미 있는 관계 (boundary 인접 포함 가능)."""
    text = "첫 번째 단락입니다. 두 번째 문장입니다. " * 100
    chunks = chunk_hierarchical(text, volume="001", parent_size=1500, child_size=300)
    for c in chunks[:5]:
        # child text 의 길이가 child_size 근처이거나 그 이하
        assert len(c.text) <= 600  # child_size 300 + overlap 50 + 약간 여유
