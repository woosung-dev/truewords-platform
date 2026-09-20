"""훈독 편성 후보 추출 — 추출형(extractive) 순수 로직 (API-HD-012, PLAN-HD-003).

이 모듈은 **문장을 만들지 않는다.** Qdrant 의 원문 청크를 그대로 고르고 다듬어
편성 폼이 쓸 수 있는 모양으로 바꾸기만 한다. 생성 LLM 호출이 없으므로 교리 왜곡
경로가 원천적으로 없다 — 편성자가 보는 본문은 항상 코퍼스의 원문이다.

규칙 출처(중복이 아니라 의도적 재사용):
- 카드 적합성·출처 라벨·권 정리: `scripts/extract_malssum_candidates.py` (큐레이션 1단계)
- 제목·화자 제안: `scripts/seed_daily_readings.py`
두 스크립트는 오프라인 도구라 앱 패키지에서 import 할 수 없어 규칙만 옮겨 왔다.
"""

import re

from app.modules.search.hybrid import SearchResult

# source 키 → 읽기 쉬운 출처 이름 (pipeline/metadata.py 카테고리 매핑 기준)
SOURCE_LABELS: dict[str, str] = {
    "B": "어머님 말씀",
    "M": "3대 경전",
    "N": "자서전",
    "O": "말씀선집",
    "L": "원리강론",
    "P": "참부모론",
    "Q": "통일사상요강",
}

# 카드용 완결 본문만 — 페이지 인용 조각·파일명 leak 제외, 한국어 문장 종결로 끝나야 함.
_PAGE_REF = re.compile(r"\(\d+-\d+")
_FILE_LEAK = re.compile(r"\.(txt|pdf|hwp)", re.IGNORECASE)
_SENT_END = re.compile(r"(다|요|까|라|죠|네|군요|십시오|하라|드립니다|아멘)[\"'’」』\)\s.!?]*$")
_VOL_EXT = re.compile(r"\.(txt|pdf|hwpx?|docx?|pptx?)$", re.IGNORECASE)


def is_card_worthy(text: str) -> bool:
    """훈독 카드에 그대로 올릴 수 있는 완결 본문인가.

    RAG 청크는 문서 중간을 자른 조각이라 그대로 쓰면 문장이 끊기거나 페이지 표기가
    섞인다. 이 판정을 통과한 것만 후보로 올린다.
    """
    t = text.strip()
    if _PAGE_REF.search(t) or _FILE_LEAK.search(t):
        return False
    return bool(_SENT_END.search(t))


def clean_volume(volume: str) -> str:
    """volume 끝의 파일 확장자 제거 (예: '천성경.pdf' → '천성경')."""
    return _VOL_EXT.sub("", volume.strip())


def suggest_title(text: str) -> str:
    """첫 문장을 제목으로 제안. 60자 넘으면 자른다.

    제안일 뿐이며 편성자가 폼에서 반드시 고칠 수 있다.
    """
    first = text.split(". ")[0].strip().rstrip(".")
    return first if len(first) <= 60 else f"{first[:59]}…"


def suggest_speaker(source_label: str) -> str:
    """출처 라벨에서 화자를 제안. 판별 불가면 라벨을 그대로 둔다."""
    if "어머님" in source_label:
        return "참어머님"
    if "아버님" in source_label:
        return "참아버님"
    return source_label


def to_candidate(result: SearchResult) -> dict:
    """SearchResult → 편성 후보 dict. 본문(`text`)은 손대지 않는다."""
    label = SOURCE_LABELS.get(result.source, result.source)
    return {
        "chunk_id": result.chunk_id,
        "text": result.text,
        "char_count": len(result.text),
        "source": result.source,
        "source_label": label,
        "work_title": clean_volume(result.volume),
        "suggested_title": suggest_title(result.text),
        "suggested_speaker": suggest_speaker(label),
        "score": result.score,
    }


def filter_results(
    results: list[SearchResult], *, min_len: int, max_len: int, limit: int
) -> list[dict]:
    """길이 범위 + 카드 적합성으로 거르고 상위 limit 건을 후보로 변환.

    `chunk_id` 가 빈 결과(legacy point)는 제외한다 — 원문 역추적이 불가능한 편성을
    만들지 않기 위해서다.
    """
    picked: list[dict] = []
    seen: set[str] = set()
    for r in results:
        if len(picked) >= limit:
            break
        text = r.text.strip()
        if not r.chunk_id or r.chunk_id in seen:
            continue
        if not (min_len <= len(text) <= max_len):
            continue
        if not is_card_worthy(text):
            continue
        seen.add(r.chunk_id)
        picked.append(to_candidate(r))
    return picked
