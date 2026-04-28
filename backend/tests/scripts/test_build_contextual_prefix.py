"""build_contextual_prefix 단위 테스트."""
from __future__ import annotations

import asyncio
import json
import random
from pathlib import Path
from unittest.mock import patch

import pytest

from scripts.build_contextual_prefix import (
    build_prompt,
    generate_prefix_for_volume_concurrent,
    iter_chunks_from_volume_jsonl,
    parse_prefix_response,
    retry_failed_chunks_in_jsonl,
)


def test_build_prompt_inserts_full_doc_and_chunk() -> None:
    prompt = build_prompt(
        full_doc="A B C 1956년 10월 3일 강의록", chunk_text="C", chunk_index=2
    )
    assert "<document>" in prompt and "A B C 1956년 10월 3일 강의록" in prompt
    assert "<chunk>C</chunk>" in prompt
    assert "한국어" in prompt and ("시기" in prompt or "장소" in prompt or "주제" in prompt)


def test_parse_prefix_response_strips_whitespace_and_caps_length() -> None:
    raw = "  이 청크는 1956년 10월 3일 '말씀선집 007권' 강의 중 참조상 개념을 다룬다.  "
    out = parse_prefix_response(raw)
    assert out.startswith("이 청크는")
    assert not out.endswith(" ")


def test_parse_prefix_response_truncates_long_output() -> None:
    raw = "긴 문장. " * 100  # ~700자
    out = parse_prefix_response(raw)
    assert len(out) <= 400


def test_iter_chunks_from_volume_jsonl_yields_dicts(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text(
        json.dumps({"chunk_index": 0, "text": "t1"}) + "\n" +
        json.dumps({"chunk_index": 1, "text": "t2"}) + "\n",
        encoding="utf-8",
    )
    items = list(iter_chunks_from_volume_jsonl(p))
    assert [i["chunk_index"] for i in items] == [0, 1]
    assert items[0]["text"] == "t1"


def test_iter_chunks_from_volume_jsonl_handles_blank_lines(tmp_path: Path) -> None:
    p = tmp_path / "v.jsonl"
    p.write_text("\n" + json.dumps({"chunk_index": 0, "text": "t1"}) + "\n\n", encoding="utf-8")
    items = list(iter_chunks_from_volume_jsonl(p))
    assert len(items) == 1


# ---------- concurrent mode (옵션 B 본가동) ----------


def _write_chunks_jsonl(path: Path, n: int) -> None:
    lines = [
        json.dumps({"chunk_index": i, "text": f"text_{i}", "volume": "테스트권"})
        for i in range(n)
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


@pytest.mark.asyncio
async def test_concurrent_mode_respects_semaphore(tmp_path: Path) -> None:
    """Semaphore(2)로 실행 시 동시 진행 청크가 2개 이하인지 검증."""
    inp = tmp_path / "v.jsonl"
    out = tmp_path / "out.jsonl"
    _write_chunks_jsonl(inp, 10)

    state = {"in_flight": 0, "max_seen": 0}
    lock = asyncio.Lock()

    async def fake_generate_text(prompt: str, model: str = "") -> str:
        async with lock:
            state["in_flight"] += 1
            if state["in_flight"] > state["max_seen"]:
                state["max_seen"] = state["in_flight"]
        await asyncio.sleep(0.02)
        async with lock:
            state["in_flight"] -= 1
        return "prefix"

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=fake_generate_text,
    ):
        sem = asyncio.Semaphore(2)
        await generate_prefix_for_volume_concurrent(inp, out, sem)

    assert state["max_seen"] <= 2, f"동시 진행 청크 초과: {state['max_seen']}"
    assert out.exists()
    lines = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 10


@pytest.mark.asyncio
async def test_concurrent_mode_isolates_exceptions(tmp_path: Path) -> None:
    """한 청크 실패해도 나머지는 prefix_text 채워져야 함."""
    inp = tmp_path / "v.jsonl"
    out = tmp_path / "out.jsonl"
    _write_chunks_jsonl(inp, 5)

    async def fake_generate_text(prompt: str, model: str = "") -> str:
        # full_doc에 모든 text가 들어있으므로 <chunk> 태그로 정확 매칭
        if "<chunk>text_2</chunk>" in prompt:
            raise RuntimeError("fake api failure")
        return "ok prefix"

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=fake_generate_text,
    ):
        sem = asyncio.Semaphore(5)
        await generate_prefix_for_volume_concurrent(inp, out, sem)

    lines = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    by_idx = {d["chunk_index"]: d for d in lines}
    assert by_idx[2]["prefix_text"] == ""
    assert "fake api failure" in by_idx[2].get("prefix_error", "")
    for i in (0, 1, 3, 4):
        assert by_idx[i]["prefix_text"] == "ok prefix"
        assert "prefix_error" not in by_idx[i]


@pytest.mark.asyncio
async def test_retry_only_failed_chunks_skips_successful(tmp_path: Path) -> None:
    """기존 JSONL에서 prefix_text 비어있거나 prefix_error 있는 청크만 재시도."""
    p = tmp_path / "v.jsonl"
    initial = [
        {"chunk_index": 0, "text": "ok0", "volume": "v", "prefix_text": "kept0"},
        {"chunk_index": 1, "text": "fail1", "volume": "v", "prefix_text": "",
         "prefix_error": "429"},
        {"chunk_index": 2, "text": "ok2", "volume": "v", "prefix_text": "kept2"},
        {"chunk_index": 3, "text": "fail3", "volume": "v", "prefix_text": ""},
    ]
    p.write_text("\n".join(json.dumps(c) for c in initial) + "\n", encoding="utf-8")

    call_count = {"n": 0}

    async def fake_generate_text(prompt: str, model: str = "") -> str:
        call_count["n"] += 1
        if "<chunk>fail1</chunk>" in prompt:
            return "recovered prefix 1"
        if "<chunk>fail3</chunk>" in prompt:
            return "recovered prefix 3"
        # 성공한 청크는 절대 호출되지 않아야 함
        raise AssertionError(f"unexpected call: {prompt[:40]}")

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=fake_generate_text,
    ):
        sem = asyncio.Semaphore(5)
        stats = await retry_failed_chunks_in_jsonl(p, sem)

    # 성공한 청크만 호출됨
    assert call_count["n"] == 2
    assert stats == {"total": 4, "failed_before": 2, "success_now": 4, "still_failed": 0}

    # 파일 갱신 확인 — 기존 성공 청크는 그대로, 실패 청크는 prefix 채워짐 + error 사라짐
    lines = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert lines[0]["prefix_text"] == "kept0"
    assert lines[1]["prefix_text"] == "recovered prefix 1"
    assert "prefix_error" not in lines[1]
    assert lines[2]["prefix_text"] == "kept2"
    assert lines[3]["prefix_text"] == "recovered prefix 3"


@pytest.mark.asyncio
async def test_retry_no_failures_returns_zero_retry(tmp_path: Path) -> None:
    """모든 청크가 이미 성공이면 호출 0회 + still_failed=0."""
    p = tmp_path / "v.jsonl"
    initial = [
        {"chunk_index": 0, "text": "t0", "volume": "v", "prefix_text": "p0"},
        {"chunk_index": 1, "text": "t1", "volume": "v", "prefix_text": "p1"},
    ]
    p.write_text("\n".join(json.dumps(c) for c in initial) + "\n", encoding="utf-8")

    async def boom(*a, **kw):
        raise AssertionError("must not be called")

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=boom,
    ):
        sem = asyncio.Semaphore(5)
        stats = await retry_failed_chunks_in_jsonl(p, sem)

    assert stats == {"total": 2, "failed_before": 0, "success_now": 2, "still_failed": 0}


@pytest.mark.asyncio
async def test_retry_persists_partial_recovery(tmp_path: Path) -> None:
    """재시도에서 일부만 성공하면 still_failed 카운트가 남고 prefix_error도 갱신."""
    p = tmp_path / "v.jsonl"
    initial = [
        {"chunk_index": 0, "text": "fail0", "volume": "v", "prefix_text": "",
         "prefix_error": "429"},
        {"chunk_index": 1, "text": "fail1", "volume": "v", "prefix_text": ""},
    ]
    p.write_text("\n".join(json.dumps(c) for c in initial) + "\n", encoding="utf-8")

    async def fake_generate_text(prompt: str, model: str = "") -> str:
        if "<chunk>fail0</chunk>" in prompt:
            return "recovered 0"
        raise RuntimeError("still 429")

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=fake_generate_text,
    ):
        sem = asyncio.Semaphore(5)
        stats = await retry_failed_chunks_in_jsonl(p, sem)

    assert stats == {"total": 2, "failed_before": 2, "success_now": 1, "still_failed": 1}
    lines = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert lines[0]["prefix_text"] == "recovered 0"
    assert "prefix_error" not in lines[0]
    assert lines[1]["prefix_text"] == ""
    assert "still 429" in lines[1]["prefix_error"]


@pytest.mark.asyncio
async def test_concurrent_mode_preserves_chunk_index(tmp_path: Path) -> None:
    """랜덤 지연이 있어도 출력 jsonl이 chunk_index 입력 순서와 1:1 대응."""
    inp = tmp_path / "v.jsonl"
    out = tmp_path / "out.jsonl"
    _write_chunks_jsonl(inp, 8)

    async def fake_generate_text(prompt: str, model: str = "") -> str:
        await asyncio.sleep(random.uniform(0.001, 0.02))
        return prompt[-12:]  # echo last bytes (chunk_text 영향)

    with patch(
        "scripts.build_contextual_prefix.generate_text",
        side_effect=fake_generate_text,
    ):
        sem = asyncio.Semaphore(4)
        await generate_prefix_for_volume_concurrent(inp, out, sem)

    lines = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert [d["chunk_index"] for d in lines] == list(range(8))
    # text는 그대로 보존
    assert [d["text"] for d in lines] == [f"text_{i}" for i in range(8)]
    # 모든 prefix_text 채워짐
    assert all(d["prefix_text"] for d in lines)
