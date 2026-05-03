"""chunk_merge — 인접 청크 suffix-prefix dedup 단위 테스트.

원문보기 모달의 reading flow 정리 (Plan agent + Codex 합의 (A) 구현). overlap=150
의 부산물을 백엔드에서 trim 해 프론트가 단일 paragraph 로 렌더할 수 있게 한다.

테스트 시나리오:
1. 정상 dedup — 인접 청크의 끝/시작 일치 영역 제거
2. NFC/NFD 정규화 — macOS clipboard NFD 우회
3. 짧은 청크 보호 — 잔존 < 50자면 dedup 포기
4. 우연 매칭 거부 — < 20자 일치는 무시
5. 메인 offset 정확성 — before/main/after 의 main 위치
6. 빈 입력 graceful
7. 메인 단독 — before/after 모두 비어있는 경우
"""

from __future__ import annotations

import unicodedata

from src.datasource.chunk_merge import (
    merge_with_dedup,
    normalize_for_merge,
    overlap_length,
)


def test_overlap_length_finds_longest_suffix_prefix_match():
    prev = "참부모님은 영원히 변치 않는 사랑으로 우리를 품어주시는 생명의 근원이십니다."
    overlap = "사랑으로 우리를 품어주시는 생명의 근원이십니다."  # 25자 → 매칭
    curr = overlap + " 우리가 절대적인 신앙으로 하나 되어 그 말씀을 가슴에 새길 때 비로소 참된 길을 걸어갈 수 있습니다."
    n = overlap_length(prev, curr)
    assert n == len(overlap)


def test_overlap_length_below_threshold_returns_zero():
    # 19자 일치 — 우연 매칭 임계값 (20) 미만이라 0 반환.
    prev = "참부모님은 영원한 사랑이십니다."
    curr = "참부모님은 영원한 사랑입니다. 다른 본문 내용이 충분히 길어야 합니다 50자 이상."
    # 두 문장 시작이 "참부모님은 영원한 사랑" (10자) 정도만 일치 → 임계 미만.
    n = overlap_length(prev, curr)
    assert n == 0


def test_overlap_length_no_match_returns_zero():
    prev = "전혀 다른 문장입니다."
    curr = "완전히 별개의 새로운 문장이 시작됩니다. 길이는 충분히 길게 만들어 잔존 가드도 통과합니다."
    assert overlap_length(prev, curr) == 0


def test_overlap_length_residue_guard_protects_short_chunk():
    # 거의 전체가 prev suffix 와 일치 → 잔존 < 50자 → dedup 포기.
    prev = "이 문장 전체가 다음 청크의 거의 전부와 일치합니다 짧은 청크 보호 시나리오"
    curr = "이 문장 전체가 다음 청크의 거의 전부와 일치합니다 짧은 청크 보호 시나리오 끝"
    # 매칭은 가능하지만 잔존이 "끝" 한 글자뿐 → 0 으로 거부.
    assert overlap_length(prev, curr) == 0


def test_normalize_for_merge_nfd_to_nfc():
    nfd = unicodedata.normalize("NFD", "참부모님")
    assert nfd != "참부모님"  # NFD 는 자모 분리 형태
    assert normalize_for_merge(nfd) == "참부모님"  # NFC 통일


def test_normalize_for_merge_crlf_to_lf():
    assert normalize_for_merge("줄1\r\n줄2\r\n") == "줄1\n줄2\n"


def test_merge_with_dedup_typical_overlap():
    # 양쪽 모두 임계값(20자) 이상의 suffix-prefix 일치 — overlap=150 자 시뮬레이션.
    before_overlap = "참부모님은 영원히 변치 않는 사랑으로 우리를 품어주시는 생명의 근원이십니다."  # 39자
    after_overlap = "참된 구원의 길을 걸어갈 수 있음을 우리는 기억해야 합니다."  # 30자

    before = "기준은 하늘부모님 섭리의 중심축이자 인류 구원의 길입니다. " + before_overlap
    main = (
        before_overlap
        + " 그 말씀을 가슴에 새길 때 비로소 "
        + after_overlap
    )
    after = (
        after_overlap
        + " 식구님의 삶에 하늘부모님과 참부모님의 축복이 가득하시길 빕니다 그리고 평안과 행복이 항상 함께하시기를 진심으로 기원합니다 모든 가정에."
    )

    result = merge_with_dedup(main_text=main, before=[before], after=[after])

    # 양쪽 overlap 영역이 각각 한 번만 등장
    assert result.merged_text.count(before_overlap) == 1
    assert result.merged_text.count(after_overlap) == 1
    # 메인 핵심 본문 (overlap 사이 텍스트) 가 정확히 1회
    assert result.merged_text.count("그 말씀을 가슴에 새길 때") == 1
    # main_offset 범위가 메인 청크 핵심 본문을 포함
    main_segment = result.merged_text[result.main_offset_start:result.main_offset_end]
    assert "그 말씀을 가슴에 새길 때" in main_segment


def test_merge_with_dedup_no_overlap_concatenates_with_space():
    before = "이전 청크 본문입니다 50자 이상 충분히 길게 만든 문장 첫 번째."
    main = "메인 청크 본문은 별도 내용 50자 이상 충분히 길게 만든 두 번째 문장."
    after = "다음 청크 본문은 또 다른 내용 50자 이상 충분히 길게 만든 세 번째."

    result = merge_with_dedup(main_text=main, before=[before], after=[after])

    # 매칭 없음 — 모든 청크가 그대로 등장
    assert before in result.merged_text
    assert main in result.merged_text
    assert after in result.merged_text
    # 메인 위치 정확
    assert (
        result.merged_text[result.main_offset_start:result.main_offset_end].strip()
        == main
    )


def test_merge_with_dedup_main_only():
    main = "메인 청크 단독 — before/after 가 모두 비어있는 첫/마지막 청크 케이스."

    result = merge_with_dedup(main_text=main, before=[], after=[])

    assert result.merged_text == main
    assert result.main_offset_start == 0
    assert result.main_offset_end == len(main)


def test_merge_with_dedup_empty_input():
    result = merge_with_dedup(main_text="", before=[], after=[])

    assert result.merged_text == ""


def test_merge_with_dedup_skips_empty_strings():
    # before 에 빈 문자열이 섞여 들어와도 안전.
    main = "메인 청크 본문 내용입니다 충분히 길게 만든 50자 이상의 본문 텍스트."
    after = "다음 청크 본문 내용입니다 충분히 길게 만든 50자 이상의 본문 텍스트."

    result = merge_with_dedup(main_text=main, before=["", ""], after=[after])

    assert main in result.merged_text
    assert after in result.merged_text


def test_merge_with_dedup_preserves_main_after_left_dedup():
    # 메인 앞부분 일부가 before 와 겹쳐 잘려도 메인 핵심 본문은 보존되어야 한다.
    overlap = "겹치는 영역 한 50자 정도 내용이 인접 청크 사이에 공유됩니다 추가 글자."
    before = "이전 청크 본문 시작부터 충분히 긴 내용이 채워집니다 " + overlap
    main = overlap + " 메인 핵심 본문은 보존되어야 합니다 잔존 가드 50자 이상 보장 케이스 추가 본문."

    result = merge_with_dedup(main_text=main, before=[before], after=[])

    # 메인 핵심 본문 전체가 살아있음
    assert "메인 핵심 본문은 보존되어야 합니다" in result.merged_text
    # main_offset 가 메인 영역을 가리킴
    main_seg = result.merged_text[result.main_offset_start:result.main_offset_end]
    assert "메인 핵심 본문은 보존되어야 합니다" in main_seg
