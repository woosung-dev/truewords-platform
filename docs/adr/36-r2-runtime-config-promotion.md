# dev-log 36 — R2 ChatbotRuntimeConfig 본 리팩토링 완주

- **작성일**: 2026-04-25
- **브랜치**: `refactor/r2-runtime-config`
- **선행**: M0 dev-log 32, M3 dev-log 35 (PR #45 / #48)
- **관련**: `.claude/plans/sleepy-sleeping-summit.md` §10 R2

## 1. 변경 요지

4 commits 로 ChatbotRuntimeConfig 단일 객체 도입:

| # | 커밋 | 요약 |
|---|------|------|
| C1 | `0c2732b` | ChatbotRuntimeConfig Pydantic 모델 5종(`SearchModeConfig`, `GenerationConfig`, `RetrievalConfig`, `SafetyConfig`, `ChatbotRuntimeConfig` + `TierConfig`) 신설. frozen=True. 단위 7건. |
| C2 | `5d82fc9` | `chat/prompt.apply_persona({persona})` 헬퍼 + `ChatbotService.build_runtime_config(chatbot_id)` factory. 빈 system_prompt → `DEFAULT_SYSTEM_PROMPT` fallback, persona placeholder 치환. 단위 9건(persona 4 + factory 5). |
| C4 | `958021d` | `generate_answer / generate_answer_stream` → `generation_config: GenerationConfig` 단일 인자. `chat/service.py` rerank/query_rewrite 분기를 `runtime_config.retrieval` 경유. `query_rewriter.rewrite_query(*, enabled=True)` 토글. `DEFAULT_RUNTIME_CONFIG` + `_to_search_config` 헬퍼. M3 `system_prompt` 파라미터 제거. 5 test 파일 갱신. |
| C5 | (이번) | `ChatbotService.get_system_prompt` 제거 + `tests/test_chatbot_system_prompt.py` 삭제 (RuntimeConfig.generation.system_prompt 흡수). |

## 2. AS-IS → TO-BE

**AS-IS** (M3 직후):
```python
# chat/service.py — process_chat
search_config, rerank_enabled, query_rewrite_enabled = (
    await self.chatbot_service.get_search_config(request.chatbot_id)
)
system_prompt = await self.chatbot_service.get_system_prompt(request.chatbot_id)
# ... 분기 후
answer = await generate_answer(request.query, context_results, system_prompt=system_prompt)
```

**TO-BE** (R2 완료):
```python
# chat/service.py — process_chat
runtime_config = (
    await self.chatbot_service.build_runtime_config(request.chatbot_id)
    or DEFAULT_RUNTIME_CONFIG
)
search_config = _to_search_config(runtime_config.search)
if runtime_config.retrieval.query_rewrite_enabled:
    search_query = await rewrite_query(request.query, enabled=True)
# ... rerank 분기는 runtime_config.retrieval.rerank_enabled
answer = await generate_answer(
    request.query, context_results, generation_config=runtime_config.generation,
)
```

## 3. 호환성

- `search_tiers` JSON 구조 그대로
- 신규 컬럼 0건, Alembic migration 0건
- M3 `get_system_prompt` / `system_prompt` 파라미터 → RuntimeConfig.generation 으로 흡수 통합
- `DEFAULT_RUNTIME_CONFIG` 의 `rerank_enabled=False` / `query_rewrite_enabled=False` 가 기존 `DEFAULT_RERANK_ENABLED` / `DEFAULT_QUERY_REWRITE_ENABLED` 상수를 보존 → chatbot_id=None 케이스 동작 동일
- 빈 system_prompt → generator 측 fallback 분기 없이 build_runtime_config 단계에서 `DEFAULT_SYSTEM_PROMPT` 적용

## 4. 본 PR 스코프 외 결정 (Δ 정리)

플랜 §10.5 commit 7 "deprecate SYSTEM_PROMPT 상수" 와 commit 5 "rerank/qr toggles" 의 admin UI 변경, 그리고 본 세션에서 발견된 두 가지 내부 정리 항목은 본 PR 스코프 외로 미룬다:

- `ChatbotService.get_search_config` 제거 — `tests/test_chatbot_config.py` 가 직접 호출하는 3 케이스 의존. 본 PR에서는 service 본체에서 호출자 0건이지만 메서드는 유지.
- `ChatbotService._parse_search_config` 제거 — `tests/test_chatbot_weighted_config.py` 5 케이스 직접 호출. weighted_search 의 `score_threshold` 변환 책임을 가지며, 현재 `_to_search_config`는 그 필드를 누락하므로 잠재 회귀 위험. 별도 PR에서 weighted 변환 로직 통합 후 제거.
- `chat/router.py` 의 `Depends(get_runtime_config)` 패턴 — 플랜에서는 router-level 주입을 명시했으나 service 가 내부에서 `chatbot_service.build_runtime_config` 를 호출하는 구조(현재 상태)가 더 깔끔. router 변경 0건. 만약 R1 Phase 1 에서 RuntimeConfig 가 다른 stage 들에도 필요해지면 그 시점에 router-level 로 끌어올림.
- `chat/prompt.SYSTEM_PROMPT` alias 제거 — grep 으로 외부 import 0건 확인 후 별도 cleanup PR.
- Admin chatbot-form 에 `model_name` / `temperature` 신규 필드 노출 + Alembic 컬럼 추가 — 본 PR 스코프 외, 별도 R2 후속 PR.
- E2E "프롬프트 변경 → 답변 변화" Playwright 시나리오 — staging 프로비저닝 이후 + Vitest/Playwright 비용으로 별도 PR.

## 5. 검증

- 신규 단위 테스트: RuntimeConfig 모델 7 + apply_persona 4 + build_runtime_config factory 5 = 16건
- 갱신 테스트: `test_generator.py`, `test_generator_dynamic_prompt.py`, `test_stream_generator.py`, `test_chat_service.py` 시그니처 갱신 (회귀 0)
- 삭제: `tests/test_chatbot_system_prompt.py` 4건 (RuntimeConfig factory 테스트로 대체)
- 전수 통과 변화: 시작 398 passed → C5 후 **394 passed, 1 xfailed** (398 - 4 = 394)
- 신규 파일 1: `backend/src/chatbot/runtime_config.py` (~75줄)

## 6. R1 선결 조건 잔여

R1 Phase 1 (Pipeline Stage + Strategy Protocol) 진입 가능 여부:
- ✅ R2 완료 (이 PR)
- ❌ R3 미완 (Payload 통일 + Collection Resolver) — 다음 sprint
- §23.5 원칙 5 "R2 완료 후 1회 sprint 재검토" — PR 머지 후 사용자 확정

## 7. 관련 메모리 갱신

- `feedback_commit_autonomy.md` 신규 — 사용자가 브랜치 위 일반 커밋은 자율 진행, push/main/특별한 변경만 승인하도록 운영 규칙 변경 (2026-04-25)
- `project_refactoring_plan.md` 갱신 권장 — R2 완료 + R3 가 다음 sprint blocker 추가
