"""출력 안전 레이어 — 면책 고지, 민감 인명 필터, 답변 범위 검증."""

import re

# 모든 AI 답변에 반드시 포함 (생략 불가)
DISCLAIMER = "이 답변은 AI가 생성한 참고 자료이며, 신앙 지도자의 조언을 대체하지 않습니다."

# audit P0-1 (2026-05-15) 자동선택 (b) — PoC 기본 PII 패턴 우선.
# 도메인 (통일교/가정연합) 내부 민감 인명·사건 패턴은 도메인 전문가 자문 별도 trigger 후
# 확장한다 (memory `project_terminology_blocked.md` 정책과 동일 — 신학적 정확성 보장 필수).
# 본 PoC 패턴은 한국 개인정보 표준 형식 — false positive 위험이 낮은 것만.
_PII_GUIDANCE = (
    "식구님, 답변에 개인정보로 보이는 형식이 포함될 가능성이 감지되어 "
    "안전 정책으로 응답을 중단했습니다. 같은 질문을 다른 표현으로 다시 "
    "여쭤봐 주시거나, 소속 교회·담당 부서로 문의해 주세요."
)
SENSITIVE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # 주민등록번호: 6자리-1234567 (앞 6자리 yymmdd + 뒤 7자리, 두번째 자리는 1~4)
    (re.compile(r"\b\d{6}-[1-4]\d{6}\b"), _PII_GUIDANCE),
    # 한국 휴대전화: 010|011|016|017|018|019 - 3~4자리 - 4자리 (- 또는 공백 허용)
    (re.compile(r"\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b"), _PII_GUIDANCE),
    # 카드번호: 4-4-4-4 그룹 (- 또는 공백 허용). 16자리 본문 등장 매우 드묾.
    (re.compile(r"\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b"), _PII_GUIDANCE),
    # audit 2차 S-6 (2026-05-15, Codex round-1 P1 9/10): 결정 로그 (`dev-log/57:27`)
    # 가 "이메일/주소" 도 PoC 패턴이라 명시했지만 실제 구현은 3종뿐이었던 drift fix.
    # 이메일: RFC822 단순 형식 (사용자 게시판 보호 충분).
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}\b", re.IGNORECASE), _PII_GUIDANCE),
    # 한국 주소 (보수적): 시/도 + 시/군/구 + 동/읍/면 동시 등장 시만 매칭.
    # "서울 강남구 역삼동" / "경기 수원시 영통구" 등 광역 매칭. false positive 위험을
    # 낮추기 위해 시/도 prefix + 행정구역 suffix 둘 다 강제. 단순 "역삼동" 만으로는
    # 매칭 X (말씀 본문 안 종교적 지명 보호).
    (
        re.compile(
            r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|"
            r"전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|도|특별자치도)?"
            r"[\s,]+[가-힣]{2,10}(?:시|군|구)[\s,]+[가-힣]{2,10}(?:동|읍|면|로|길)"
        ),
        _PII_GUIDANCE,
    ),
]


def filter_sensitive_names(answer: str) -> str:
    """민감 인명/사건 언급 필터링. 감지 시 가이드라인 메시지로 대체."""
    for pattern, guidance in SENSITIVE_PATTERNS:
        if pattern.search(answer):
            return guidance
    return answer


def append_disclaimer(answer: str) -> str:
    """면책 고지 추가. 이미 포함된 경우 중복 추가하지 않음."""
    if DISCLAIMER in answer:
        return answer
    return f"{answer}\n\n---\n_{DISCLAIMER}_"


async def apply_safety_layer(answer: str) -> str:
    """출력 안전 레이어 오케스트레이션.

    순서:
    1. 민감 인명 필터링
    2. 면책 고지 추가
    """
    answer = filter_sensitive_names(answer)
    answer = append_disclaimer(answer)
    return answer


# audit 2차 S-1 (2026-05-15): sentence terminator 검출 정규식.
# 영문 (`.`, `!`, `?`), 한국어 (`다.`, `요.`, `죠.`, `네.`, `습니다.`, `다!`, `다?`),
# 줄바꿈, 일본어 (`。`) 종지부. PII 가 sentence 안에 완성되기 전엔 release X.
_SENTENCE_TERMINATOR = re.compile(
    r"(?:[다요죠네까]\.)|(?:[.!?。]\s)|(?:[.!?。]$)|\n"
)


class StreamingSanitizer:
    """SSE chunk 단위 sensitive-pattern 차단기 (P0-9 + audit 2차 S-1).

    SSE 의 streaming chunk 는 SafetyOutputStage 가 동작하기 전 사용자에게 도달한다.
    이 클래스가 chunk 별로 SENSITIVE_PATTERNS 를 점검해 매칭 시 즉시 abort 하고
    guidance 메시지를 한 번만 release. 이후 chunk 는 모두 무시.

    audit 2차 S-1 (2026-05-15, Codex E P1 8/10): 기존 max_buffer=200 만 보유하면
    PII 패턴이 buffer 의 앞쪽 (200자 prefix) 에 도달한 뒤 abort 되어도 prefix 가
    이미 사용자에게 노출. 본 fix 는 **sentence-level holdback** — buffer 안에서
    마지막 sentence terminator 까지만 release 하고 나머지는 보유. PII 가 sentence
    내에서 완성되기 전엔 release X. terminator 없이 buffer 가 ``max_buffer`` 초과
    시에만 (긴 sentence) hard release 로 fallback (UX 보장 — 영원히 stall 방지).

    ``SENSITIVE_PATTERNS`` 가 빈 리스트면 즉시 pass-through. PoC 운영 상태와 기존
    stream UX (chunk-단위 즉시 release) 호환. 패턴이 채워지는 순간에만 sentence-
    level 버퍼링 + abort 가 실제 동작한다.
    """

    def __init__(
        self,
        patterns: list[tuple[re.Pattern[str], str]] | None = None,
        max_buffer: int = 200,
    ) -> None:
        self._patterns = patterns if patterns is not None else SENSITIVE_PATTERNS
        self._max_buffer = max_buffer
        self._buffer = ""
        self._aborted = False

    @property
    def aborted(self) -> bool:
        return self._aborted

    def feed(self, chunk: str) -> str:
        """다음 chunk 를 받아 sentence-level holdback 정책으로 안전한 prefix 만 release.

        패턴 매칭 시 ``aborted=True`` 로 전이 후 guidance 메시지를 반환. 그 다음
        호출은 항상 빈 문자열을 돌려준다. caller 는 guidance 를 사용자에게 한 번
        release 한 후 stream 소비를 중단해야 한다 (대체 메시지 노출 + 이후 raw
        chunk 차단).

        Release 정책 (audit 2차 S-1):
        1. 전체 buffer 패턴 검사 — 매칭 시 abort + guidance 반환.
        2. buffer 안 마지막 sentence terminator 까지 release, 나머지는 보유.
        3. terminator 없고 buffer ≤ max_buffer → 보유 (return "").
        4. terminator 없고 buffer > max_buffer → hard release (UX fallback, 1
           sentence 가 200자 넘으면 어쩔 수 없이 안전성 < UX 절충).
        """
        if self._aborted:
            return ""
        if not self._patterns:
            return chunk
        self._buffer += chunk

        # 1. 패턴 검사 (전체 buffer — chunk 경계 PII 도 catch)
        for pattern, guidance in self._patterns:
            if pattern.search(self._buffer):
                self._aborted = True
                self._buffer = ""
                return guidance

        # 2. sentence terminator 검색 — 마지막 매칭 위치까지 release.
        last_end: int | None = None
        for match in _SENTENCE_TERMINATOR.finditer(self._buffer):
            last_end = match.end()
        if last_end is not None:
            released = self._buffer[:last_end]
            self._buffer = self._buffer[last_end:]
            return released

        # 3-4. terminator 없음 — max_buffer 까지 보유, 초과 시 hard release.
        if len(self._buffer) <= self._max_buffer:
            return ""
        release_len = len(self._buffer) - self._max_buffer
        released = self._buffer[:release_len]
        self._buffer = self._buffer[release_len:]
        return released

    def flush(self) -> str:
        """남은 buffer 를 release. abort 후, 또는 패턴 없는 pass-through 후엔 빈 문자열.

        audit 2차 S-1: flush 진입 시점에도 패턴 재검사 — generation 끝났을 때 마지막
        sentence 가 sentence terminator 없이 buffer 에 남아 있어도 abort 가능 (Codex
        round-2 의 P2 finding "flush 패턴 재검사 누락" 부수 fix).
        """
        if self._aborted or not self._patterns:
            return ""
        tail = self._buffer
        self._buffer = ""
        # flush 시점 마지막 패턴 검사 (sentence terminator 부재 sentence 의 tail PII)
        for pattern, guidance in self._patterns:
            if pattern.search(tail):
                self._aborted = True
                return guidance
        return tail
