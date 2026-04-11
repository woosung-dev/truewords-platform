# TODO

> 마지막 업데이트: 2026-04-11

## Progress Overview

```
설계/문서     ████████████████████ 100%
Backend       █████████████████░░░  88%
Admin Web     █████████████████░░░  83%
테스트        ████████████████░░░░  80%  (190 + 37개)
인프라/배포    ██████████████████░░  90%
Flutter 앱    ░░░░░░░░░░░░░░░░░░░░   0%
데이터        ██████████░░░░░░░░░░  50%  (L+M만 적재)
보안 검증     ████████░░░░░░░░░░░░  40%  (방어 구현 완료, 레드팀 미진행)
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

### 테스트
- [x] Backend pytest 190개 (검색, 캐시, 채팅, 보안, 파이프라인, 스트리밍 등)
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
- [ ] **데이터 source 라벨 체계 통일** — 적재 데이터 `L/M` vs 설계 `A/B/C/D` 이원화. 정규화 방향 결정 필요 [확인 필요] — 상세: `docs/dev-log/24-rrf-score-threshold-fix.md` §4-1

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

### 2. 레드팀 테스트 (고우선순위)
- [ ] 내부 팀 대상 악의적 질문 테스트 시나리오 작성
- [ ] 보안 가드레일 검증 (Prompt Injection, Rate Limiting)
- [ ] 답변 품질/출처 정확도 평가

### 3. 검색 파이프라인 고도화 (고우선순위)
- [ ] Query Expansion/Rewriting 구현
- [ ] 검색 결과 0건 시 사용자 친화적 fallback 메시지

### 4. 임베딩 Batch API 지원 (중우선순위, 유료 전용)
- [ ] Gemini Batch API 인제스트 옵션 추가 ($0.075/M, Standard 대비 50% 할인)
- [ ] 관리자 UI에서 Standard/Batch 모드 선택
- [ ] 배치 상태 관리 (batch_id 저장, 진행률, 실패 처리)
- 참고: Standard는 실시간 처리 (현재 구현), Batch는 비동기 24시간 내 처리

### 5. A/B/C/D 데이터셋 확보 및 인제스트 (중우선순위)
- [ ] 추가 데이터 소스(A, B, C, D) 확보
- [ ] 인제스트 파이프라인으로 적재
- [ ] 다중 챗봇 버전 실제 동작 검증

### 6. Admin UI 개선 (중우선순위)
- [ ] 카테고리/태그 관리 UI 완성
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
