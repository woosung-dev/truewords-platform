# TODO

> 마지막 업데이트: 2026-04-24

## Progress Overview

```
설계/문서     ████████████████████ 100%
Backend       ███████████████████░  95%
Admin Web     ███████████████████░  95%
테스트        █████████████████░░░  86%  (282 + 25개)
인프라/배포    ██████████████████░░  90%
Flutter 앱    ░░░░░░░░░░░░░░░░░░░░   0%
데이터        ██████████░░░░░░░░░░  50%  (L+M만 적재)
보안 검증     ████████████████░░░░  80%  (레드팀 테스트 완료, 실데이터 품질 검증 남음)
```

---

## Completed

### 인프라/DevOps
- [x] 배포 인프라 — GCP Cloud Run (Backend) + Vercel (Admin) 실제 배포 완료
- [x] CI/CD — GitHub Actions (테스트 + 배포 자동화, path-based filter)
- [x] Docker Compose — PostgreSQL + Qdrant + Backend
- [x] Alembic 초기 마이그레이션 — init_db() 프로덕션 스킵

### Backend — RAG 파이프라인
- [x] 하이브리드 검색 — BM25 + Dense Vector + RRF 결합
- [x] Cascading Search — 우선순위 검색 (tier1 → tier2 fallback)
- [x] Gemini LLM Re-ranking — retrieval 50 → rerank → context 10, graceful degradation
- [x] SSE 스트리밍 응답 — `POST /chat/stream` (chunk→sources→done)
- [x] Semantic Cache — Qdrant semantic_cache 컬렉션, 유사도 0.93, TTL 7일, chatbot_id 격리
- [x] 임베딩 중복 계산 최적화 — dense/sparse 1회 계산 후 모든 티어에서 재사용

### Backend — 데이터 파이프라인
- [x] 멀티포맷 텍스트 추출 (PDF pymupdf + DOCX python-docx + TXT)
- [x] 계층적 청킹 — KSS 기반 300~500자 + parent_chunk_id
- [x] 폴더 기반 A/B source 자동 분류 + 증분 적재 + 배치 리포트

### Backend — 보안
- [x] Prompt Injection 방어 — 17패턴 감지
- [x] Rate Limiting — 20req/min/IP
- [x] 워터마킹 면책 고지 + 민감 인명 필터 (구조만, 데이터 미확보)

### Backend — 에러 핸들링 (PR #8, 2026-04-10)
- [x] 5개 예외 핸들러 (InputBlocked, RateLimit, SearchFailed, EmbeddingFailed, Unhandled)
- [x] RequestIdMiddleware — 요청 추적
- [x] ErrorResponse Pydantic 스키마
- [x] Tier-level failure isolation (cascading_search)
- [x] Cache graceful degradation (컬렉션 미존재 시)

### Backend — 버그 수정
- [x] RRF score_threshold 불일치 핫픽스 — 0.75→0.1, semantic_cache 초기화, SearchResult.source 정규화 (PR #7, 상세: `docs/dev-log/24-rrf-score-threshold-fix.md`)
- [x] configs.py 하드코딩 제거, DB single source of truth
- [x] ChatService 단일 commit 전환 + chatbot_config_id nullable 수정

### Backend — RRF 후속 조치 (2026-04-11)
- [x] DEFAULT_CASCADING_CONFIG + SearchTier + SearchTierSchema score_threshold 기본값 RRF 스케일(0.1)로 하향
- [x] `_parse_search_tiers()` 기본값 0.75→0.1 통일 + RRF 스케일 주석 명시
- [x] 빈 응답(검색 결과 0건 / "찾지 못했습니다") semantic_cache 저장 방지 가드 추가

### Admin 대시보드 (Next.js)
- [x] HttpOnly Cookie 인증 (JWT + CSRF 방어, logout/me)
- [x] 챗봇 설정 CRUD + SearchTierEditor
- [x] 데이터소스 관리 (카테고리 탭 포함)
- [x] 채팅 인터페이스 (SSE 스트리밍)
- [x] 문서 Transfer 왼쪽 패널 전체 문서 목록 재설계 (PR #10, 2026-04-11)
- [x] SearchTierEditor 점수 임계값 힌트를 RRF 스케일(0.05~0.3 권장)로 변경 + 새 티어 기본값 0.1

### Admin UI 개선 (2026-04-11)
- [x] 감사 로그 조회 페이지 — 테이블 + 페이지네이션, 기존 GET /admin/audit-logs API 활용
- [x] 관리자 계정 생성 페이지 — 설정 페이지에 계정 생성 폼, POST /admin/users API 활용
- [x] 사이드바 네비게이션 확장 — 감사 로그 + 설정 메뉴 추가
- [x] Qdrant 미등록 source 감지 배너 — 카테고리 탭에서 미등록 source 자동 감지 + 원클릭 등록 (ADR-26 후속)

### Admin UI — 업로드 덮어쓰기 경고 (2026-04-14)
- [x] Backend `GET /admin/data-sources/check-duplicate` — NFC 정규화된 volume 기준 기존 IngestionJob + Qdrant sources/chunk_count 조회
- [x] `DuplicateConfirmDialog` — 덮어쓰기 / 태그만 추가 / 취소 3분기 UX
- [x] 업로드 페이지 흐름 연결 — upload 버튼 클릭 시 중복 확인 선행
- [x] API 명세: `docs/03_api/check_duplicate.md`
- [x] **[Follow-up]** NFC/NFD 혼재 데이터 정리 마이그레이션 스크립트 — `backend/scripts/migrate_nfc_nfd_volumes.py` (dry-run 우선, 중복 그룹 감지 → canonical payload 업데이트 + 중복 포인트 삭제)
- [x] **[Follow-up]** bulk 엔드포인트 NFD → NFC 통일 — PR #24로 NFC/NFD 둘 다 매칭하도록 픽스 완료
- [ ] **[Follow-up]** `qdrant_service.remove_volume_tag`(단일)도 NFC+NFD 양쪽 매칭으로 통일 (bulk만 PR #24에서 처리됨)

### Backend — 보안 강화 (2026-04-11)
- [x] Prompt Injection 패턴 강화 — Zero-width 정규화, 패턴 7개 추가 (16→23개)
- [x] 시스템 프롬프트 보안 규칙 — 유출 방어, 컨텍스트 주입 방어, 범위 이탈 방어
- [x] 레드팀 테스트 32개 — injection 우회, 오탐, 출력 안전성, rate limit

### Backend — 검색 파이프라인 고도화 (2026-04-11)
- [x] Query Rewriting — 구어체→종교 용어 재작성, Gemini 3.1 Pro Lite, 800ms timeout, graceful degradation
- [x] 0건 Fallback — source 필터 제거 재검색 → LLM 질문 제안 두 단계
- [x] chatbot_config query_rewrite_enabled 토글 (챗봇별 ON/OFF)
- [x] SearchEvent rewritten_query 컬럼 추가
- [x] chat/service.py 파이프라인 통합 (process_chat + process_chat_stream)
- [x] Admin UI 토글 (new/edit 페이지에 Query Rewriting 체크박스)

### 테스트
- [x] Backend pytest 274개 (검색, 캐시, 채팅, 보안, 파이프라인, 스트리밍, query rewriter, fallback, 레드팀 등)
- [x] Admin Vitest 25개 (로그인, SearchTierEditor, API)
- [x] Admin Playwright E2E 12개 (로그인, 챗봇 CRUD, 인증 가드)

### 문서/품질
- [x] Docstring 체계화 — chat/service, search/cascading, search/hybrid, pipeline/ingestor (PR #9, 2026-04-11)
- [x] Git 브랜치 전략 문서화 (2026-04-11)
- [x] 아키텍처 설계 문서 9개 완료
- [x] Superpowers plans/specs 8+8개

---

## Blocked

- [ ] **종교 용어 사전 동적 주입** — 대사전 데이터 미확보 [데이터 수급 필요]
- [ ] **민감 인명 필터 구체화** — SENSITIVE_PATTERNS 목록 비어있음 [도메인 전문가 협의 필요]
- [ ] **멀티테넌시** (organization_id 필터링) — 다중 조직 운영 요구사항 미확정 [확인 필요]
- [x] ~~데이터 source 라벨 체계 통일~~ — **결정 완료 (2026-04-11)**: 옵션 A "라벨은 데이터가 정한다" 채택. 실제 적재 라벨(L/M 등)을 single source of truth로 사용, 설계 문서의 A/B/C/D는 논리적 분류 예시로 격하. SearchTierEditor에서 Qdrant 실제 source 값을 동적 표시하는 방향. 상세: `docs/dev-log/26-source-label-decision.md`

---

## Questions

- Flutter 모바일 앱 시작 시점? — 레드팀 테스트 후 Phase 4에서 진행 예정
- GCP 실제 배포 시점? — 인프라 설정 파일 완료, GCP 프로젝트 생성 + 수동 설정 필요

---

## Next Actions

### 1. RRF 점수 스케일 후속 조치 (즉시)
> 상세: `docs/dev-log/24-rrf-score-threshold-fix.md` §4

- [x] `SearchTierEditor` 관리자 UI에 "RRF fusion 점수는 일반적으로 0.0~0.5 범위" 힌트/검증 추가
- [x] `backend/src/chatbot/service.py` `DEFAULT_CASCADING_CONFIG` score_threshold 기본값을 RRF 스케일(0.1)로 하향 + 주석 명시
- [x] `process_chat()`/`process_chat_stream()` 에서 검색 결과 0건 또는 "찾지 못했습니다" 응답은 semantic_cache에 저장하지 않도록 가드 추가

### 2. 레드팀 테스트 (완료)
- [x] 테스트 시나리오 작성 + 자동화 테스트 32개 (PR #13, 2026-04-11)
- [x] Prompt Injection 패턴 강화 (16→23개) + 입력 정규화
- [x] 시스템 프롬프트 보안 규칙 추가
- [ ] 답변 품질/출처 정확도 평가 (실제 데이터 확보 후)

### 3. 검색 파이프라인 고도화 (완료)
> 브랜치: `feat/query-rewriting-fallback`
> 구현 계획: `docs/superpowers/plans/2026-04-11-query-rewriting-fallback.md`

- [x] Task 1~8 전체 완료 (2026-04-11)

### 4. 임베딩 Batch API 지원 (완료)
- [x] BatchJob 모델 + 마이그레이션 + Repository
- [x] Gemini Batch API 래퍼 (제출/폴링/결과 다운로드)
- [x] Batch Service 오케스트레이션 (제출→폴링→Qdrant 적재)
- [x] Admin 설정 API (GET /admin/settings/config → gemini_tier)
- [x] Upload 모드 선택 (standard | batch), Free tier 이중 방어
- [x] Admin UI 라디오 버튼 + BatchJobList 상태 표시
- 참고: 유료 전환 후 실제 Gemini Batch API 연동 테스트 필요

### 5. A/B/C/D 데이터셋 확보 및 인제스트 (중우선순위)
- [ ] 추가 데이터 소스(A, B, C, D) 확보
- [ ] 인제스트 파이프라인으로 적재
- [ ] 다중 챗봇 버전 실제 동작 검증

### 6. Admin UI 개선 (완료)
- [x] 카테고리/태그 관리 UI — 이미 구현 완료 확인
- [x] 감사 로그 / 관리자 관리 / 네비게이션 확장 (2026-04-11)
- [x] Qdrant 미등록 source 감지 배너 (ADR-26 후속)
- [x] SearchTierEditor 점수 범위 힌트 UI

### 7. Flutter 모바일 앱 (저우선순위, Phase 4)
- [ ] 레드팀 테스트 완료 후 착수
- [ ] MVP 3개 화면: 채팅(SSE), 챗봇 선택, 설정/온보딩
- [ ] Feature-First + Riverpod + go_router + freezed

### 8. Growth Phase 기능 (저우선순위)
- [ ] 일일 묵상 카드 (M-02)
- [ ] Streak 트래커 (M-03)
- [ ] Agentic RAG
- [ ] 단계적 공개 (Staged Rollout)

### 9. 아키텍처 리팩토링 선행 작업 (2026-04-24 착수)
> 플랜: `~/.claude/plans/sleepy-sleeping-summit.md` (v4.1)
> 브랜치: `refactor/runtime-config-prep`
> 관련 dev-log: `docs/dev-log/25-sdk-survey-genai-qdrant.md`

- [x] **선행 #1 SDK 실측** — google-genai 1.68 HttpRetryOptions + qdrant-client 1.17 payload_schema (커밋 `fb9feb2`, Δ 6건 정밀화)
- [ ] **선행 #2 Staging 환경 분리** — Qdrant staging 컬렉션 / PG staging schema / Vercel preview 연결 [인프라 준비 필요]
- [ ] **선행 #3 운영 Qdrant 1,000건 payload dry-run** — R3 Payload 통일 전 schema drift 사전 확인
- [ ] **선행 #4 Alembic advisory lock + batch backfill PoC** — §19.11 / §21.8 기반
- [ ] **선행 #5 품질 게이트 기준선 수집** — 200건 실제 질문 답변 품질 측정 (Q2 과제)
- [ ] R2 ChatbotRuntimeConfig 승격 (§17 / §21)
- [ ] R3 Payload 통일 + Collection Resolver
- [ ] R1 Pipeline Stage + Strategy Protocol (God Object 분해)
- [ ] v4.1 스팟 패치 N2(DI 스코프) / N3(FSM force_transition) / N4(Alembic rollback) / N7(Legacy 태그)
