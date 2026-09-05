# dev-log 35 — R2 Vertical Slice: `system_prompt` 동적 주입 PoC

- **작성일**: 2026-04-25
- **브랜치**: `feat/r2-vertical-slice-system-prompt`
- **관련**: §23 R5 Vertical Slice 원칙, `sleepy-sleeping-summit.md` §10 R2

## 1. 문제

`ChatbotConfig.system_prompt` 는 DB 필드로 존재(`backend/src/chatbot/models.py:22`)하고 관리 API로 값을 저장할 수 있지만, 실제 답변 생성은 `backend/src/chat/prompt.py` 의 하드코딩 `SYSTEM_PROMPT` 만 사용. 즉 **admin 화면에서 바꿔도 답변은 변하지 않는 유령 설정**. R2 리팩토링의 핵심 약속이 작동하지 않음을 실증하는 가장 작은 지점.

## 2. 변경

1. `chat/prompt.py` — `DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT` alias 추가 (후방 호환)
2. `chat/generator.py` — `generate_answer(query, results, *, system_prompt: str | None = None)`. `None`/빈값 → `DEFAULT_SYSTEM_PROMPT` fallback
3. `chat/stream_generator.py` — `generate_answer_stream(..., *, system_prompt)` 동일 패턴
4. `chatbot/service.py` — `get_system_prompt(chatbot_id: str | None) -> str` 메서드 신설. chatbot_id=None 또는 config 부재 또는 빈 필드 → `""` 반환 (404 raise 하지 않음: Vertical Slice 안전장치)
5. `chat/service.py` process_chat / process_chat_stream — `await self.chatbot_service.get_system_prompt(request.chatbot_id)` 호출 후 generator 에 전달

단위 테스트 9건:
- `tests/test_generator_dynamic_prompt.py` 5건(generator 3 + stream_generator 2)
- `tests/test_chatbot_system_prompt.py` 4건(None id / missing / blank / custom)

## 3. 스코프 제한

- `persona_name`, `search_tiers.dictionary_enabled` 는 이번 PR 스코프 외
- R2 본 리팩토링에서 `ChatbotRuntimeConfig` Pydantic 모델로 일괄 승격
- `get_search_config` 3-tuple 을 4-tuple로 확장하지 않음 — 기존 호출부 영향 0 유지. 대신 독립 메서드 `get_system_prompt` 로 분리.

## 4. 롤백 안전성

- `system_prompt` 가 빈 문자열(기본값)이면 generator 에서 `DEFAULT_SYSTEM_PROMPT` fallback → 기존 동작 100% 동일
- 기존 챗봇 설정 row 들의 `system_prompt` 기본값이 `""` 이므로 별도 마이그레이션 불필요
- 원복: `chat/service.py` 두 호출부 + generator/stream_generator 시그니처 + `chatbot/service.get_system_prompt` + `prompt.DEFAULT_SYSTEM_PROMPT` alias 를 되돌리는 단일 revert 커밋으로 가능

## 5. 실증된 R2 약속

- DB 값 → service → generator → Gemini 호출 `system_instruction` 까지 **실제로 전달됨**이 단위 테스트로 확인됨
- R2 전체 리팩토링의 핵심 흐름(`ChatbotConfig` 유령 설정 해소)이 작동함을 최소 비용으로 증명

## 6. 검증

- `cd backend && uv run pytest tests/test_generator_dynamic_prompt.py tests/test_chatbot_system_prompt.py -v` → 9 passed
- `cd backend && uv run pytest` 전수 → **361 passed, 1 xfailed** (기존 352 + 신규 9). 기존 테스트 회귀 0건.

## 7. 후속 (staging 이후)

- 별도 챗봇 설정 2개(기본 SYSTEM_PROMPT / 커스텀 "짧고 간결히") 생성
- #5 baseline 수집 스크립트(`quality_baseline_collect.py`)를 두 설정으로 각 200건 실행 → 답변 길이/어투 차이 측정
- R2 본 리팩토링에서 이 흐름을 `persona_name` · `dictionary_enabled` 로 확장
