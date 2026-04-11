"""Batch Embedder 단위 테스트."""

import json
from pathlib import Path

import pytest

from src.pipeline.batch_embedder import prepare_batch_input


def test_prepare_batch_input_creates_jsonl(tmp_path):
    """청크 텍스트를 JSONL 파일로 변환."""
    texts = ["참사랑이란", "축복의 의미", "천일국 건설"]
    output_path = prepare_batch_input(texts, tmp_path / "batch.jsonl")

    assert output_path.exists()
    lines = output_path.read_text().strip().split("\n")
    assert len(lines) == 3
    first = json.loads(lines[0])
    assert "contents" in first
    assert first["contents"] == "참사랑이란"


def test_prepare_batch_input_empty_texts(tmp_path):
    """빈 텍스트 리스트일 때 빈 파일 생성."""
    output_path = prepare_batch_input([], tmp_path / "empty.jsonl")
    assert output_path.exists()
    assert output_path.read_text() == ""
