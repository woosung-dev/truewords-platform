---
paths: ["backend/**/*", "admin/**/*"]
---

# 도메인 규칙 (종교 텍스트 AI 챗봇)

---

## 1. 종교 용어 처리

### 시스템 프롬프트 내 핵심 용어 (100~200개)

가장 중요한 핵심 용어는 시스템 프롬프트에 직접 삽입하여 LLM이 항상 참조하도록 한다.

```python
# chat/prompt.py
CORE_TERMS = """
다음은 핵심 종교 용어 정의입니다. 답변 시 이 정의를 기준으로 하세요:
- 축복: 참부모님으로부터 받는 결혼 축복식...
- 천일국: 하늘 부모님 아래 하나된 가정의 나라...
- 효정: 하늘 부모님을 향한 자녀의 효심과 정성...
(100~200개 핵심 용어)
"""
```

### 동적 용어 검색 (dictionary_collection)

시스템 프롬프트에 포함되지 않은 용어는 질문에서 감지 시 `dictionary_collection`에서 동적 검색하여 컨텍스트에 주입한다.

```python
async def inject_term_definitions(question: str, detected_terms: list[str]) -> str:
    """감지된 용어의 정의를 검색하여 프롬프트에 추가"""
    definitions = []
    for term in detected_terms:
        result = await search_dictionary(term)
        if result:
            definitions.append(f"- {term}: {result.payload['definition']}")

    if definitions:
        return "추가 용어 정의:\n" + "\n".join(definitions)
    return ""
```

---

## 2. 보안 가드레일

### 2.1 입력 검증 (Prompt Injection 방어)

```python
# 모든 사용자 입력은 sanitize 후 파이프라인에 전달
BLOCKED_PATTERNS = [
    r"ignore previous",
    r"시스템 프롬프트",
    r"너의 지시사항",
    # ... 악의적 패턴 DB에서 로드
]

async def validate_input(question: str) -> bool:
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, question, re.IGNORECASE):
            return False
    return True
```

### 2.2 출력 안전

- **답변 워터마킹**: 모든 AI 답변에 "이 답변은 AI가 생성한 것이며..." 고지문 자동 삽입
- **민감 인명 필터**: 특정 인명/사건 언급 시 사전 정의된 가이드라인 답변 제공
- **답변 범위 제한**: AI는 말씀 **해석**이 아닌 말씀 **인용**에 집중

```python
DISCLAIMER = "이 답변은 AI가 생성한 참고 자료이며, 신앙 지도자의 조언을 대체하지 않습니다."

async def apply_safety_layer(answer: str) -> str:
    """Safety Layer: 모든 답변에 적용"""
    answer = filter_sensitive_names(answer)
    answer = enforce_citation_style(answer)
    return f"{answer}\n\n---\n_{DISCLAIMER}_"
```

### 2.3 Rate Limiting

- IP/사용자별 분당 요청 수 제한
- 이상 패턴 탐지 (대량 크롤링, 반복 악의적 질문)
- 자동 차단 + 로그 기록

---

## 3. 다중 챗봇 버전

### Payload 기반 필터

챗봇 버전에 따라 검색 대상 데이터를 필터링한다.

```python
CHATBOT_FILTERS = {
    "말씀선집_only":     {"book_type": "malssum"},
    "어머니말씀_only":   {"book_type": "mother"},
    "말씀선집+원리강론": {"book_type": ["malssum", "wonri"]},
    "전체":             {},  # 필터 없음
}

def get_filter_for_chatbot(chatbot_id: str) -> dict:
    return CHATBOT_FILTERS.get(chatbot_id, {})
```

### book_type 열거형

```python
from enum import StrEnum

class BookType(StrEnum):
    MALSSUM = "malssum"     # 말씀선집
    MOTHER = "mother"       # 어머니 말씀
    WONRI = "wonri"         # 원리강론
    DICT = "dict"           # 대사전
```

---

## 4. 답변 면책 고지

모든 AI 답변에 면책 고지를 **반드시** 포함한다. 생략 불가.

- 텍스트 답변: 하단에 면책 문구
- 스트리밍 답변: 마지막 청크에 면책 문구
- 프론트엔드: UI 고정 영역에 상시 표시

---

## 5. 단계적 공개 전략

```
Phase 1: 검색 기능만 (원문 표시, AI 해석 없음) → 리스크 최소
Phase 2: 내부 레드팀 대상 AI 답변 베타
Phase 3: 인증된 사용자 대상 제한 공개
Phase 4: 전체 공개
```

각 Phase에서 로그 분석 후 다음 단계로 진행한다.
