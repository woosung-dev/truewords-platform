from dataclasses import dataclass


@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int


def chunk_text(
    text: str,
    volume: str,
    max_chars: int = 500,
    overlap: int = 50,
) -> list[Chunk]:
    if not text.strip():
        return []

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[Chunk] = []
    buffer = ""
    chunk_index = 0

    for para in paragraphs:
        candidate = (buffer + "\n\n" + para).strip() if buffer else para

        if len(candidate) > max_chars and buffer:
            chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index))
            chunk_index += 1
            tail = buffer[-overlap:] if overlap > 0 and len(buffer) > overlap else ""
            buffer = (tail + "\n\n" + para).strip() if tail else para
        else:
            buffer = candidate

    if buffer.strip():
        chunks.append(Chunk(text=buffer.strip(), volume=volume, chunk_index=chunk_index))

    return chunks
