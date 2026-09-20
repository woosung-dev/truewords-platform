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

# 카드용 완결 본문만. 아래 규칙은 2026-09-20 운영 코퍼스 3,600 청크 실측으로 보강했다 —
# 종결어미만 보면 대화 조각·편집자주·기사 헤더·문장 중간 잘림이 그대로 통과한다.
_PAGE_REF = re.compile(r"\(\d+-\d+")
_FILE_LEAK = re.compile(r"\.(txt|pdf|hwp)", re.IGNORECASE)
_SENT_END = re.compile(r"(다|요|까|라|죠|네|군요|십시오|하라|드립니다|아멘)[\"'’」』\)\s.!?]*$")
_VOL_EXT = re.compile(r"\.(txt|pdf|hwpx?|docx?|pptx?)$", re.IGNORECASE)
# 편집 표기·지문: "[편집자주: …]", "[네]" 같은 대괄호가 본문에 남은 청크.
_EDITORIAL = re.compile(r"[\[\]]")
# 대화 인용 조각: 「…」 가 걸친 채 잘린 청크는 화자가 누구인지 카드에서 알 수 없다.
_DIALOG = re.compile(r"[「」『』]")
# 문장 중간에서 시작: 관형사로 쓰이지 않는 조사·어미로 시작하면 앞이 잘린 것이다
# ("의 장자라구요", "인 입장에서 승리적 기반을").
_LEADING_PARTICLE = re.compile(r"^[의을를가인]\s")
# 마크다운·노트 헤더가 남은 청크("# 천애축승자 서약식"). 행사 진행 노트이지 말씀 본문이 아니다.
_MD_HEADING = re.compile(r"^\s*#")


def is_card_worthy(text: str) -> bool:
    """훈독 카드에 그대로 올릴 수 있는 완결 본문인가.

    RAG 청크는 문서 중간을 자른 조각이라 그대로 쓰면 문장이 끊기거나 편집 표기가 섞인다.
    이 판정을 통과한 것만 후보로 올린다. 통과율은 낮다(실측 1~2%) — 그래도 편성자가
    쓰레기를 걸러 내는 시간보다 서버가 넉넉히 받아 거르는 편이 싸다.
    """
    t = text.strip()
    if _PAGE_REF.search(t) or _FILE_LEAK.search(t):
        return False
    if _EDITORIAL.search(t) or _DIALOG.search(t):
        return False
    if _LEADING_PARTICLE.search(t) or _MD_HEADING.search(t):
        return False
    # 빈 줄로 나뉘면 헤더와 본문이 한 청크에 섞인 것이다(기사 제목 + 기사 본문).
    if "\n\n" in t:
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
    seen_body: set[str] = set()
    for r in results:
        if len(picked) >= limit:
            break
        text = r.text.strip()
        if not r.chunk_id or r.chunk_id in seen:
            continue
        # 같은 말씀이 여러 권·개정본에 실려 있다. 편성자에게 같은 본문을 두 번 보여 주지 않는다.
        body_key = "".join(text.split())
        if body_key in seen_body:
            continue
        if not (min_len <= len(text) <= max_len):
            continue
        if not is_card_worthy(text):
            continue
        seen.add(r.chunk_id)
        seen_body.add(body_key)
        picked.append(to_candidate(r))
    return picked
