# TODO

> 마지막 업데이트: 2026-09-05

> **현재 우선 작업:** M1~M4 모노레포 구조 전환의 구현·로컬 검증을 완료했고 PR 심사를 진행한다. 아래 기존 퍼센트·테스트 수치는 과거 제품 상태이며 이번 전환의 실행 증거가 아니다. 최신 결과는 [전환 계획 §5](plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)에 기록한다. M5·Flutter·운영 배포는 비범위다.

## Progress Overview

```
설계/문서     ████████████████████ 100%
Backend       ███████████████████░  95%
Admin Web     ███████████████████░  95%
테스트        █████████████████░░░  86%  (pytest 964 passed / 4 skipped / 1 xfailed, Vitest 113개 / 14 파일)
인프라/배포    ███████████████████░  95%  (Oracle 단일 VM, 백업 복구 리허설 PASS. push 자동배포 없음)
Flutter 앱    ░░░░░░░░░░░░░░░░░░░░   0%
데이터        ██████████░░░░░░░░░░  50%  (L+M만 적재)
보안 검증     ████████████████░░░░  80%  (레드팀 테스트 완료, 실데이터 품질 검증 남음)
```

---

## Completed

### PWA·Flutter 모노레포 전환 설계 (2026-09-05)

- [x] `ARCH-MONO-001` — 현재 admin/backend·인증·SSE·CI·Oracle 구성을 기준으로 목표 구조와 경계 작성 (`docs/architecture/2026-09-05-pwa-flutter-monorepo.md`)
- [x] `PLAN-MONO-001` — M1~M5 이전 순서·검증·운영 복구·문서 대응 계획 작성 (`docs/plans/completed/2026-09-05-monorepo-migration.md`)
- [x] Flutter 즉시 구현과 기존 데모 계정/기록 자동 이전을 범위에서 제외하고, 별도 S1 PRD의 검토 대기 상태 확인
- [x] `DEC-MONO-001` — 2026-09-05 사용자 M1~M4 구현·검증·PR 승인. 운영 배포·계정 이전·M5는 제외
- [x] 문서별 원본 SHA-256·새 위치·분류 이유 manifest 생성: 승인 계획 포함 210개 중 200개 이동·10개 유지. 기존 색인 누락 3개는 원본 미존재로 명시

### 가정연합 신규 PWA 사전 조사 (2026-08-31)
- [x] 초원AI 공식 홈페이지·블로그·App Store·Google Play·공개 화면·보조 리뷰 교차 조사 (`docs/research/2026-08-30-chowon-ai-benchmark.md`)
- [x] PWA 설치·iOS/Android Web Push·서버 스케줄링·오프라인·민감정보 제약 확인
- [x] 차별화 제품 방향, MVP/비범위, S0~S15의 16개 세션 로드맵과 후속 프롬프트 작성 (`docs/research/2026-08-30-pwa-app-direction.md`)
- [x] 출처·기능 범위 비교 차트를 포함한 자체 포함 HTML 의사결정 보고서 생성·데스크톱 1440px/모바일 390px 검증 (`docs/research/2026-08-31-chowon-pwa-strategy-report.html`)
- [x] 세션 0 승인 — FFWPU 대상, 공식 승인 전 독립 운영·비공식 제한 베타, 현 구성원·가정 우선
- [x] 세션 0 승인 — 권리 승인 소규모 정본만 사용, 잠금 화면 중립형 알림 기본

### 체험단 최종 현황 리포트 (2026-07-30)
- [x] 종료 설문·중간미션 원본과 Oracle 운영 DB를 교차 검증해 실제 이용·미션 제출 현황 HTML/PNG 생성 (`docs/dev-log/2026-07-30-beta-final-status-report.md`)
- [x] 종료 설문 제출자 14명을 대상으로 운영 DB 질문 5건·중간미션 누적 5건의 동시 충족 여부를 PNG로 생성 (12명 충족, 2명 미션 기준 미달)
- [x] 계정 명단·중간미션·실제 DB·종료 설문·5건 기준 미달자를 수록한 A4 가로형 최종 PDF 보고서 생성 (`docs/dev-log/2026-07-30-beta-final-comprehensive-report.pdf`)
- [x] 계정 파일 34명과 공식 코호트 33명의 차이, 기존 7/26 리포트와 Oracle DB 스냅샷의 2질문·1세션 차이를 산출물 주석에 기록

### 인프라/DevOps
- [x] 배포 인프라 — Oracle Cloud ARM VM 단일 노드 (admin + backend + Qdrant + PostgreSQL + Cloudflare Tunnel). 2026-07-29 GCP Cloud Run 에서 이전, 월 $42 → $0. 상세 §13
- [x] CI/CD — GitHub Actions CI(테스트, path-based filter). **배포는 `make deploy-backend` / `make deploy-admin` 수동** (Cloud Run 이탈로 push 자동배포 없음)
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
- [x] RRF score_threshold 불일치 핫픽스 — 0.75→0.1, semantic_cache 초기화, SearchResult.source 정규화 (PR #7, 상세: `docs/adr/24-rrf-score-threshold-fix.md`)
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
- [x] API 명세: `docs/specs/api/check_duplicate.md`
- [x] **[Follow-up]** NFC/NFD 혼재 데이터 정리 마이그레이션 스크립트 — `backend/scripts/migrate_nfc_nfd_volumes.py` (dry-run 우선, 중복 그룹 감지 → canonical payload 업데이트 + 중복 포인트 삭제)
- [x] **[Follow-up]** bulk 엔드포인트 NFD → NFC 통일 — PR #24로 NFC/NFD 둘 다 매칭하도록 픽스 완료
- [x] **[Follow-up]** `qdrant_service.remove_volume_tag`(단일)도 NFC+NFD 양쪽 매칭으로 통일 — bulk 경로(PR #24)와 동일 패턴 적용. search_terms 에 NFC/NFD 둘 다 + scroll 결과를 NFC 기준 재확인

### 재업로드 정책 `on_duplicate` (ADR-30, 2026-04-27)
- [x] ADR-30 — `docs/adr/30-upload-on-duplicate-mode.md`
- [x] Backend `POST /admin/data-sources/upload` `on_duplicate=merge|replace|skip` Form 파라미터 (default `merge`)
- [x] `ingestor.py` — `payload_sources` 파라미터로 chunk.source override (merge union 지원)
- [x] `_process_file_standard` — skip(COMPLETED 동일 파일이면 임베딩 생략) + merge(기존 ∪ 신규) 분기
- [x] pytest 3건 추가 (`test_payload_sources_*`) — 12 PASS, 전체 collect 452 import OK
- [x] Admin `DuplicateDecision` 4분기로 확장 (`merge`/`add-tag`/`replace`/`cancel`) + `uploadFile`이 `on_duplicate` 전달
- [x] Dialog merge 미리보기(기존 ∪ 신규) + default 권장 버튼을 "내용 갱신 (분류 유지)"로 변경

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

### 관리자 계정 비활성화 (2026-08-06)
- [x] 체험단 계정 34개 운영 DB 비활성화 — `role=ADMIN AND created_at::date='2026-07-07'`, SUPER_ADMIN 4개 보존
- [x] PATCH /admin/users/{id}/status — 활성/비활성 전환 (멱등, 본인 계정 비활성화 금지, 감사 로그)
- [x] 설정 페이지 상태 전환 UI — 확인 다이얼로그(비활성화만) + 상태 필터 + 본인 행 비활성 처리

### 테스트
- [x] Backend pytest 964 passed / 4 skipped / 1 xfailed (검색, 캐시, 채팅, 보안, 파이프라인, 스트리밍, query rewriter, fallback, 레드팀, Gemini 키 probe, 계정 상태 전환 등)
- [x] Admin Vitest 113개 / 14 파일 (로그인, SearchTierEditor, API, 모달, 차트, 설정 페이지 등)
- [x] Admin Playwright E2E 12개 (로그인, 챗봇 CRUD, 인증 가드)

### 문서/품질
- [x] Docstring 체계화 — chat/service, search/cascading, search/hybrid, pipeline/ingestor (PR #9, 2026-04-11)
- [x] Git 브랜치 전략 문서화 (2026-04-11)
- [x] 아키텍처 설계 문서 9개 완료
- [x] Superpowers plans/specs 8+8개

---

## Blocked

### 클라이언트 피드백 14건 중 보류 항목 (2026-05-09)

> 적용 항목(8건: #1·#2·#3·#6·#7·#8·#9·#11·#13)은 별도 브랜치에서 처리 완료. 아래는 의도적으로 보류한 항목들.

- [ ] **#5 Disclaimer 4줄 → 2줄 압축** — 클라이언트 컨펌 대기 [확인 필요]. 현재 4문장 footer (`DISCLAIMER_LINES` in `admin/src/app/(chat)/page.tsx`). 컨펌 후 2줄 요약본 채택.
- [ ] **#10 Admin Reactions 대시보드** — `MessageReaction` 카운트 및 부정 피드백(reason+comment) 집계 페이지 신규 구현. backend `reactions_repository.get_aggregate()` 와 `AnswerFeedback` 라벨 활용. 별도 PR.
- [ ] **#12 SSE 스트리밍 클라이언트** — 백엔드 `/chat/stream` (chunk/sources/done 3 이벤트) 이미 구현. 프론트만 `EventSource`/`fetch+ReadableStream` 클라이언트 + 취소/에러 UX 통째로 별도 PR.
- [ ] **#14 답변 퀄리티 100문항 자동 검증** — sub-agent 가 카테고리별 질문 100개 생성 → API 호출 → RAGAS/Judge 평가. 별도 트랙. 골든셋 60문항 확장과 묶어 진행.
- [ ] **#4 대표 질문 4개 답변 재검증** — `#11 cache key persona 누락 fix` 머지 후 별도 세션에서 4개 질문(`SUGGESTED_PROMPTS`) 답변 품질 수동 점검.
- [ ] **#9 좋아요 토글 백엔드 cleanup** — 현재 helpful 토글은 프론트 로컬 state 만 reset, `AnswerFeedback` row 는 누적 보존. 분석 시 (message_id, created_at desc) 후처리. 정직한 fix 는 `DELETE /chat/feedback/{message_id}` 신규 엔드포인트.

### 기존 보류 항목

- [ ] **종교 용어 사전 동적 주입** — 대사전 데이터 미확보 [데이터 수급 필요]
- [ ] **민감 인명 필터 구체화** — SENSITIVE_PATTERNS 목록 비어있음 [도메인 전문가 협의 필요]
- [ ] **멀티테넌시** (organization_id 필터링) — 다중 조직 운영 요구사항 미확정 [확인 필요]
- [ ] **RAGAS 평가 LLM 환원 — Gemini 2.5 Pro → Claude Haiku 4.5** [Anthropic 크레딧 충전 필요]
  - 현재 `backend/scripts/eval_ragas.py` + `tests/test_ragas_thresholds.py` 가 평가용 LLM 으로 Gemini 2.5 Pro 사용 (Anthropic 크레딧 잔액 부족 임시 대체).
  - 시도 이력: `gemini-3.1-pro-preview` 는 RAGAS 평가에서 RPM throttling/응답 hang 다발로 사용 불가 (5건 sanity 1회 정상 후 모든 후속 호출 hang). `gemini-2.5-pro` 로 fallback.
  - 인계 문서 §5 사전 결정은 Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — 생성=Gemini, 평가=Claude 분리로 G-Eval LLM-self-bias 회피.
  - 충전 후 작업: (1) `EVAL_LLM_MODEL = "claude-haiku-4-5-20251001"` 으로 환원, (2) `LangchainLLMWrapper` 를 `ChatAnthropic` 으로 교체, (3) RAGAS 3-way 재측정 + 보고서 비교 (Gemini-2.5-Pro 평가본 vs Claude-Haiku 평가본 메트릭 차이 기록).
- [x] ~~데이터 source 라벨 체계 통일~~ — **결정 완료 (2026-04-11)**: 옵션 A "라벨은 데이터가 정한다" 채택. 실제 적재 라벨(L/M 등)을 single source of truth로 사용, 설계 문서의 A/B/C/D는 논리적 분류 예시로 격하. SearchTierEditor에서 Qdrant 실제 source 값을 동적 표시하는 방향. 상세: `docs/adr/26-source-label-decision.md`

---

## Questions

- `[확인 필요]` `DEC-MONO-002` — web은 기존 app origin 유지, admin은 별도 hostname으로 이전하는 운영안 확정. 배포 전 필요하다.
- `[확인 필요]` `DEC-MONO-003` — 일반 사용자 로그인 방식 및 기존 데모 계정·기록의 이전 여부. identity 구현 전 필요하다.

- `[확인 필요]` 독립 베타의 법적 운영 주체와 FFWPU 공식 승인 요청·검수 절차는 무엇인가?
- `[확인 필요]` 초기 소규모 정본의 정확한 목록과 본문 전재·검색·임베딩·AI 요약·오프라인·푸시 인용별 권리 범위는 어디까지인가?
- `[확인 필요]` 콘텐츠 공식성·검수·철회 최종 책임자는 누구인가?
- `[확인 필요]` `DEC-MONO-004` — Flutter 착수 시점은 미정. PWA 우선 후 도입 확정 시 앱·Dart SDK·Pub workspace·모바일 CI를 함께 추가한다.
- ~~GCP 실제 배포 시점?~~ — 해소. GCP 배포 후(2026-04~07) 2026-07-29 Oracle Cloud 로 이전 완료. §13 참조

---

## Next Actions

### 모노레포 전환 (2026-09-05)

- [x] M1 — 기준선 검증 후 pnpm/Turbo와 `apps/admin`, `apps/api`로 이전
- [x] M2 — `apps/web` 추출, 공통 UI와 앱별 인증 UX·이미지 분리
- [x] M3 — OpenAPI→TS SDK·SSE 계약, API 내부 `app/core/modules` 이전
- [x] M4 — docs 재분류·링크, CI 영향 범위, web 배포·롤백 준비
- [ ] M5 — 승인 제품 계획에 따라 일반 사용자 인증·PWA·알림 구현 및 실기기 검증

### 전환 검증에서 확인한 기존 후속 과제

- [ ] `SEC-MONO-001` (P1, 전환 전부터 존재) — `apps/api/app/modules/chat/pipeline/stages/session.py`의 기존 `session_id` 재사용 경로에 쓰기 소유권 검증이 없다. 기록 조회의 소유권 검증과 별개다. 일반 사용자 공개 전에 인증/익명 세션 정책을 확정하고 타 사용자 세션 이어쓰기 거부 회귀 테스트와 함께 수정한다. 이번 폴더 이전에서 정책을 임의 변경하지 않았다.
- [ ] `QUALITY-MONO-001` — `apps/web/src/app/(chat)/page.tsx`의 기존 `react-hooks/exhaustive-deps` 경고 1개를 별도 정리한다. 이번 검사 결과는 오류 0개이며 경고를 숨기지 않았다.

### 가정연합 신규 PWA 기획 (2026-08-31)
- [ ] 세션 1 — `docs/research/2026-08-30-pwa-app-direction.md` §7 프롬프트로 PRD 작성·리뷰
- [ ] 세션 2 — 승인 PRD 기반 A/B/C 비교형 프로토타입 작성·방향 선택
- [ ] 세션 3 — 채택안 디자인 시스템·접근성 상태 작성·승인
- [ ] 세션 4 — 구현 설계·작업 분해·제한 베타 계획과 S5~S15 실행 runbook 작성
- [ ] 세션 5~15 — 승인 runbook 순서로 구현·검증·독립 베타·결과 판정

### 00. 멀티턴 대화 메모리 (2026-07-08)
> 설계: `docs/architecture/multi-turn-memory.md` (업계 조사 + 방안 A~D 비교)
> 통합 브랜치 `dev/multi-turn-memory`, sub-PR 2개 (Phase 1 이력 주입 / Phase 2 condense)

- [x] Phase 1 — 이력 생성 프롬프트 주입 + 후속 턴 캐시 조회·저장 스킵 + token_count 기록
- [x] Phase 2 — condense 후속질문 검색 재작성 (LLM 1회 결합, 원문 fallback) + meta 강등 완화책
- [x] 로컬 E2E — 2턴 대화 문맥 유지, condense 재작성, 캐시 히트/스킵, SSE 경로 모두 검증
- [ ] main 머지 + prod 배포 후 사용자 테스트 가이드 PDF의 "이전 대화 미기억" 참고사항 수정
- [ ] (백로그) 방안 C — condensed-query 기준 캐싱으로 후속 턴 히트율 회복 (운영 데이터 관찰 후)
- [ ] (백로그) 방안 D — 장기 세션 rolling summary (12메시지 초과 세션 빈도 관찰 후)

### 0-A. `collection_main` Phase 2 — DB 컬럼 drop (완료, stack PR)
> 상세: `docs/adr/52-collection-main-deprecation.md`
> Phase 1 (코드 사용 중단) PR #87, branch `refactor/deprecate-collection-main` (2026-04-30)
> Phase 2 (DB 컬럼 drop) branch `refactor/drop-collection-main-phase2`, base = Phase 1 (2026-04-30)

- [x] Alembic 마이그레이션 `aa6f4b908ef4` — `chatbot_configs.collection_main` 컬럼 drop + PoC 봇 4개 `is_active=FALSE` 처리 (FK 보호 위해 hard delete 대신 소프트 비활성)
- [x] `backend/src/chatbot/models.py` 컬럼 정의 + deprecation 주석 제거
- [x] `seed_chatbot_configs.py` PoC 봇 (`chunking-*`, `all-paragraph`) 시드 데이터 제거
- [x] `backend/src/search/collection_resolver.py` — `resolve_collections()` 무인자로 단순화 + 호출부 일괄 변경
- [ ] (배포 후) Phase 1 → Phase 2 순으로 prod 배포 + alembic head 확인

### 0. Phase 2.2 — paragraph 청킹 운영 전환 후속 (2026-04-30)
> 결정 ADR: `docs/adr/45-paragraph-chunking-50q-revalidation.md`
> 후속 plan: `docs/archive/plans/46-paragraph-l2-citation-strengthening.md`

- [x] 새 평가셋 50문항 + 3가지 평가 방식(RAGAS / LLM-Judge / 키워드 F1) 통합 측정 — F 우월 일치 확인 (RAGAS +0.058, LLM-Judge +0.70)
- [x] `'all'` 봇 `collection_main`을 `malssum_poc_v3` 영구 적용 (DB 변경 + `seed_chatbot_configs.py` 동기화)
- [ ] **Codex 독립 검토** — `~/Downloads/codex_compare_input_new50.md`를 `/codex consult` 모드로 호출 (사용자 직접). 4번째 평가 방식 confirm 효과
- [ ] **L2(출처 인용) 약점 보강** — dev-log 46의 방안 B(질문 파싱 + volume 필터) 우선 적용 → L2 회복 검증 → 미회복 시 방안 A(메타데이터 prefix injection 재임베딩)
- [ ] **Backend cache graceful degradation 결함 수정** — `cache_check.py`/`SemanticCacheService.check_cache`에 collection NotFound try/except + cache_available=False 자동 전환 (별도 PR)

### 1. RRF 점수 스케일 후속 조치 (즉시)
> 상세: `docs/adr/24-rrf-score-threshold-fix.md` §4

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
> 구현 계획: `docs/archive/plans/2026-04-11-query-rewriting-fallback.md`

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

### 10. ADR-30 후속 (재업로드 정책) — 2026-04-27 완료
- [x] **batch 모드 정렬** — `mode=batch`도 `on_duplicate` Form 파라미터 받음. `BatchService.submit`/`_ingest_batch_results`에 정책 적용 (merge union + skip 사전 차단). `_process_file` warning 제거. 커밋 `b7c56fb`
- [x] **`IngestionJob.content_hash` 도입** — SHA-256 hex 컬럼 + Alembic 마이그레이션(`dcf99a84bff1`). `_process_file_standard`에서 hash 비교로 skip 강화 (Gemini 호출 0회). 커밋 `f2efd20`, `1e8c5b3`, `4e57a40`
- [x] **일괄 업로드 결과 리포트** — UploadResponse `predicted_outcome` 추가, Admin UI에서 일괄 업로드 후 "신규/병합/덮어쓰기/스킵" 통계 토스트 + bulk skip 토글 노출. 커밋 `fb99d00`, `cf86ef1`
- [x] **부수: batch UUID NAMESPACE_URL 정렬** — `batch_service` `NAMESPACE_DNS`→`NAMESPACE_URL`로 정렬해 standard와 Point ID 정합성 확보 (잠재 중복 적재 버그 픽스). 커밋 `ef971a3`
- [x] **부수: BatchJob.on_duplicate 컬럼** — Alembic 마이그레이션(`4d872f8826ad`), default 'merge'. 커밋 `1ffcf61`

### 10b. ADR-30 Phase 2 — Codex review 후속 (2026-04-27 완료)
> Codex CLI 코드 리뷰 후 발견된 [P1] 1건 + [P2] 3건 + UI BUG 1건을 같은 PR에 합쳐 머지. 검증 잠금까지.

- [x] **[P1] start_chunk 자동 재개로 인한 merge/replace silent no-op 픽스** — `_process_file_standard`에 needs_reset 분기 추가, COMPLETED 재업로드 시 기존 Qdrant 청크 삭제 + start_chunk=0. skip+hash 불일치 fallback도 merge와 동일 정책. 커밋 `443d20f`
- [x] **[P2] skip 단축 경로 total_chunks 보존** — `complete_job(total_chunks=...)` 키워드 인자 + 두 호출처에 적용. 커밋 `443d20f`
- [x] **[P2] legacy NAMESPACE_DNS 마이그레이션 스크립트** — `backend/scripts/migrate_batch_dns_to_url.py` (dry-run + 충돌 통계 + URL-ID upsert 후 DNS-ID 삭제). 커밋 `f840046`
- [x] **[BUG-A] 일괄 업로드 dialog 충돌 silent failure 픽스** — `BulkPrecheckDialog` + `runBulkUpload` sequential + performUpload silent 옵션. 커밋 `c24fdea`
- [x] **a11y / 라벨 명확화** — Dialog.Close `aria-label`, default 권장 `autoFocus`, `aria-describedby` 위험 안내, bulk skip 토글 라벨/hint 재작성. 커밋 `0bc774d`
- [x] **회귀 잠금** — `inspect`-based 테스트 3건 (reset 분기 / total_chunks 키워드 / NAMESPACE_URL 사용) — 29 PASS

### 9. 아키텍처 리팩토링 선행 작업 (2026-04-24 착수)
> 플랜: `~/.claude/plans/sleepy-sleeping-summit.md` (v4.1)
> 브랜치: `refactor/runtime-config-prep`
> 관련 dev-log: `docs/research/25-sdk-survey-genai-qdrant.md`

- [x] **선행 #1 SDK 실측** — google-genai 1.68 HttpRetryOptions + qdrant-client 1.17 payload_schema (커밋 `fb9feb2`, Δ 6건 정밀화)
- [~] **선행 #2 Staging 환경 분리** — **폐기.** dev-log 39 에서 결정을 되돌렸고, 2026-07-29 Oracle 이전으로 전제였던 GCP staging(Cloud SQL·Cloud Run·`deploy.yml` `deploy-staging` job) 자체가 사라졌다. 설계 문서는 `docs/archive/staging-separation.md` 로 이동.
- [ ] **선행 #3 운영 Qdrant 1,000건 payload dry-run** — R3 Payload 통일 전 schema drift 사전 확인
- [x] **선행 #4 Alembic advisory lock + expected-head skip PoC** — 커밋 `a15ff0a` (dev-log 26). 단위 22 + 실측 4 통과. 기본 OFF(`ALEMBIC_USE_ADVISORY_LOCK`), 실환경 활성화는 staging 후
- [x] **선행 #4.1 Alembic batch backfill PoC** — 커밋 `d5614b3` (dev-log 29). run_batch_backfill 유틸 + 템플릿 스크립트 + 단위 6 PASS + 실측 500 row PASS
- [ ] **선행 #5 품질 게이트 기준선 수집** — 200건 실제 질문 답변 품질 측정 (Q2 과제)
- [x] **부수 S1 Gemini 클라이언트 팩토리 단일화** — 커밋 `6dd2855` (dev-log 30). common/gemini + pipeline/embedder + batch_embedder 3곳을 get_client(retry_429) 팩토리로 일원화. 팩토리 7 + 전체 352 PASS
- [x] **부수 S2 Alembic DROP TABLE IF EXISTS 제거** — 커밋 `f4865bb` (dev-log 28). idempotent CREATE + ON CONFLICT DO NOTHING. round-trip 실측 PASS
- [x] **부수 S3 프론트 챗봇 폼 중복 제거** — 커밋 `b238579` (dev-log 31). ChatbotForm 공통 컴포넌트 추출 (new 242→56 / edit 292→130 lines). Vitest 6 + tsc 0 에러
- [ ] R2 ChatbotRuntimeConfig 승격 (§17 / §21)
- [ ] R3 Payload 통일 + Collection Resolver
- [ ] R1 Pipeline Stage + Strategy Protocol (God Object 분해)
- [ ] v4.1 스팟 패치:
  - [x] N2 DI 스코프 (`@lru_cache` 제거) — dev-log 32 조사 결과 현재 `@lru_cache` 사용 0건, 문제 자체 부재. R1 Phase 1 체크리스트에 "`@lru_cache` factory 금지" 리뷰 규칙 추가로 대체
  - [ ] N3 FSM `force_transition_to` — dev-log 32 조사 결과 R1 Phase 1(PipelineState 도입) 필수 의존, 단독 선구현 불가
  - [x] N4 `ALEMBIC_EXPECTED_HEAD` 빌드 artifact + `_is_ancestor` rollback — dev-log 27, 단위 39 PASS. Cloud Run 실배포 검증은 staging 후
  - [ ] N7 Legacy `[legacy]` 태그 + 재인용 금지 — dev-log 32 조사 결과 R2 preparatory migration(`SessionMessage.pipeline_version` 추가) 필수 의존, 단독 선구현 불가

### 11. Qdrant 셀프 호스팅 (2026-04-29 착수) — **§13 Oracle 이전으로 대체됨**
> ADR: `docs/adr/45-qdrant-self-hosting.md` · 폐기된 운영 가이드: `docs/archive/qdrant-self-hosting.md`

Qdrant Cloud → GCP VM 셀프 호스팅은 2026-04~06 에 실제로 완료됐고, 이후 2026-07-29 Oracle 이전에서 Oracle ARM VM 으로 다시 옮겨졌다. GCP 전제 자산(`infra/qdrant-vm/`, `provision.sh`)은 정리 PR 에서 삭제했다. 현재 Qdrant 운영은 `infra/oracle-vm/README.md` 를 따른다.

남아 있던 후속 항목 중 유효한 것:

- [ ] Qdrant 클러스터링 (3노드, 데이터 ≥ 10GB 시점) — 현재 417,579 points 단일 노드
- [x] ~~VM Snapshot 자동 백업~~ — Postgres 는 일일 pg_dump + Object Storage 로 대체 (§13). Qdrant 는 수동 snapshot 유지

### 12. 레드팀 시연 세팅 (2026-06-04, 임시 — 존속 미지수)
> 브랜치: `feat/redteam-demo` · 플랜: `~/.claude/plans/jiggly-doodling-bachman.md`
> 프로덕트 영구 반영 미정. 시연 후 폐기 가능.

#### 코드 (완료)
- [x] 봇 3종 비교 — RAG-only 대조군 `raw_rag_only` 플래그 (search_tiers JSONB, 마이그레이션 없음). select_system_prompt 우회 + admin 폼 체크박스
- [x] 참여자 게이트 — `ResearchSession.participant_name/category` + 마이그레이션 `d7e8f9a0b1c2` + 채팅 랜딩 필수 입력 + 세션 상세 분석 노출
- [x] 말씀 카드 — `src/malssum/` JSON. 답변을 LLM 으로 주제 분류 → **해당 주제 말씀 무작위**(`pick_malssum_for_answer`). 6개 응답 경로 동봉(캐시 제외), main 경로는 followups/closing 과 병렬이라 추가 지연 0. 채팅 "함께 보는 말씀" 카드. (주제 미매칭/풀 작으면 전체 무작위 fallback)

#### 사용자/운영 액션 필요
- [ ] **봇1 (집필 규정 적용)**: admin → 챗봇 생성, `system_prompt`에 BASE 본문 + 24규정 직접 입력 (요청 시 BASE 블록 채팅 출력)
- [ ] **봇2 (미적용)**: admin → `system_prompt` 비움 → BASE만 적용
- [ ] **봇3 (RAG-only)**: admin → "RAG-only 모드" 체크박스 ON
- [ ] **말씀 큐레이션**: `uv run python scripts/extract_malssum_candidates.py --categories O,B,M --per-category 30` 실행 → 후보 추출 + **AI 주제 태깅**(위로/교리/실천/가정/참사랑) → 후보 검토 → 선별분을 `src/malssum/featured_malssum.json`에 저장. (각 항목 `category` = 주제)
- [ ] **참여자 카테고리** 형태(자유 입력 vs 드롭다운) + 게이트 입력 UI는 `/design-shotgun` A~C 시안으로 확정

#### 시연 종료 후 정리 (차단 항목)
- [ ] **raw_rag_only 봇 비활성화/삭제** — RAG-only 봇은 LLM 차원 범위 제한이 빠진 대조군. 익명 사용자 노출 방지 위해 시연 종료 후 `is_active=False` 처리 또는 삭제. (PII 필터·면책·rate-limit·입력 인젝션 차단은 유지되므로 인프라 가드레일은 정상.)
- [ ] 말씀 카드 사용 안 하면 `featured_malssum.json` 빈 `[]` 유지 (자동으로 카드 미표시)

#### 알려진 사항 (범위 외)
- 채팅 요청에 `chatbot_id`가 없으면 `process_chat`의 legacy 경로가 `generate_answer(generation_config=None)`를 호출 → 런타임 AttributeError 가능. 본 작업 이전부터 존재한 latent 결함이며 이번 변경과 무관. 별도 trigger.

### 13. GCP → Oracle Cloud 이전 (2026-07-25 착수 / 2026-07-29 완료)
> 운영 가이드: `infra/oracle-vm/README.md` · 이전 기록: `docs/runbooks/oracle-vm-migration.md`
> ADR: `docs/adr/2026-07-25-gcp-to-oracle-migration.md` · `docs/adr/2026-07-29-postgres-vm-relocation-and-backup.md`

**이전 완료.** GCP(Cloud Run + Qdrant VM) 전부 삭제. 월 $42 → $0, 채팅 응답 34초 → 23.7초. Postgres 도 Neon 에서 VM 으로 들여왔다.

- [x] **XFF 하드닝** — `extract_client_ip` 우선순위를 `cf-connecting-ip` → XFF 첫 토큰 → socket peer 로 변경. Cloudflare 는 클라이언트 XFF 뒤에 실제 IP 를 append 하므로 첫 토큰만 믿으면 rate limit 우회가 가능했다. 회귀 테스트 5건.
- [x] **fastembed 모델 캐시 관찰** — VM 실측 `/tmp/fastembed_cache` 116K, 디스크 18G/97G(19%). 부트 볼륨 100GB 에서 위험 없음으로 종결.
- [x] **cache cooldown 테스트 격리** — `tests/conftest.py` autouse fixture 로 `_cache_last_failure_monotonic` 전역 리셋.
- [x] **swap 실제 크기 확인** — `swapon --show` 실측 `/swapfile 4G`. 정상 확보.
- [x] **소킹 종료 뒤 GCP 자산 정리** — `.github/workflows/deploy.yml`, `infra/qdrant-vm/`, GitHub Secrets `GCP_*` 3종 삭제. GCP 시대 문서 4종은 `docs/archive/` 로 이동 + 폐기 배너.
- [x] **테스트 수 표기 갱신** — `docs/TODO.md`와 `AGENTS.md`를 실측 `917 passed / 4 skipped / 1 xfailed`로 맞췄다. (XFF 테스트 추가 후 922 passed)
- [x] **Makefile pipefail 명시** — `SHELL := /bin/bash` + `.SHELLFLAGS := -o pipefail -c`.
- [x] **Compose 환경 파일 표기 통일** — `--env-file .env` 명시로 통일 (README).
- [x] **Oracle README 수동 전달 스니펫 정렬** — `gzip -1` + `sudo docker load` 반영.
- [x] **Oracle 운영 문서 보강** — README 를 이전 절차서에서 운영 기준 문서로 재작성. postgres 서비스, 메모리 배분, `rollback-backend`/`oracle-logs`, 백업·복구 절 추가.
- [x] **백업 복구 리허설** — `infra/oracle-vm/restore-drill.sh` 신규. 2026-07-29 PASS (11MB 덤프 1초 복원, 11 테이블 34,377행 차집합 0, alembic head 일치).
- [x] **추천 질문 갱신 cron 이전** — Postgres 가 VM 로컬(127.0.0.1)로 오면서 GitHub runner 가 DB 에 닿을 수 없게 됐다. 그대로 뒀다면 구 Neon URL 로 붙어 아무 효과 없는 성공을 기록했을 것. `refresh-suggested-questions.yml` 삭제 → `infra/oracle-vm/refresh-questions.sh` + VM cron(일 18:30 UTC). 실제 1회 실행 검증 완료.
- [x] **CI/CD 배치 정리 + orchestration 정책 확정** (2026-07-30)
  - `make ci` 신규 — `ci.yml` 과 같은 명령·같은 순서(uv sync → pytest → pnpm install → test → build). **GHA 대체가 아니라 푸시 전 사전 점검**이고, 청구 차단 동안에만 임시 게이트 역할을 한다. 명령이 갈라지면 로컬 통과가 무의미해지므로 `ci.yml` 변경 시 동반 수정 필수.
  - `make cron-cache-cleanup` / `cron-refresh-questions` / `restore-drill` 수동 진입점 추가 (`ARGS=--dry-run` 지원).
  - **정책 확정: orchestration 은 GitHub Actions 에 둔다.** provider 에 묶지 않아 이전 시 secrets 만 갱신하면 된다. 예외는 리소스가 호스트 로컬일 때 하나 — Postgres 가 `127.0.0.1` 바인딩이라 `backup-db.sh`/`refresh-questions.sh` 는 VM cron 이 유일한 선택이다.
  - 이 정책에 따라 `cache-cleanup.yml` 을 GHA 로 되돌렸다. 청구 차단을 계기로 VM cron 에 내렸었는데, **청구 문제는 GHA 를 떠날 이유가 아니라 청구를 고칠 이유였다.** VM crontab 항목 제거(스케줄러 중복 방지), 스크립트는 수동 진입점으로 존치.
  - AWS 이전 경로 문서화 — Postgres 가 네트워크로 닿는 순간(RDS 등) VM cron 예외가 사라진다. 정기 작업 4건 중 **3건은 코드 변경 0건**, 배포만 재작성(`docs/runbooks/ci-cd-pipeline.md` §AWS 로 옮긴다면).
  - 차단 기간 누적된 만료 point 134건은 실행해 정리(172 → 38). **응답 정합성 영향 없음** — 조회가 Qdrant filter 에서 `created_at >= now - TTL` 로 만료분을 걸러낸다(`src/cache/service.py:89-94`). 안 돌면 디스크만 찬다.
- [x] **admin Oracle 이전 + 컷오버** (2026-07-30) — Next.js `output: "standalone"` 컨테이너로 VM 이전. 접속 주소 `https://app.woosung.dev`. `NEXT_PUBLIC_API_URL` 은 rewrites 가 빌드 타임에 구워지므로 build ARG (`http://backend:8080` — Cloudflare 왕복 1회 절감). Vercel 은 host 조건부 307 리다이렉트 전용으로 존치.
  - 컷오버 검증: 전 라우트 200, 정적 자산 200, rewrite 200/401, **SSE 실제 채팅 1회 10초** (chunk 15 + sources + done), **15MB 업로드 프록시 통과**(413 아님 → `proxyClientMaxBodySize` 적용 확인), `ADMIN_FRONTEND_URL` 교체 후 5컨테이너 healthy. admin 메모리 61.5MiB / 768MiB.
  - 가이드 문서 접속 주소 갱신: `redteam-test-guide.md`(3곳), `redteam-test-guide-v2.html`.

#### 남은 것 (별도 트리거)

- [ ] **GitHub Actions 청구 차단 해소** [확인 필요] — 2026-07-24경부터 모든 Actions 가 `recent account payments have failed or your spending limit needs to be increased` 로 실행되지 않는다. Settings → Billing & plans 에서 처리해야 한다.
  - **차단 동안의 대응**: PR 게이트는 `make ci`(ci.yml 과 동일 명령)를 사람이 돌린다. 캐시 정리는 `make cron-cache-cleanup` 을 사람이 돌린다 — 안 돌아도 응답 정합성은 안 깨진다(조회가 TTL 로 필터링, `src/cache/service.py:89-94`). 백업·추천 질문은 VM cron 이라 영향 없다.
  - 차단이 풀리면 `ci.yml` 과 `cache-cleanup.yml` 이 자동으로 다시 돈다. **되돌릴 작업은 없다.**
  - 되돌아온 뒤 확인할 것: 두 워크플로가 실제로 green 인지, `make ci` 와 `ci.yml` 결과가 일치하는지.

- [ ] **Vercel 프로젝트 정리** — `truewords-platform.vercel.app` 을 리다이렉트 전용으로 남겨 둔 상태다. 링크 전파를 확인한 뒤 삭제한다. 순서: (1) main 머지로 Vercel 프로덕션이 리다이렉트 포함 빌드로 갱신되는지 확인, (2) `curl -I` 로 307 확인, (3) 유입 로그가 0 에 수렴하면 프로젝트 삭제, (4) 삭제 시 `admin/next.config.ts` 의 `redirects()` 블록도 함께 제거.
- [ ] **가이드 PDF 재생성** — `redteam-test-guide.md` / `-v2.html` 의 접속 주소는 `app.woosung.dev` 로 갱신했다. 같은 폴더의 PDF 3종(`redteam-test-guide-light.pdf`, `redteam-test-guide-v2.pdf`, `truewords-user-test-guide.pdf`)은 바이너리라 구 주소가 남아 있다. 리다이렉트가 살아 있어 당장 깨지지는 않지만 Vercel 삭제 전에 재생성해야 한다.
- [ ] **push 자동 배포 상실** — Cloud Run 이 사라지며 `deploy.yml` 을 제거했다. main 머지가 곧 배포가 아니므로 `make deploy-backend` 를 명시 실행해야 한다. 필요해지면 GitHub Actions 빌드 → `docker save | ssh docker load` 로 복구 가능하다.
- [x] **GCP·Neon 잔존 리소스 감사** (2026-07-30) — ADR: `docs/archive/engineering/2026-07-30-gcp-neon-residual-audit.md`
  - **⚠️ 운영 Gemini 키가 문서에 없는 프로젝트에 있었다.** 서비스의 유일한 외부 의존인데 `jetaime-dev` 가 아니라 **다른 계정(`jangwooseng97@gmail.com`)의 `d-project-497004` ("D-Project")** 소유다. 해시 대조로 확정(값 미노출). 지우면 챗봇 즉사. `infra/oracle-vm/.env.example` 과 `README.md` 에 명시했다. **2026-06-04 `woosung-dev` 사고와 같은 구조의 재료였다.**
  - `jetaime-dev` 실사: TODO 에 적혀 있던 `kairos-api`/`nexus-core` 등은 **이미 없다.** 과금 비활성, Cloud Run 0 / Cloud SQL 0 / 버킷 0. Artifact Registry 는 billing 게이트로 조회 불가(과금도 안 됨). **월 $0 — 남겨 두는 비용이 없다.**
  - Neon 실사: 호스트 DNS 해석됨 → 프로젝트 생존. 무료 티어라 비용 $0. 문제는 비용이 아니라 **2026-05-03 cutover 시점 실사용자 대화 본문·참여자 식별 정보 사본이 방치돼 있다는 것**(데이터 최소화).
- [x] **삭제 실행** (2026-07-30, 사용자 승인 후)
  - **Neon `truewords` 삭제 완료** — 계정에 프로젝트가 7개 있고 여럿이 살아 있어(`ffwpu-social-db` 는 작업 몇 분 전에도 갱신) 이름만 보고 지웠으면 살아 있는 DB 를 날릴 수 있었다. VM `.env` 의 `NEON_DATABASE_URL_BACKUP` 호스트와 엔드포인트를 대조해 `rapid-mode-95348531` 하나로 확정했다. 삭제 후 6개 남음, DNS 미해석 전환 확인.
  - **GCP `jetaime-dev` 삭제 완료** — `DELETE_REQUESTED`, 30일 복구 창(`gcloud projects undelete jetaime-dev`). 삭제 직전 키 재대조에서 **첫 시도가 무효**였다(양쪽 개행 정규화 불일치 — 같은 키라도 절대 일치하지 않는 비교). `printf '%s'` 로 통일해 다시 확인 후 실행.
  - `d-project-497004` **손대지 않음** (운영 Gemini 키 소유).
  - 삭제 후 검증: `/health` 200 · `app` 200 · **채팅 SSE 실제 호출 정상(Gemini 키 살아 있음)** · `ops-check` 불변식 6건 OK.
- [x] **Gemini 키 유효성 감시** (2026-07-30) — `ops-check.sh` 7번째 검사 `gemini-key` + `backend/scripts/gemini_key_probe.py` + `make gemini-check`. 상세: `infra/oracle-vm/README.md` §`gemini-key`
  - **초안(generateContent 최소 토큰 1회)이 코드 추적에서 깨졌다.** 채팅은 semantic cache 히트여도 매 요청 `embed_content` 를 부른다(Embedding Stage 가 CacheCheck **앞**). 임베딩만 죽어도 채팅은 100% 실패하므로 generate 만 찌르면 **초록인데 챗봇은 죽어 있다.** → 두 surface 를 호출하고, **한쪽이 실패해도 나머지를 끝까지** 호출해 어느 쪽이 살아 있는지로 원인을 가른다(`backup-remote` 와 같은 원칙 → 검사 행은 하나).
  - **`max_output_tokens` / `thinking_config` 를 넣지 않는다.** gemini-3.5 계열은 `thinking_budget` 대신 `thinking_level` 을 받아 400 이 될 수 있고, 그러면 검사가 **정상인 키를 "무효" 로 보고**한다. 원칙: **probe 요청은 운영이 매일 성공시키는 요청의 부분집합이어야 한다.** 실측 `think=0` 이라 애초에 불필요했다.
  - **HTTP 성공만으로 판정하지 않는 곳이 하나 있다** — embed 차원. 200 이어도 1536 이 아니면 Qdrant 검색·적재가 전부 깨져 챗봇이 죽는다. 200 만으로는 못 잡는 유일한 silent 실패.
  - **상한 3층 + `sudo timeout` 순서.** `python 예산(50s) < 컨테이너 timeout(60s) < 호스트 timeout(75s)`. docker 에 exec 를 죽이는 API 가 없어 바깥 timeout 은 CLI 만 죽인다(안 프로세스는 고아) → 실제로 멈추는 건 컨테이너 안 `timeout`. `timeout sudo` 로 쓰면 비특권 timeout 이 root 자식을 못 죽여 `waitpid` 에 매달린다.
  - **비용 실측**: generate 입력 2 / 출력 9 토큰 + embed 입력 약 2 토큰 → 1회 **약 $0.0000234**. cron 1회/일 = **연 $0.0085**(1센트 미만), 배포 포함 5회/일 과다 가정에도 **연 $0.043**. 무시할 수준 확인. `retry_429=False` 라 probe 가 quota 를 되풀이 소모하지 않는다.
  - **실측 검증** (VM 운영 환경, 커밋 `e087a1d`→`f8ccde7`): 정상 7건 통과 exit 0 / 잘못된 키 `400-INVALID_ARGUMENT` exit 1 (**`key sha8` 이 `2ece1746`→`31e8cdf1` 로 달라져 `-e` override 가 실제로 먹었음을 증명** — 지문이 없으면 이 리허설은 반증 불가능하다) / 예산 초과 2분기(import 단계·API 호출 중) / 호스트 timeout rc 124 / 부트스트랩(이미지에 스크립트 없음) / SKIP 가드 로직(`backend`·`qdrant backend` → SKIP, `backendish` → RUN). 네트워크 분기는 로컬에서 `base_url` 을 도달 불가 host 로 물려 `network-connect` 확인(SDK→classify 라이브 배선). 라이브 유도 불가한 429·404·차원·비-enum status·힌트 대응은 `tests/scripts/test_gemini_key_probe.py` **32건**이 잠근다.
  - **검증이 자체 결함 3건을 잡았다** (전부 "고친 줄 알았는데" 로 끝날 수 있던 것):
    1. `signal.alarm(max(2, budget))` 의 하한 2 때문에 `--budget-seconds 1` 리허설이 정상 소요 안에 끝나 **예산 분기를 실측할 수 없었다** → 하한 1 (`alarm(0)` 은 타이머를 취소하므로 1 이 진짜 최소값).
    2. 컨테이너 안 import 가 **2.74s** 라 짧은 예산은 API 호출 전에 터지는데, 그 `BudgetExceeded` 가 import 가드에 삼켜져 "컨테이너 env / 이미지 확인" 이라는 **엉뚱한 조치**를 지시했다 → 예산 전용 분기 추가.
    3. `generate` 가 `timeout-budget` 으로 죽었을 때 "해당 모델·요청 인자 확인" 이 나왔다. 판정("키는 살아 있다")은 맞고 **조치가 틀렸다** → `_hint_one` 에 timeout·network 분기 추가 + 원인별 힌트를 테스트로 잠금.
  - 최악 소요 산수: import 2.7s + embed(2×8+2) + generate(2×12+2) = **46.7s < 예산 50s**.
  - **정직하게 — 실측하지 않은 것 2개.** (1) `SKIP` 분기는 `case` 문자열 매칭을 5치 전수 검증했지만 *"backend 가 실제로 unhealthy 일 때 `$BAD` 에 backend 가 들어가는가"* 는 운영 정지가 필요해 강제하지 않았다 (사용자 판단). 그 배선은 PR #212 부터 운영 중인 `containers` 검사가 같은 `$BAD` 로 이미 쓰고 있다. (2) 429(quota 소진)·404(모델 폐기)·차원 변경은 실키로 유도할 수 없어 단위 테스트로만 잠갔다.
  - `GEMINI_TIER=paid` 라 현실적 사망 원인은 rate limit(429) 이 아니라 **청구 실패(403)** 다 — GHA 를 5일간 죽인 것과 같은 계정 레벨 실패. 403 힌트가 청구를 먼저 지목한다.
- [ ] **RPO 24시간** — 백업이 하루 1회(03:00 KST)라 직전 장애 시 하루치 유실. 쓰기 빈도가 올라가면 빈도 상향 또는 WAL 아카이빙 재검토.
- [x] **예약 작업 실패 탐지** (2026-07-30) — ADR: `docs/adr/2026-07-30-silent-scheduled-job-failure.md`
  - **원인 규명**: (1) GitHub 은 알림을 만들지 않았다 — `gh api notifications?all=true` 가 빈 목록. (2) 실패 run 의 job 은 `steps_count: 0` — 청구 차단은 job 을 아예 시작하지 않는다. **따라서 워크플로 안의 `if: failure()` 알림 스텝으로는 이 사고를 잡을 수 없다.** 가장 먼저 떠오르는 대응이 정확히 이 실패 모드에 눈이 먼다.
  - **결정**: 감시자를 다른 실패 도메인(VM cron)에 두고, "job 이 돌았는가" 대신 **"결과가 기대대로인가"** 를 본다. 결과 감시는 job 미시작뿐 아니라 **성공했지만 아무 일도 안 한 경우**(구 Neon URL 로 붙어 성공 기록하던 `refresh-suggested-questions.yml` 이 실제 사례)까지 잡는다.
  - `infra/oracle-vm/ops-check.sh` 신규 — 불변식 5건(backup 26h / cache 만료 50 / suggested_at 10일 / 컨테이너 / 디스크 80%). VM cron 매일 18:45. 결과는 `/opt/ops-status.json`. 임계값 env override 가능.
  - `cache-cleanup.yml` 에 `if: failure()` → GitHub Issue 스텝 (새 secret 0, `GITHUB_TOKEN`). 같은 제목 열린 Issue 는 코멘트만 — 매일 실패 시 Issue 가 쌓여 신호가 묻히는 것 방지. **job 미시작은 못 잡는다는 한계를 주석에 명시.**
  - `make ops-check` + `deploy-backend`/`deploy-admin` 배포 전 자동 실행(advisory — 배포는 막지 않는다).
  - 검증: 정상 exit 0 / 강제 실패 시 FAIL 3건 집계 + exit 1 + 첫 실패 후에도 나머지 계속 검사(`set -e` 배제 의도 확인).
- [ ] **예약 작업 실패 알림 — 전달 채널** [확인 필요] — 위에서 **탐지는 닫았지만 push 는 아직**이다. 위반이 로그·JSON·종료코드로만 남아, 배포하지 않는 주에 백업이 죽으면 늦게 안다. 레포에 알림 자격증명이 하나도 없다(`gh api repos/:owner/:repo/hooks` → 0, Slack/SMTP 0건). 채널이 정해지면 `ops-check.sh` 마지막에 한 줄이다.
  - 안 1: **Slack Incoming Webhook** — URL 을 VM `.env` 에 넣고 `curl` 한 줄. 가장 짧다.
  - 안 2: **OCI Notifications(ONS)** — VM 이 이미 Instance Principal 을 쓰므로 새 키 불필요. 토픽 OCID + IAM 정책 필요.
- [ ] **Issue 알림 스텝 실행 검증** — GHA 청구 차단으로 워크플로를 돌릴 수 없어 YAML 파싱과 `gh` 명령 형태만 확인했다. 차단 해소 후 `workflow_dispatch` 로 일부러 실패시켜 Issue 가 실제로 생기는지 확인한다.
  - **2026-07-30 재확인: 여전히 차단.** 최신 run `30514716013`(04:45 UTC, CI/`chore/residual-cleanup-done`) 의 job 3개가 전부 `steps_count: 0` 이고 annotation 이 `The job was not started because recent account payments have failed or your spending limit needs to be increased`. `workflow_dispatch` 자체가 job 을 시작하지 못하므로 **일부러 실패시키는 것조차 불가능**하다. `ci.yml`/`cache-cleanup.yml` green 확인도 같은 이유로 보류. 청구 해소가 유일한 선행 조건.

#### 이번 작업 중 발견한 사전 결함 (Oracle 이전과 무관, 별도 트리거)

- [ ] **E2E 5건 실패 (사전 결함 확정)** — Oracle 이전 검증 중 발견. `git merge-base` 버전의 `next.config.ts` 로 교체해 재현해도 동일 실패하므로 이번 변경과 무관하다. 로컬 사전조건(alembic + `create_admin.py` 2계정 + `seed_chatbot_configs.py` + Qdrant 417,579 pts)을 모두 갖춘 상태에서 **18 passed / 5 failed**.
  - `data-source-delete.spec.ts` 4건 — `page.route("**/admin/data-source-categories")` mock 은 실제 호출 경로(`api.ts:94`)와 일치하는데, "카테고리 관리" 버튼 클릭 후 `getByRole("row", {name:/TEST/})` 가 렌더되지 않는다. UI 렌더 단계에서 어긋난 것으로 보이며 스펙 작성 이후의 카테고리 탭 구조 변경이 의심된다.
  - `admin-flow.spec.ts:197` (Weighted Search 모드 전환 후 저장 → 재로드 시 설정 유지) 1건 — 30초 타임아웃.
- [ ] **E2E 사전조건 자동화** — 위 실행에서 확인했듯 E2E 는 로컬 alembic + 계정 2개 + 챗봇 시드가 선행돼야 하고, 없으면 로그인 의존 테스트 16건이 통째로 죽는다. 스펙 주석에만 적혀 있어 매번 사람이 재현해야 한다. `make admin-e2e` 앞에 시드 target 을 붙이는 편이 낫다.
- [ ] **`docs/README.md` 깨진 링크 5건 (사전 결함)** — `04_architecture/03-vector-db-comparison.md`, `04-gemini-file-search-analysis.md`, `10-vibe-coding-and-pinecone-vs-qdrant.md`, `00_project/01-project-overview.md` 안의 `05-rag-pipeline.md` / `09-security-countermeasures.md`. 실제 파일이 없다. 이번 아카이브 이동과 무관하다.

#### Gemini 키 감시 작업 중 발견한 사전 결함 (2026-07-30, 별도 트리거)

이번 커밋에서 **고치지 않았다.** `gemini-key` 는 자체 sanitize·SKIP 가드로 각 항목을 회피하므로 새 위험을 더하지 않는다. 넷 다 기존 코드의 잠재 결함이다.

- [ ] **`ops-check.sh` `record` 의 JSON escaping 이 `"` 만 처리** (`${d//\"/\\\"}`) — detail 에 역슬래시나 개행이 섞이면 `/opt/ops-status.json` 이 깨진 JSON 이 된다. 전 검사 항목 공통. 호스트에서 `python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))'` 로 전역 해결 가능.
- [ ] **`cache-ttl` 은 backend 가 죽어도 중복 진단을 낸다** — backend 컨테이너가 내려가면 `containers` FAIL 과 별개로 "만료 개수를 읽지 못했다 — backend 또는 Qdrant 확인" 이 함께 나와 엉뚱한 곳(Qdrant)을 뒤지게 한다. `gemini-key` 에 넣은 `case " $BAD " in *" backend "*)` 가드를 그대로 적용하면 된다.
- [ ] **운영 채팅도 transport 예외를 재시도하지 않는다** — `google-genai` 의 재시도 술어가 `isinstance(e, errors.APIError) and e.code in retriable_codes` 라(`_api_client.retry_args`) `httpx.ConnectError` / `ReadTimeout` / TLS 오류는 **어느 정책에서도 재시도되지 않는다**. VM egress·DNS 가 한 번 흔들리면 사용자에게 그대로 503 이 간다. probe 는 자체 1회 재시도로 막았지만 `src/common/gemini.py` 는 그대로다.
- [ ] **모델 상수와 임베딩 차원이 흩어져 있다** — `MODEL_GENERATE`/`MODEL_EMBEDDING` 은 `src/common/gemini.py:23-24` 에 있지만 `src/pipeline/embedder.py` 는 `"gemini-embedding-001"` 을 3곳에 리터럴로 중복하고, `output_dimensionality=1536` 은 `gemini.py` 2곳 + probe 1곳에 있다. 부작용 없는 `src/common/gemini_models.py` (`MODEL_GENERATE`/`MODEL_EMBEDDING`/`EMBED_DIM`) 로 뽑으면 probe 의 마지막 하드코딩 상수도 사라진다.
