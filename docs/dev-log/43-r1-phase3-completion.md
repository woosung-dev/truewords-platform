# Dev-log 43 — R1 Phase 3 완료 + N3 FSM + N7 Legacy 태그

- **작성일**: 2026-04-26
- **상위**: dev-log 42 의 deploy 복구 후속 — 본 세션은 코드 리팩토링 마무리.
- **연관**: dev-log 35~37 (R2), dev-log 38 (R3), dev-log 42 (deploy + 메타 학습), 메인 플랜 §22.7 (N3) / §19.13 (session version-aware).

---

## 1. 본 세션 목표 + 결과 요약

### 목표
PR #57~#60 머지 후 잔존하던 3가지를 한 브랜치에 묶어 마무리:
1. **R1 Phase 3** — service.py 의 inline 코드 (embedding / cache check / runtime_config) Stage 분리
2. **N7 (pipeline_version)** — SessionMessage 컬럼 추가 + PersistStage v=2 + Repository version-aware 조회
3. **N3 (PipelineState FSM)** — Stage 간 사전조건 검증 + force_transition_to (스트림 비정상)

### 결과 (브랜치 `refactor/r1-phase3-stages`, 10 commits)

| PR | Commit 수 | 신규 테스트 | 회귀 |
|----|---------|-----------|------|
| PR-A (R1 Phase 3) | 4 | 9 (Embedding 2 + RuntimeConfig 2 + CacheCheck 5) | 47 → 49 |
| PR-B (N7) | 3 | 5 (PersistVersion 2 + RepositoryVersion 3) | 49 → 54 |
| PR-C (N3) | 4 (C3+C4 묶음) | 14 (state 4 + transitions 8 + abort 2) | 54 → 68 |
| **누적** | **10** | **28** | **434 → 448 passed** |

service.py: **273줄 → 254줄** (Stage 분리 + DRY 헬퍼 + import 정리), 모든 PR 커밋이 머지 후에는 R1 리팩토링 100% 완료.

---

## 2. 결정 + 트레이드오프 (auto mode)

### 2.1 CacheCheckStage 옵션 A (early return 책임 service.py 잔존)

cache hit 시 SafetyLayer 적용 + 메시지 저장 + ChatResponse|SSE yield 까지 inline 으로 유지. Stage 는 `ctx.cache_hit / ctx.cache_response` 만 set.

**대안 (B)**: cache hit 시 후속 Stage 들이 silent skip — Stage Protocol 분기가 11개 stage 모두에 추가됨.

**선택 사유**: 옵션 A 가 단순. mini-persist 가 service.py 에 잔존하는 것은 트레이드오프 — Phase 4 에서 `CacheHitPersistStage` 분리 가능. "완벽보다 진행" 원칙.

### 2.2 N3 PipelineState 1차 = 로깅 전용

사전조건 미충족 시 `logger.warning` 만 발생, 강제 차단 (raise) 없음. 테스트는 caplog 으로 검증.

**대안**: 사전조건 미충족 시 raise → Stage chain breakage 가능.

**선택 사유**: 점진 강화 가능. 1차는 관찰성 baseline 만 확보. 운영 데이터 수집 후 강제 차단 도입 결정.

### 2.3 pipeline_version 값 = 신규 2 / backfill 1

**대안**: backfill -1 (sentinel 의미)

**선택 사유**: 1, 2 가 "v1, v2" 처럼 자연스러움. -1 보다 의미론 명확. server_default='1' 로 신규 row 가 코드 누락 시에도 v1 으로 분류 (silent bug 방지는 PersistStage 테스트가 보장).

### 2.4 Skip 항목 (다음 sprint)

- **SearchHit 타입 분리** — 선택, 시간 예산 우선
- **Admin analytics pipeline_version 필터** — 운영 분석은 v2 데이터 축적 후
- **_LegacyChatService** (메인 플랜 §19.13) — pipeline_version 인프라 준비 완료, 실제 분기 라우팅은 별도 PR

---

## 3. 핵심 변경 파일

### 신규 (8 개)
- `backend/src/chat/pipeline/stages/embedding.py`
- `backend/src/chat/pipeline/stages/runtime_config.py`
- `backend/src/chat/pipeline/stages/cache_check.py`
- `backend/src/chat/pipeline/state.py` (PipelineState enum + EXPECTED_PRIOR + check_precondition + force_transition_to)
- `backend/alembic/versions/a7b2c8d4e1f0_add_pipeline_version_to_session_messages.py`
- 신규 테스트 5 개 (test_embedding_stage / test_runtime_config_stage / test_cache_check_stage / test_persist_stage_version / test_chat_repository_version / test_pipeline_state / test_pipeline_state_transitions / test_stream_abort)

### 수정 (대표)
- `backend/src/chat/service.py` — 273→254줄, _run_pre_pipeline 헬퍼, try/except (CancelledError, GeneratorExit)
- `backend/src/chat/pipeline/context.py` — cache_hit / cache_response / pipeline_state 필드 3개 추가
- `backend/src/chat/pipeline/stages/*.py` 11 Stage — check_precondition + state 갱신
- `backend/src/chat/models.py` — SessionMessage.pipeline_version
- `backend/src/chat/repository.py` — get_messages_by_session(*, pipeline_version=None)

---

## 4. 워크플로우 회고

### 잘된 점
- **TDD red→green 모든 commit 일관 적용** — 9 신규 테스트 파일 모두 RED 확인 후 GREEN.
- **검증 루프 0회 추가** — 첫 시도에서 GREEN. dev-log 42 의 메타 학습 ("Generator-Evaluator 3회 상한, GREEN 허용") 적용.
- **Δ 누적 0** — 외부 영향 없음. 기존 통합 테스트 4개 파일의 patch target 만 일괄 갱신 (sed 일괄 치환).

### 개선 여지
- **CacheCheckStage 옵션 A 의 mini-persist 잔존** — service.py 에 inline 메시지 저장 로직이 남음. Phase 4 에서 `CacheHitPersistStage` 로 분리 가능.
- **테스트 통합 vs 단위 비율** — 본 세션 신규 테스트 28건 중 단위 25건, 통합 3건. 통합 테스트 mock 구성이 복잡 (search.get_async_client patch target 등) → conftest 에 공통 fixture 추가 검토.
- **alembic --sql 검증 한계** — 기존 1ee1295dc7f4 migration 의 inspect(bind) 호출 때문에 offline SQL 모드 작동 불가. migration 파일 자체는 import 검증으로 대체.

---

## 5. 다음 우선순위

### 즉시 (본 PR 머지 후)
1. **운영 alembic 적용** — `alembic upgrade head` (a7b2c8d4e1f0). 사용자 승인 후.
2. **운영 검증** — chat smoke + Cloud Run revision 확인 + grep `pipeline_version=2` 신규 메시지 확인.
3. **4/29 private 복귀** — GitHub Insights Traffic 캡처 후 `gh repo edit --visibility private`.

### 다음 sprint
1. **dogfooding** — 종교 도메인 SME 테스트, RAG 답변 품질 정성 평가.
2. **Flutter Mobile MVP** (Phase 4) — 사전 조사 완료, 미착수.
3. **선택 사항**: SearchHit 타입 분리 / Admin analytics pipeline_version 필터 / _LegacyChatService.

---

## 6. 메타 학습

- **"브랜치 위 commit 자율" 원칙** (`feedback_commit_autonomy.md`) 이 본 세션 효율의 핵심. push/PR 만 사용자 승인 받고, 10 commit 까지 자율 진행. 사용자가 매 commit 마다 승인 요청받았으면 흐름이 끊겼을 것.
- **plan 단계의 보수적 default + 대안 기록** 이 auto mode 에서 작동. 모호한 결정 (CacheCheckStage 옵션 A vs B, FSM 로깅 vs 차단, pipeline_version 값) 모두 plan 에 사전 기록 + dev-log 에 사유.
- **단일 브랜치 누적 (사용자 선택 옵션 2)** 가 review surface 비용 감수 + push 마찰 0 으로 빠르게 진행. 단점: PR 1개에 10 commit, review 가 길어짐. 대안은 stacked PRs (a → b → c) 인데 GitHub UI 가 미흡 — 다음 세션에서 검토.
