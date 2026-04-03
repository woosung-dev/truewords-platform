"""텍스트 청킹. kss 문장 분리 기반."""

from dataclasses import dataclass

import kss


@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int
    source: str = ""
    title: str = ""
    date: str = ""


def chunk_text(
    text: str,
    volume: str,
    max_chars: int = 500,
    source: str = "",
    title: str = "",
    date: str = "",
    overlap_sentences: int = 1,
) -> list[Chunk]:
    """문장 경계 기반 청킹. 문장 중간 절단 없이 max_chars 단위로 분리."""
    if not text.strip():
        return []

    # kss로 문장 분리
    sentences = kss.split_sentences(text)
    if not sentences:
        return []

    chunks: list[Chunk] = []
    buffer: list[str] = []
    buffer_len = 0
    chunk_index = 0

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        new_len = buffer_len + len(sentence) + (1 if buffer else 0)

        if new_len > max_chars and buffer:
            # 현재 버퍼를 청크로 저장
            chunks.append(Chunk(
                text=" ".join(buffer),
                volume=volume,
                chunk_index=chunk_index,
                source=source,
                title=title,
                date=date,
            ))
            chunk_index += 1

            # 오버랩: 마지막 N개 문장을 다음 청크에 포함
            if overlap_sentences > 0 and len(buffer) >= overlap_sentences:
                buffer = buffer[-overlap_sentences:]
                buffer_len = sum(len(s) for s in buffer) + len(buffer) - 1
            else:
                buffer = []
                buffer_len = 0

        buffer.append(sentence)
        buffer_len = sum(len(s) for s in buffer) + len(buffer) - 1

    # 남은 버퍼 처리
    if buffer:
        chunks.append(Chunk(
            text=" ".join(buffer),
            volume=volume,
            chunk_index=chunk_index,
            source=source,
            title=title,
            date=date,
        ))

    return chunks
