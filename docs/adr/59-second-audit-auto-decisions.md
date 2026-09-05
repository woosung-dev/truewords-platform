# 백엔드 2차 audit — 자동 선택 결정 기록

- 날짜: 2026-05-15
- plan: `~/.claude/plans/rules-1-eager-charm.md`
- audit: 6인 구성 (1차 5인 + 메타 2인)
- 1차 audit (PR #174) 머지 직후 baseline 정합화 후속 검토
- 통합 결과: S1 main 직행 hotfix (PR #175) + S2~S6 별도 통합 브랜치 `dev/backend-audit-2`

## 1. 6인 audit 구성

| 역할    | 모델                     | 영역                                                  |
| ------- | ------------------------ | ----------------------------------------------------- |
| Agent A | claude (general-purpose) | Stage 패턴 정합성 + 12-stage 도입 준비도              |
| Agent B | claude (general-purpose) | Pydantic V2 / SQLAlchemy 2.0 / FastAPI modern pattern |
| Agent C | claude (general-purpose) | Cross-domain boundary + 1차 보류 5건 재평가           |
| Agent D | claude (general-purpose) | 보안 / SSE / Rate / P2 backlog 우선순위               |
| Agent E | codex (gpt-5.5)          | 회귀 위험 + missed findings                           |
| Meta α  | fresh opus (컨텍스트 빈) | P0 false-positive 검증 + over-engineering 식별        |
| Meta β  | codex (gpt-5.5)          | 메타 challenge + critical gap                         |

5인 평균 산출: P0 5 / P1 30+ / P2 18+. 메타 2인이 P0 합의와 false-positive sweep 으로 우선순위 재정렬.

## 2. P0 finding 결정 표 (5건)

| ID  | finding                                                                                         | 1차 결정         | 메타 검토                  | 최종 결정                          |
| --- | ----------------------------------------------------------------------------------------------- | ---------------- | -------------------------- | ---------------------------------- |
| C-1 | `admin/data_router.py:395` `IngestionJobService.delete_by_volume_key()` 미존재 → AttributeError | Codex E P0 10/10 | 메타 β CONFIRM (본문 grep) | **반영** S1 (PR #175 commit 1c644f0) |
| C-2 | `admin/data_router.py` POST/PUT/PATCH/DELETE 8 routes verify_csrf 미적용                        | Codex E P0 9/10  | 메타 α/β CONFIRM           | **반영** S1 (PR #175 commit d2b7fea) |
| C-3 | `safety/middleware.py:10` X-Forwarded-For 미파싱 (Cloud Run rate limit 무력)                    | Agent D P0 9/10  | 메타 α/β CONFIRM           | **반영** S1 (PR #175 commit 748ac47) |
| C-4 | `safety/rate_limiter.py:13` multi-worker 가정 명시 누락                                         | Agent D P0 9/10  | docstring 이미 명시 → P1 격하 | **미반영 (S6 ADR)**                |
| C-5 | `admin/data_router.py:52` deprecated `qdrant_client` shim 사용                                  | Agent B P0 9/10  | re-export, 기능 위험 0     | **미반영 (다음 cleanup PR)**       |

### 1차 자동 선택 5건의 본 audit 영향
1차 audit 자동 선택 5건 (`57-backend-audit-auto-decisions.md`) 중 #2 SENSITIVE_PATTERNS 결정 로그가 실제 구현 (3종) 과 drift → 본 audit 에서 발견. S2 S-6 에서 결정 로그 "미구현" 정정 + 이메일/주소 패턴 추가 예정.

## 3. P1 — 메타가 새로 발견한 4건 (1차 + 2차 5인 모두 놓침)

| 신규 ID | finding                                                                       | 발견자  | 결정       | 작업 단위 |
| ------- | ----------------------------------------------------------------------------- | ------- | ---------- | --------- |
| S-4     | `common/gemini.py:56,78` chat 생성/스트림 hard timeout 부재                   | 메타 β  | **반영**   | S2        |
| S-5     | `search/query_rewriter.py:77` + `fallback.py:124,158` raw query 로그 (PII)    | 메타 β  | **반영**   | S2        |
| R-4     | `main.py:60` + `common/database.py` engine.dispose() shutdown 누락            | 메타 β  | **반영**   | S3        |
| R-5     | `common/database.py:35` `get_background_session()` dead code                  | 메타 α  | **반영**   | S3        |

메타 β single biggest production risk: **rate limit 우회 + Gemini 무한 대기 조합** — `safety/middleware.py` IP 키 왜곡 + `common/gemini.py` hard timeout 부재 → 동시 요청 시 Gemini 비용 + Cloud Run concurrency 동시 잠김.

## 4. False positive sweep (메타 합의 — 미반영)

| ID   | finding                                                          | 사유                                                      |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| X-1  | StreamGenerationStage 추출 (Agent A P1 8/10)                     | PR #174 회귀 검증 전 큰 refactor — ROI < 위험             |
| X-2  | `PipelineState.EXPECTED_PRIOR` 문자열 키 (Agent A P1 7/10)       | noise — log-only FSM 설계                                 |
| X-3  | SSE abort 후 PersistStage 진행 (Agent D P1 8/10)                 | 과장 — guidance 만 persist                                |
| X-4  | `output_filter.py` buffer 무한 성장 (Agent D P1 7/10)            | false — 200자 tail 유지                                   |
| X-5  | `ChatContext` mutable 21 필드 (Agent A P2 7/10)                  | 12-stage plan 합류 시 일괄                                |
| X-7  | `ChatbotConfigResponse from_attributes` 누락 (Agent B P1 8/10)   | ergonomics — correctness 문제 아님                        |
| X-9  | `datetime.utcnow()` 28건 → P1 격상 (Agent D)                     | P2 유지 — deprecation debt                                |
| X-10 | `_INGEST_QUEUE.put()` blocking (Codex E P1 7/10)                 | maxsize=100 운영 정상                                     |
| X-11 | `chat/pipeline/state.py:50` RetrievalGate FSM (Codex E P2)       | 12-stage 별도 plan 합류                                   |
| X-12 | alembic dual-revision risk (메타 α)                              | `alembic history` 확인 후 단순 정렬                       |

## 5. 1차 보류 5건 재평가 + 사용자 4결정

| 보류 ID  | 1차 결정      | 메타 의견                                  | 본 audit 최종 결정                                    |
| -------- | ------------- | ------------------------------------------ | ----------------------------------------------------- |
| P1-2     | 의도 보류     | 메타 α "ADR" / β "immediately fix"         | **ADR 로 닫기** (S6) — 사용자 결정 #3                 |
| P1-3     | 의도 보류     | Agent C "다음 PR" / Codex "상승 없음"      | **별도 PR** (본 plan 범위 외)                         |
| P1-10    | 보류 유지     | 모두 보류                                  | **보류 유지** ([[project_phase4_chunking_decision]])  |
| P1-11    | 별도 plan     | Agent A/C 점진 / 메타 β deferred           | **별도 plan 유지** (사용자 결정 #2)                   |
| P1-14    | 별도 trigger  | 메타 α/β "코드에 CORE_TERMS 정의 0건"      | **phantom 확정** (사용자 결정 #4)                     |

### 사용자 4결정 (Phase 3)

1. **S1 머지 경로** — main 직행 fast-track (★★★★★). S2~S6 는 별도 통합 브랜치 `dev/backend-audit-2`.
2. **P1-11 12-stage** — 별도 plan 유지 (★★★★). RetrievalGate / QueryRouting / Validation 점진 도입은 별도 plan.
3. **P1-2 이중 commit** — ADR 로 닫기 (★★★★). 같은 AsyncSession Depends 캐시 공유 가정 확인 + 명문화.
4. **P1-14 CORE_TERMS** — grep 검증 완료, phantom 확정 (★★★★★). `grep -rn CORE_TERMS backend/src` = 0건. `chat/prompt.py:39` 의 `[핵심 용어]` 섹션 헤더만 존재. 결정 로그 정정 + 룰 §1 "보류" 명시.

## 6. P2 backlog 재평가 (Agent D)

| ID    | 설명                                | 권고               |
| ----- | ----------------------------------- | ------------------ |
| P2-1  | PersistStage SRP 분할               | P2 유지            |
| P2-2  | cache_threshold 0.88 vs 룰 0.93     | drop (ADR 58)      |
| P2-3  | `Source(**s)` schema drift          | **P1 격상** (S4)   |
| P2-4  | IntentClassifier ≠ "용어 감지"      | drop               |
| P2-5  | 비대 파일 3건                       | P2 유지            |
| P2-6  | `datetime.utcnow()` 28건            | P2 유지 (메타 합의)|
| P2-7  | `Optional[X]` 4건                   | P2 유지            |
| P2-8  | `Annotated[Depends]` 0건            | drop               |
| P2-9  | scripts/tests 분류                  | drop               |
| P2-10 | Service 가 HTTPException raise      | **P1 격상** (S4)   |
| P2-11 | SSE disclaimer 중복                 | P2 유지            |
| P2-12 | doc 02 stale 0.75                   | drop (Sub-PR E)    |

## 7. S1 처리 항목 — PR #175 (main commit 3a3c14c, 2026-05-15)

- **C-1** `IngestionJobService.delete_by_volume_key()` repo 위임 + commit 추가 + 시그니처 잠금 테스트
- **C-2** `admin/data_router.py` APIRouter `dependencies=[Depends(verify_csrf)]` + `admin/dependencies.py` PATCH 화이트리스트 + `admin/src/lib/api.ts` PATCH 헤더 + CSRF PATCH 테스트 + APIRouter 잠금 테스트
- **C-3** `safety/middleware.extract_client_ip` helper 추가 (XFF 첫 토큰 우선) + `check_rate_limit` 가 사용 + `chat/reactions_router._client_ip` alias 통일 + 9 케이스 테스트

검증: backend `uv run pytest tests/` 780 passed (767→780, +13 신규, 회귀 0).

## 8. S2~S6 미처리 (별도 통합 브랜치 `dev/backend-audit-2`)

```
S2 (안전성 — Safety / 로그 / Gemini timeout)
  ├── S-1 StreamingSanitizer sentence-level holdback
  ├── S-2 invisible_chars 패턴 확장
  ├── S-3 input_validator ReDoS 정규식 atomicize
  ├── S-4 common/gemini.py asyncio.timeout + HttpOptions
  ├── S-5 search/* raw query log → request_id + hash
  └── S-6 SENSITIVE_PATTERNS 결정 로그 정정 + 이메일/주소

S3 (resilience — retry / lifespan)
  ├── R-1 gemini_client HttpRetryOptions 명시
  ├── R-2 ingestor max_attempts=3
  ├── R-3 ingest_worker lifespan + queue drain
  ├── R-4 engine.dispose() lifespan finalize
  └── R-5 get_background_session 제거

S4 (Pydantic / code health)
  ├── P-1 TierConfig frozen=True
  ├── P-2 admin/data_router raw exception 처리
  ├── P-3 datasource/repository null 갱신 정리
  ├── P-4 SQL boolean .is_(True)
  ├── P-5 SettingsConfigDict
  ├── P-6 Service HTTPException → 도메인 예외
  └── P-7 cache schema propagation rule + 테스트

S5 (boundary cleanup)
  ├── B-1 ingestion_facade 에 repo factory 추가
  ├── B-2 chatbot/router → admin facade 또는 decorator
  ├── B-3 get_main_loop common/ 이관
  ├── B-4 IngestionOrchestrator 도입
  ├── B-5 datasource → chatbot 의존 제거
  └── B-6 qdrant_client shim 5곳 src.qdrant 이관 (C-5 격하건)

S6 (룰/문서/ADR)
  ├── C-4 rate_limiter docstring 보강
  ├── P1-2 ADR (이중 commit 위험 ADR 닫기)
  ├── P1-14 CORE_TERMS phantom 검증 + 룰 §1 정정
  └── Sub-PR E 산출 룰 후속 보완 (SENSITIVE_PATTERNS 로드맵)
```

## 9. 본 audit 범위 외 (별도 작업)

- **P1-3** `chatbot.get_top_queries_for_bot` → chat 도메인 이동 (별도 PR — 호출처 1 + cron 1, 30분 작업)
- **P1-11** 청사진 12-stage 점진 도입 (RetrievalGate PoC 1 stage 부터 — 별도 plan)
- **P1-14** CORE_TERMS 100~200 확장 (도메인 전문가 자문 trigger — 코드 실체 없음 확인됨)
- **P1-10** dead chunkers — 보존 정책 ([[project_phase4_chunking_decision]] PR #92)
- **E2E smoke** (Playwright admin + /chat) — staging canary 단계

## 10. 학습 — 메타 리뷰어 가치

본 audit 가 잡은 **C-1 service 메서드 누락** 은 1차 5인 audit + 자체 회귀 테스트 (767) 가 모두 통과시킨 결함. Codex meta β 가 본문 grep 으로 confirm. **신뢰성 높은 audit 라도 self-grade 만으로는 production 결함을 잡지 못한다. 6인 audit (5+2 메타) 패턴은 메타 비용 대비 catch 효율 우월.**

opus meta α 는 P0-1 을 weak reject 했지만 codex meta β 의 본문 grep 으로 CONFIRM. **두 메타가 disagree 할 때 directly grep 한 의견 채택** — single source of truth = repository code.

다음 audit 시: 1차 audit log + 그 PR diff 를 메타에게 함께 주면 메타 효율 더 증가.
