# TrueWords Platform

종교 텍스트 기반 RAG AI 챗봇 플랫폼. 하이브리드 검색(dense + sparse) → 재순위 → Gemini 생성 파이프라인 위에,
관리자용 데이터 적재·챗봇 운영 대시보드를 함께 제공한다.

---

## 한눈에 보기

| 다이어그램 | 무엇을 보여주나 |
|---|---|
| [운영 시스템 아키텍처](./docs/04_architecture/diagrams/system-architecture.png) | 브라우저 → Cloudflare Tunnel → Oracle VM 컨테이너 5개 → Gemini, 배포·예약 작업 경로 |
| [코드 모듈 구조](./docs/04_architecture/diagrams/code-structure.png) | admin 라우트 그룹·features ↔ backend 라우터·Stage 체인·검색·캐시·적재 |
| [데이터베이스 구조](./docs/04_architecture/diagrams/database-schema.png) | PostgreSQL 11 테이블 FK 관계 + Qdrant 컬렉션 2개 |
| [채팅 요청 시퀀스](./docs/04_architecture/diagrams/chat-request.png) | `POST /chat/stream` cache-miss 경로의 Stage 호출 순서와 SSE 이벤트 |
| [적재 데이터플로우](./docs/04_architecture/diagrams/ingestion.png) | 업로드 → 워커 → 추출·청킹 → 임베딩 → Qdrant upsert |
| [IngestionJob 라이프사이클](./docs/04_architecture/diagrams/ingestion-job.png) | PENDING → RUNNING → COMPLETED / PARTIAL / FAILED 와 재업로드 재개 |

각 다이어그램은 PNG 외에 **탐색형 HTML**(테마 전환 · 검색 · 노드 포커스 · 관계 추적 · 내보내기)이 함께 있다.
GitHub 에서는 HTML 이 렌더되지 않으므로 클론 후 브라우저로 연다 — [다이어그램 README](./docs/04_architecture/diagrams/README.md).

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Web (채팅 + 관리자) | Next.js 16.2 App Router · React 19.2 · TypeScript · Tailwind CSS 4 · shadcn/ui |
| Backend | FastAPI · Python 3.12 (Docker · CI 기준, pyproject 최소 3.11) · SQLModel · 100% async |
| Database | PostgreSQL 17 (asyncpg) |
| Vector DB | Qdrant v1.12.4 |
| 생성 모델 | Gemini `gemini-3.5-flash-lite` |
| 임베딩 | dense: Gemini `gemini-embedding-001` (1536d) · sparse: fastembed `Qdrant/bm25` |
| 패키지 매니저 | backend `uv` · admin `pnpm` (Node ≥ 22) |
| 배포 | Oracle Cloud ARM VM 단일 노드 (컨테이너 5개) + Cloudflare Tunnel |

> **Flutter 모바일 앱은 아직 없다.** Phase 4 예정이며 레포에 코드가 없다.
> 현재 채팅 UI 는 `admin/` Next.js 앱의 `(chat)` 라우트 그룹이다.

---

## 레포 구조

모노레포다. 배포 단위는 `backend`(FastAPI 이미지)와 `admin`(Next.js standalone 이미지) 둘뿐이다.

```
truewords-platform/
├── admin/              # Next.js 앱 — 채팅 UI + 관리자 대시보드 (단일 빌드)
├── backend/            # FastAPI — RAG 파이프라인, 적재, 관리자 API
├── infra/oracle-vm/    # Oracle VM 운영 스크립트 · docker-compose · cron 스크립트
├── docs/               # 설계 문서 · ADR · 다이어그램
├── .github/workflows/  # ci.yml (PR 테스트) · cache-cleanup.yml (일일 캐시 TTL 정리)
├── AGENTS.md           # AI 코딩 에이전트 규칙 (.claude/CLAUDE.md 는 symlink) · 상세 규칙은 .ai/
├── Makefile            # 개발/테스트/배포 진입점 (make help)
└── reports/            # 평가·벤치마크 산출물 (baseline jsonl · Qdrant drift)
```

### `admin/` — 채팅과 대시보드가 한 앱

별도 `web` 앱은 없다. 라우트 그룹 두 개가 한 빌드에 공존하고, 브라우저는 상대 경로만 호출한다.

```
admin/src/
├── app/
│   ├── (chat)/                 # 사용자 채팅 — /, /history
│   ├── (dashboard)/            # 관리자 — /dashboard, /chatbots, /data-sources,
│   │                           #   /analytics, /feedback, /audit-logs, /settings
│   ├── login/  about/  design-system/
│   └── layout.tsx  globals.css
├── features/                   # FSD 5 도메인 — analytics · auth · chat · chatbot · data-source
│   └── <도메인>/{api.ts, types.ts, components/}
├── components/{ui, truewords}/ # shadcn/ui + 프로젝트 공용 컴포넌트
├── lib/                        # api.ts (fetch 래퍼) · sse.ts · reactions-api.ts
└── test/                       # Vitest 14 파일
```

브라우저 → backend 직결이 아니라 **`next.config.ts` 의 rewrites 가 프록시**한다.

| 프론트 경로 | backend 경로 |
|---|---|
| `/admin/*` | `/admin/*` |
| `/api/chat`, `/api/chat/*` | `/chat`, `/chat/*` |
| `/api/chat/messages/*` | `/api/chat/messages/*` |
| `/api/chatbots` | `/chatbots` |
| `/api/sources/*` | `/api/sources/*` |

### `backend/` — Router / Service / Repository

```
backend/
├── main.py                 # FastAPI 앱 — 라우터 9개, 미들웨어, 예외 핸들러, lifespan
├── src/
│   ├── chat/               # 채팅 API + ChatService
│   │   └── pipeline/stages/  #   Stage 14개 (검증→세션→임베딩→캐시→…→저장)
│   ├── search/             # hybrid · cascading · weighted · rerank · query_rewrite
│   ├── cache/              # Semantic Cache (Qdrant 컬렉션 기반)
│   ├── chatbot/            # 챗봇 버전 설정 · 추천 질문
│   ├── datasource/         # 데이터 소스 카테고리 · 청크 조회
│   ├── pipeline/           # 적재 — extractor · chunker · embedder · ingestor
│   ├── admin/              # 인증 · 감사 로그 · 분석 · 업로드 워커
│   ├── safety/             # 입력 검증 · 레이트리밋 · 출력 필터
│   ├── qdrant/             # RawQdrantClient (raw httpx) · 필터 · 컬렉션 부트스트랩
│   ├── common/             # DB 세션 · Gemini 클라이언트 · 미들웨어
│   ├── malssum/            # 큐레이션 말씀 카드 — featured_malssum.json 에서 1개 선택 (답변 화면 곁들임)
│   ├── alembic_support/    # 마이그레이션 보조 — advisory lock · 배치 backfill (기본 OFF)
│   └── config.py           # Pydantic Settings
├── alembic/versions/       # 마이그레이션 24개
├── scripts/                # 적재·백필·평가 유틸리티
└── tests/                  # pytest 969 케이스
```

**Stage 체인** — `ChatService` 가 순서대로 실행한다. 캐시가 적중하면 검색·생성 Stage 를 건너뛰므로
Gemini 호출 자체가 발생하지 않는다.

```
InputValidation → Session → Embedding → CacheCheck → RuntimeConfig → IntentClassifier
  → QueryRewrite → Search → Rerank → Generation → SuggestedFollowups
  → ClosingTemplate → SafetyOutput → Persist
```

**Qdrant 접근 경로는 3갈래다.** `src/qdrant` 의 `RawQdrantClient`, `cache/service.py`,
`pipeline/ingestor.py` 가 각각 raw httpx 를 연다. qdrant-client SDK 의 HTTP/2 가
Cloudflare Tunnel 뒤에서 hang 하는 문제를 피하기 위한 의도적 구조다
(`docs/dev-log/46-qdrant-cache-cold-start-debug.md`).

---

## 아키텍처

브라우저는 `app.woosung.dev` 한 곳만 호출한다. Cloudflare Tunnel 이 VM 안으로 들어오고,
admin 컨테이너의 rewrites 가 compose 서비스 DNS 로 backend 에 프록시하므로 Cloudflare 를 다시 타지 않는다.

```
브라우저 ──HTTPS──> Cloudflare Edge ──tunnel(outbound)──> cloudflared
                                                              │
   ┌──────────────────────── Oracle Cloud ap-tokyo-1 ─────────┼───────────────┐
   │  VM.Standard.A1.Flex (2 OCPU / 12GB) · inbound TCP 22 only               │
   │                                                          ▼               │
   │   admin :3000 ──rewrites──> backend :8080 ──┬──> qdrant :6333            │
   │   (Next standalone)         (FastAPI)       └──> postgres :5432          │
   │                                   │                                      │
   │   VM cron (backup-db.sh 6h)       │                                      │
   └───────────────────────────────────┼──────────────────────────────────────┘
                                       └──HTTPS──> Gemini API (유일한 외부 의존)
```

- 호스트 publish 는 `127.0.0.1` 루프백만, 컨테이너 간 통신은 `truewords_net` 브리지
- 외부 의존은 Gemini API 하나뿐
- 예약 작업 (GitHub Actions): `cache-cleanup.yml` — 매일 18:00 UTC, semantic_cache TTL 정리. Qdrant 는 HTTPS 라 VM 밖에서 돈다
- 예약 작업 (VM cron 4개): `backup-db.sh` 6시간마다 · `ops-check.sh` 매일 · `refresh-questions.sh` 매주 (봇별 추천 질문) · `prune-images.sh` 매주 (이미지 GC). Postgres·이미지가 VM 로컬 자원이라 여기서만 돈다

상세: [운영 시스템 아키텍처 다이어그램](./docs/04_architecture/diagrams/system-architecture.png) · [`infra/oracle-vm/README.md`](./infra/oracle-vm/README.md)

---

## 데이터베이스 구조

### PostgreSQL — 11 테이블

`session_messages` 를 허브로 채팅 도메인이 모인다. 모든 PK 는 UUID다.

| 도메인 | 테이블 | 핵심 컬럼 | FK |
|---|---|---|---|
| 관리자 | `admin_users` | `email` UNIQUE, `role`, `is_active` | — |
| 관리자 | `admin_audit_logs` | `action`, `target_table`, `changes` JSON, `ip_address` | → `admin_users` |
| 설정 | `chatbot_configs` | `chatbot_id` UNIQUE, `system_prompt`, `search_tiers` JSON, `suggested_questions` JSON | — |
| 설정 | `data_source_categories` | `key` UNIQUE, `sort_order`, `is_searchable` | — |
| 채팅 | `research_sessions` | `client_fingerprint`, `participant_name`, `started_at` | → `chatbot_configs` |
| 채팅 | `session_messages` | `role`, `content`, `resolved_answer_mode`, `pipeline_version` | → `research_sessions` |
| 채팅 | `search_events` | `query_text`, `rewritten_query`, `applied_filters` JSON, `search_tier`, `latency_ms` | → `session_messages` |
| 채팅 | `answer_citations` | `source`, `volume`, `text_snippet`, `relevance_score`, `rank_position` | → `session_messages` |
| 채팅 | `answer_feedback` | `feedback_type`, `comment`, `user_session_id` | → `session_messages` |
| 채팅 | `chat_message_reactions` | `kind`, `user_session_id` | → `session_messages` |
| 적재 | `ingestion_jobs` | `volume_key` UNIQUE, `status`, `processed_chunks`, `content_hash` | — |

**ENUM 5종** — `AdminRole`(super_admin/admin/viewer) · `MessageRole`(user/assistant) ·
`FeedbackType` · `MessageReactionKind`(thumbs_up/thumbs_down/save) ·
`IngestionStatus`(pending/running/completed/failed/partial)

**복합 UNIQUE 2종** — `answer_feedback(message_id, user_session_id)`,
`chat_message_reactions(message_id, user_session_id, kind)`.
둘 다 익명 세션 쿠키(`tw_anon_session`) 기준이며 토글 해제는 row delete 다.

> `answer_feedback` 은 append-only 가 아니라 upsert 다. 좋아요↔싫어요 전환은 UPDATE 로 교체된다.

### Qdrant — 컬렉션 2개

| 컬렉션 | 벡터 | 용도 |
|---|---|---|
| `malssum_poc_v5` | dense 1536 Cosine + sparse BM25 | 본문 청크 (하이브리드 검색 대상) |
| `semantic_cache` | dense 1536 Cosine | 유사 질문 캐시 (payload index 4종, TTL 정리) |

상세: [데이터베이스 구조 다이어그램](./docs/04_architecture/diagrams/database-schema.png)

---

## 로컬 개발 환경

### 사전 요구사항

Docker · [uv](https://docs.astral.sh/uv/) · Node 22+ · pnpm

### 1. 환경변수

```bash
cp backend/.env.example backend/.env       # GEMINI_API_KEY 등 필수 값 채우기
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > admin/.env.local
```

### 2. 인프라 + 백엔드 + 프론트

```bash
make infra-up          # PostgreSQL + Qdrant 컨테이너
make backend-install   # uv sync
make backend-migrate   # alembic upgrade head
make backend-dev       # uvicorn :8000 (자동 리로드)
```

```bash
make admin-install
make admin-dev         # Next.js :3000
```

- 채팅 / 대시보드: http://localhost:3000
- API 문서: http://localhost:8000/docs
- Health: http://localhost:8000/health

### 3. 관리자 계정 (최초 1회)

```bash
cd backend && uv run python scripts/create_admin.py
```

`make help` 로 전체 타깃을 볼 수 있다.

---

## 테스트

```bash
make backend-test      # pytest — 969 케이스
make admin-test        # Vitest — 14 파일
make admin-e2e         # Playwright E2E — 2 스펙 (아래 사전 조건 필요)
make test-all          # backend-test + admin-test (E2E 제외)
make ci                # PR CI(ci.yml) 와 동일 — backend pytest + admin vitest + build
make admin-type        # admin tsc --noEmit · 린트는 make admin-lint
```

PR 을 열면 `.github/workflows/ci.yml` 이 backend pytest + admin Vitest·build 를 돌린다 (base 가 `main` · `dev/**` 일 때).
E2E 와 린트는 CI 에 없다.

> E2E 는 로그인 의존 케이스가 있어 사전 조건 3개가 없으면 실패한다 — Postgres·Qdrant 기동,
> 테스트 계정 2개(`backend/scripts/create_admin.py`), 챗봇 시드(`backend/scripts/seed_chatbot_configs.py`).
> 계정·비밀번호 값은 [`admin/e2e/admin-flow.spec.ts`](./admin/e2e/admin-flow.spec.ts) 상단 주석에 있다.

---

## 배포

**push 자동 배포는 없다.** 로컬에서 명시적으로 실행한다.

```bash
make deploy-backend    # buildx linux/arm64 → docker save | gzip | ssh docker load → compose up -d --wait
make deploy-admin
make rollback-backend  # 직전 태그로 복귀
make ops-check         # 운영 불변식 7개 점검
```

> 배포 이미지는 **체크아웃된 HEAD** 기준으로 만들어진다. 브랜치에서 배포하면 운영이 미머지 코드로 돌아간다.
> 배포 전 현재 커밋이 `main` 에 포함되는지 확인할 것.

Vercel 프로젝트는 구 링크(`truewords-platform.vercel.app`)를 `app.woosung.dev` 로 넘기는
**리다이렉트 전용**으로만 남아 있다. 서비스는 Oracle VM 이 담당한다.

---

## 설계 문서

전체 색인은 [`docs/README.md`](./docs/README.md).

| 디렉터리 | 내용 |
|---|---|
| `docs/00_project/` ~ `07_infra/` | 개요 · 요구사항 · 도메인 · API · 아키텍처 · 환경 · DevOps · 인프라 |
| `docs/04_architecture/diagrams/` | 탐색형 다이어그램 6종 (JSON 원본 + HTML + PNG) |
| `docs/dev-log/` | ADR — 의사결정 기록 79건 (+ 평가 결과 JSON · 보고서 HTML) |
| `docs/guides/` | 로컬 셋업 · 배포 · 트러블슈팅 |
| `docs/TODO.md` | 완료 / 차단 / 질문 / 다음 액션 |

---

## Git Convention

| 접두사 | 용도 |
|--------|------|
| `feat:` | 새로운 기능 추가 |
| `fix:` | 버그 수정 |
| `refactor:` | 코드 리팩토링 |
| `docs:` | 문서 수정 |
| `chore:` | 빌드, 설정 수정 |
| `test:` | 테스트 추가/수정 |

`main` 에 직접 커밋·푸시하지 않는다. `{type}/{짧은-설명}` 브랜치 + PR 로 머지한다.
