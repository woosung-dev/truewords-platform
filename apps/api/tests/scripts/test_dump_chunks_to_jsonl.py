"""dump_chunks_to_jsonl 단위 테스트."""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.dump_chunks_to_jsonl import dump_chunks, slugify_volume


def test_slugify_replaces_unsafe_chars_keeps_korean() -> None:
    assert slugify_volume("말씀선집/007권") == "말씀선집_007권"
    assert slugify_volume("a:b*c?d") == "a_b_c_d"
    assert slugify_volume("평화경") == "평화경"
    assert slugify_volume("") == "_unknown"


def _mk_point(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(payload=payload)


class _FakeQdrantClient:
    """scroll 호출 시 미리 정의된 batch를 순차 반환하는 mock."""

    def __init__(self, batches: list[list[SimpleNamespace]]) -> None:
        self._batches = batches
        self._idx = 0

    def scroll(
        self,
        collection_name: str,
        with_payload: bool,
        with_vectors: bool,
        limit: int,
        offset,
    ):
        if self._idx >= len(self._batches):
            return [], None
        batch = self._batches[self._idx]
        self._idx += 1
        next_offset = "cur" if self._idx < len(self._batches) else None
        return batch, next_offset


def test_dump_chunks_groups_by_volume_and_sorts_chunk_index(tmp_path: Path) -> None:
    pts_batch_1 = [
        _mk_point({"volume": "평화경", "chunk_index": 2, "text": "p2"}),
        _mk_point({"volume": "참부모경", "chunk_index": 0, "text": "c0"}),
    ]
    pts_batch_2 = [
        _mk_point({"volume": "평화경", "chunk_index": 0, "text": "p0"}),
        _mk_point({"volume": "평화경", "chunk_index": 1, "text": "p1"}),
        _mk_point({"volume": "참부모경", "chunk_index": 1, "text": "c1"}),
    ]
    client = _FakeQdrantClient([pts_batch_1, pts_batch_2])

    counts = dump_chunks(client, "malssum_poc", tmp_path)

    assert counts == {"평화경": 3, "참부모경": 2}

    pyeong = [json.loads(line) for line in (tmp_path / "평화경.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [d["chunk_index"] for d in pyeong] == [0, 1, 2]
    assert [d["text"] for d in pyeong] == ["p0", "p1", "p2"]

    cham = [json.loads(line) for line in (tmp_path / "참부모경.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [d["chunk_index"] for d in cham] == [0, 1]


def test_dump_chunks_handles_missing_volume_gracefully(tmp_path: Path) -> None:
    pts = [_mk_point({"chunk_index": 0, "text": "x"})]
    client = _FakeQdrantClient([pts])

    counts = dump_chunks(client, "c", tmp_path)

    assert counts == {"_unknown": 1}
    assert (tmp_path / "_unknown.jsonl").exists()


@pytest.mark.parametrize("payload,expected_idx", [
    ({"volume": "v", "chunk_index": "5"}, 5),
    ({"volume": "v", "chunk_index": None}, 0),
    ({"volume": "v"}, 0),
])
def test_dump_chunks_tolerates_chunk_index_variants(tmp_path: Path, payload, expected_idx) -> None:
    client = _FakeQdrantClient([[_mk_point(payload)]])
    counts = dump_chunks(client, "c", tmp_path)
    assert counts == {"v": 1}
    line = (tmp_path / "v.jsonl").read_text(encoding="utf-8").strip()
    parsed = json.loads(line)
    # chunk_index가 None/missing일 때 dump는 원본 payload를 그대로 직렬화 (정렬은 0 처리)
    assert parsed.get("chunk_index", expected_idx) in (None, "5", expected_idx)


def test_dump_chunks_preserves_nfc_nfd_collisions(tmp_path: Path) -> None:
    """NFC/NFD 동일 권 이름이 별도 키로 들어와도 모든 청크가 보존되어야 함.

    macOS FS는 NFC/NFD를 같은 path로 인식하므로, 동일 슬러그 충돌 시
    _dupN 접미사를 부여한다.
    """
    import unicodedata as _u
    name = "말씀선집 002권.pdf"
    nfc = _u.normalize("NFC", name)
    nfd = _u.normalize("NFD", name)
    assert nfc != nfd  # sanity

    pts = [
        _mk_point({"volume": nfc, "chunk_index": 0, "text": "nfc0"}),
        _mk_point({"volume": nfd, "chunk_index": 0, "text": "nfd0"}),
    ]
    client = _FakeQdrantClient([pts])
    counts = dump_chunks(client, "c", tmp_path)
    assert sum(counts.values()) == 2
    written = sorted(p.name for p in tmp_path.glob("*.jsonl"))
    # 슬러그 베이스 + _dup1 접미사로 두 개 파일 생성
    assert len(written) == 2
    assert any(w.endswith("_dup1.jsonl") for w in written)
