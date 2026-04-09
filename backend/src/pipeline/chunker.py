"""텍스트 청킹. 문장 분리 기반."""

import logging
import re
import warnings
from dataclasses import dataclass

import kss

logger = logging.getLogger(__name__)

# kss가 현실적으로 처리 가능한 텍스트 크기 임계값
_KSS_MAX_CHARS = 50_000


@dataclass
class Chunk:
    text: str
    volume: str
    chunk_index: int
    source: list[str] | str = ""
    title: str = ""
    date: str = ""


# 한국어 문장 종결 패턴: 다/요/까/죠/세요 + 마침표, 또는 ?!
_SENTENCE_END_RE = re.compile(
    r'(?<=[다요까죠니라])\.'
    r'|(?<=세요)\.'
    r'|(?<=습니다)\.'
    r'|(?<=합니다)\.'
    r'|(?<=됩니다)\.'
    r'|(?<=입니다)\.'
    r'|[?!]'
    r'|(?<=\.)(?:\s)'
)


def _split_sentences_regex(text: str) -> list[str]:
    """정규식 기반 한국어 문장 분리. kss 대비 빠르지만 정확도는 낮음."""
    parts = _SENTENCE_END_RE.split(text)
    sentences: list[str] = []
    for part in parts:
        line = part.strip()
        if line:
            sentences.append(line)
    return sentences


def _split_sentences_safe(text: str) -> list[str]:
    """텍스트 크기에 따라 kss 또는 정규식 문장 분리 선택.

    - 소형 텍스트(< 50K자): kss로 정확한 문장 분리
    - 대형 텍스트(>= 50K자): 정규식 + 줄바꿈 기반 빠른 분리

    kss + pecab 백엔드는 대형 텍스트에서 overflow 및 극심한 성능 저하 발생."""
    if len(text) < _KSS_MAX_CHARS:
        return _split_with_kss(text)

    logger.info("대형 텍스트 (%d자) → 정규식 기반 문장 분리 사용", len(text))
    return _split_large_text(text)


def _split_with_kss(text: str) -> list[str]:
    """소형 텍스트용 kss 문장 분리."""
    paragraphs = text.split("\n\n")
    all_sentences: list[str] = []
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings("error", category=RuntimeWarning)
                result = kss.split_sentences(para)
            for item in result:
                if isinstance(item, list):
                    all_sentences.extend(item)
                else:
                    all_sentences.append(item)
        except (RuntimeWarning, Exception):
            # kss 실패 시 줄바꿈 기반 fallback
            all_sentences.extend(
                line.strip() for line in para.split("\n") if line.strip()
            )
    return all_sentences


def _split_large_text(text: str) -> list[str]:
    """대형 텍스트용 빠른 문장 분리. 줄바꿈 + 정규식 조합."""
    all_sentences: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        if len(line) > 500:
            # 긴 줄은 정규식으로 문장 분리
            all_sentences.extend(_split_sentences_regex(line))
        else:
            all_sentences.append(line)
    return all_sentences


def chunk_text(
    text: str,
    volume: str,
    max_chars: int = 500,
    source: str = "",
    title: str = "",
    date: str = "",
    overlap_sentences: int = 2,
) -> list[Chunk]:
    """문장 경계 기반 청킹. 문장 중간 절단 없이 max_chars 단위로 분리."""
    if not text.strip():
        return []

    # kss로 문장 분리 (단락 단위 분할로 대형 텍스트 안전 처리)
    sentences = _split_sentences_safe(text)
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
