# dev-log 32 — v4.1 N2/N3/N7 단독 분리 가능성 조사 결론

- **작성일**: 2026-04-25
- **조사 세션**: 본 리팩토링 직전 준비 세션
- **관련**: `.claude/plans/sleepy-sleeping-summit.md` §22.7, memory `project_refactoring_plan.md`

## 1. 배경

v4.1 스팟 패치 4개 중 N4(Alembic artifact)는 PR #42에서 완결되었고, 남은 N2/N3/N7이 "R1/R2 맥락에서만 의미가 있다"는 플랜 주석이 있었다. 본 리팩토링 착수 전 이를 코드 실측으로 확정한다 — 단독 선구현 가능한 조각이 있으면 선반영하여 R1/R2 공수를 줄일 여지 확인.

## 2. 조사 방법

2026-04-25 Explore subagent로 `backend/src/` 전수 grep + 관련 모델/DI/FSM 파일 정독.

## 3. 결과

### 3.1 N2 — `@lru_cache` factory 제거 (request-scoped 확정)

- 플랜 전제: `get_persist_stage` 등 의존성 factory에 `@lru_cache` 가 붙어 있어 request-scoped 일관성이 깨진다.
- 실측: `backend/src/chat/dependencies.py:15-42` 를 포함한 chat 의존성 체인에 `@lru_cache`·`@functools.lru_cache` **사용 0건**.
- **결론**: 문제 자체가 현재 코드에 존재하지 않음. N2는 **작업 불필요**. R1 Phase 1에서 새 factory 추가 시 `@lru_cache` 금지 규칙만 코드 리뷰 체크리스트에 추가하면 충분.

### 3.2 N3 — `force_transition_to(state, reason)` (FSM 밖 이벤트 처리)

- 플랜 전제: `PipelineState.stream_status` FSM이 존재하고, cancellation/disconnect 시 검증을 우회한 전이가 필요하다.
- 실측: `PipelineState`, `stream_status`, `transition_to` 키워드 grep 결과 **0건**. 현재 `chat/service.py`는 명령형 순차 코드, FSM 설계 자체 부재.
- **결론**: N3는 R1 Phase 1(PipelineState 도입)에 **필수 의존**. 단독 선구현 불가.

### 3.3 N7 — Legacy 메시지 태깅 (`[legacy]` + 재인용 금지)

- 플랜 전제: `SessionMessage.pipeline_version` 필드가 있어 구/신 버전을 구분할 수 있다.
- 실측: `backend/src/chat/models.py:38-49` 의 SessionMessage는 `id/session_id/role/content/token_count/created_at`만 보유. `pipeline_version` 필드 **부재**. `get_session_history` 반환 딕트에도 버전 키 없음.
- **결론**: N7은 R2(preparatory migration으로 `pipeline_version` 필드 추가) 이후에만 의미. 단독 선구현 불가.

## 4. 본 리팩토링 계획에 주는 함의

- v4.1 스팟 패치 **완료 선언**은 이미 타당: N4는 PR #42에서 닫혔고 N2/N3/N7은 R1/R2 스프린트에서 각 해당 커밋과 함께 반영되면 족하다.
- R1 Phase 1 체크리스트에 추가:
  - `@lru_cache` factory 금지 (N2)
  - `force_transition_to(state, reason)` 메서드 포함 (N3)
- R2 preparatory migration 체크리스트에 추가:
  - `SessionMessage.pipeline_version` 컬럼 + `[legacy]` 태깅 규칙 (N7)

## 5. TODO 연계

`docs/TODO.md` Questions 섹션에서 "v4.1 N2/N3/N7 단독 가능?" 항목이 있으면 닫기. 없으면 Next Actions에 "R1 Phase 1 체크리스트 업데이트" 추가.
