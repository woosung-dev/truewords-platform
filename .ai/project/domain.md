---
paths: ["apps/api/**/*", "apps/web/**/*", "apps/admin/**/*"]
---

# 도메인 규칙 (종교 텍스트 AI 챗봇)

---

## 1. 종교 용어 처리

### 시스템 프롬프트 내 핵심 용어 (100~200개) — **[보류]**

audit 2차 (2026-05-15) P1-14: `grep -rn CORE_TERMS backend/src` 결과 0건.
`chat/prompt.py:39` 에 `[핵심 용어]` 섹션 헤더만 존재하고 100~200 개 용어
변수 자체가 코드에 미구현 — phantom finding 확정. 도메인 전문가 자문 trigger
시점까지 본 규칙은 **보류**. 그 시점에 도메인 전문가 + chat/prompt.py 함께
정비. 현재 운영 상태에선 다음 단계 코드 변경 없음.

```python
# chat/prompt.py — 보류 상태 (audit 2차 P1-14 phantom 확정)
# 현재 prompt.py 는 5모드 시스템 프롬프트 (BASE+MODE_MODULES+compose) 만 운영.
# 핵심 용어 dict 변수는 도메인 전문가 자문 후 도입.
CORE_TERMS = """
(보류 — 100~200 개 정의 미작성. 도메인 자문 trigger 대기)
"""
```

### 동적 용어 검색 (dictionary_collection) — **[보류]**

`project_terminology_blocked.md` 메모리 정책: dictionary_collection 데이터 미확보
→ 동적 주입 구현 보류 (2026-04-04 결정). 현 운영 흐름은 단일 컬렉션 + source
필터로 카테고리 구분 (`.ai/project/rag-pipeline.md` §2). 다음 두 트리거 충족 시
규칙 재발효:

1. dictionary_collection 데이터 큐레이션 완료 (외부 자료)
2. 종교 도메인 전문가 자문 + CORE_TERMS 핵심 용어 정의

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

### source 기반 필터 (Cascading Search)

챗봇 버전에 따라 `ChatbotConfig.search_tiers` JSON으로 검색 전략을 정의한다.
Payload의 `source` 필드(리스트)로 데이터를 필터링한다.

```python
# chatbot/models.py — ChatbotConfig.search_tiers 예시
{
    "tiers": [
        {"sources": ["A", "B"], "min_results": 3, "score_threshold": 0.1},
        {"sources": ["C"], "min_results": 3, "score_threshold": 0.08}
    ],
    "rerank_enabled": true,
    "query_rewrite_enabled": true
}

# search/cascading.py — Tier별 순차 검색
# Tier 1: source=["A", "B"] → 결과 부족 시 → Tier 2: source=["C"] 폴백
```

> **참고:** `book_type` 열거형은 아키텍처 설계에 계획되어 있으나 현재 미구현.
> 현재는 `source` 필드(문자열 리스트)로 카테고리를 구분한다.

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
