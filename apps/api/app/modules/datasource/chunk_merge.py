"""인접 청크 suffix-prefix overlap dedup — 원문보기 모달의 reading flow 정리.

배경: RecursiveCharacterTextSplitter (chunk_size=700, overlap=150) 가 생성하는
청크들은 인접 chunk_index 사이에 ~150자 overlap 을 공유한다. 원문보기 모달에서
메인 + 인접 ±N 청크를 그대로 이어 붙이면 같은 문장이 두 번 나오고 청크 경계가
문장 중간에서 끊겨 reading flow 가 깨진다.

해결: 두 의견 (Plan agent / codex) 합의 — 백엔드에서 NFC 정규화 후
suffix-prefix LCS 로 overlap 을 잘라내고 **하나의 연속 본문** 으로 합쳐 반환한다.
프론트는 메인 청크 위치 (offset_start..offset_end) 만 시각 강조하고 단일
paragraph 로 렌더한다.

알고리즘 핵심:
- 두 인접 청크의 prev.suffix == curr.prefix 가 가장 길게 일치하는 길이 k 를 탐색.
- 우연 매칭 방지: k >= 20.
- 정상 overlap 한계: k <= 300 (RecursiveCharacterTextSplitter 의 50~200 변동
  + 안전 여유).
- 잔존 가드: dedup 후 curr 잔여 길이 >= 50 자 보장 (짧은 청크 전체 삭제 방지).
- 한국어 종결어미 boundary 는 dedup 자체에 사용하지 않음 (false negative 다발).
  단순 substring 매칭만.

NFC/NFD: macOS clipboard 등 NFD 가 섞여 들어올 수 있어 비교 전 NFC 통일 필수
(memo: feedback_qdrant_count_check_exact 와 같은 정규화 원칙).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

# 우연 매칭 방지 — 한국어 19자 미만 (≈ 한 절) 일치는 dedup 안 함.
_MIN_OVERLAP = 20
# RecursiveCharacterTextSplitter 의 separator 우선 동작으로 실제 overlap 은
# 50~200 변동. 300 은 안전 여유.
_MAX_OVERLAP = 300
# dedup 후 curr 에 최소 50자 잔존 — 짧은 청크 전체 삭제 방지.
_MIN_RESIDUE = 50


def normalize_for_merge(text: str) -> str:
    """비교 안전 정규화 — NFC + CRLF→LF.

    NFC 통일이 가장 중요. macOS / iOS clipboard 의 NFD 가 섞이면 동일 문장도
    bytewise 비교에서 mismatch.
    """
    return unicodedata.normalize("NFC", text or "").replace("\r\n", "\n")


def overlap_length(prev: str, curr: str) -> int:
    """``prev`` 의 suffix 와 ``curr`` 의 prefix 가 일치하는 최대 길이.

    [_MIN_OVERLAP, _MAX_OVERLAP] 범위 안에서 가장 긴 일치를 선택. 없으면 0.
    매칭 후 ``curr`` 잔여가 _MIN_RESIDUE 미만이면 dedup 포기 (짧은 청크 보호).
    """
    if not prev or not curr:
        return 0
    upper = min(len(prev), len(curr), _MAX_OVERLAP)
    if upper < _MIN_OVERLAP:
        return 0
    # 가장 긴 일치부터 역순 — early exit.
    for k in range(upper, _MIN_OVERLAP - 1, -1):
        if prev[-k:] == curr[:k] and (len(curr) - k) >= _MIN_RESIDUE:
            return k
    return 0


@dataclass
class _Segment:
    """merge 에 들어가는 청크 한 조각."""

    text: str
    is_main: bool


@dataclass
class MergedContext:
    """dedup 결과 — 합쳐진 본문 + 메인 청크 위치."""

    merged_text: str
    main_offset_start: int
    main_offset_end: int


def merge_with_dedup(
    *,
    main_text: str,
    before: list[str],
    after: list[str],
) -> MergedContext:
    """``before + [main] + after`` 를 NFC 정규화 + suffix-prefix dedup 후 합침.

    Args:
        main_text: 메인 청크 본문.
        before: 메인 직전 인접 청크들 (chunk_index 오름차순).
        after:  메인 직후 인접 청크들 (chunk_index 오름차순).

    Returns:
        merged_text 와 그 안에서 메인 청크가 차지하는 [start, end) offset.
        dedup 으로 메인 청크의 앞 일부가 잘릴 수 있으나 **메인 청크의 핵심
        본문은 보존** (잔존 _MIN_RESIDUE 보장).
    """
    segments: list[_Segment] = []
    for t in before:
        if t:
            segments.append(_Segment(text=normalize_for_merge(t), is_main=False))
    segments.append(_Segment(text=normalize_for_merge(main_text), is_main=True))
    for t in after:
        if t:
            segments.append(_Segment(text=normalize_for_merge(t), is_main=False))

    if not segments:
        return MergedContext(merged_text="", main_offset_start=0, main_offset_end=0)

    merged = segments[0].text
    main_start = 0 if segments[0].is_main else -1
    main_end = len(segments[0].text) if segments[0].is_main else -1

    for seg in segments[1:]:
        n = overlap_length(merged, seg.text)
        appended = seg.text[n:]
        # 청크 경계에 의미 단위 hint — 연속 본문이지만 paragraph 단위 자연스러운
        # 줄바꿈 보존을 위해 직전이 종결문자가 아니면 single space 만 삽입.
        sep = "" if (merged.endswith(("\n", " ")) or appended.startswith(("\n", " "))) else " "
        before_len = len(merged) + len(sep)
        merged = merged + sep + appended
        if seg.is_main:
            main_start = before_len
            main_end = before_len + len(appended)

    if main_start < 0:
        # 안전 fallback — 메인이 누락된 비정상 입력. 전체 영역을 메인으로.
        main_start = 0
        main_end = len(merged)

    return MergedContext(
        merged_text=merged,
        main_offset_start=main_start,
        main_offset_end=main_end,
    )
