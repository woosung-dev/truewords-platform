# TrueWords Platform

종교 텍스트 기반 RAG AI 챗봇. 사용자 웹과 관리자 웹은 독립 Next.js 앱이며, 같은 FastAPI의 계정·업무 규칙·검색·대화 기록을 사용한다.

**앱별 UI 소유권 분리(사용자 승인 2안)의 구현·로컬 검증을 완료했고, 2026-09-05 커밋·푸시 승인을 받았다.** PR #221의 새 HEAD 원격 검증은 별도이며, 이전 `896a7ae`의 CI 결과를 이번 변경의 검증 결과로 사용하지 않는다. UI·테마는 각 앱이 소유하고 API SDK·검사 설정만 공유한다. 현재 UI/UX 명세는 신규 디자인 승인이 아니다. 운영 배포는 별도 승인 후 수행하며, PWA 설치·푸시·일반 사용자 인증(M5)과 Flutter 앱은 이번 범위에서 구현하지 않는다.

## 1. 저장소 경계

```text
truewords-platform/
├── apps/
│   ├── web/                 # 사용자 채팅·기록·소개·로그인 (localhost:3000)
│   ├── admin/               # 관리자 대시보드·설정·적재 (localhost:3001)
│   └── api/                 # FastAPI, Python 3.12 + uv (localhost:8000)
│       └── app/
│           ├── main.py      # 라우터·lifespan 조립
│           ├── core/        # 설정·DB·예외·공통 기반
│           └── modules/     # chat/search/cache/pipeline/admin 등 기존 도메인
├── packages/
│   ├── api-client-ts/       # 생성 DTO/SDK + 플랫폼 중립 transport
│   ├── eslint-config/
│   └── typescript-config/
├── contracts/               # FastAPI 생성 OpenAPI + 공통 REST/SSE fixture
├── tooling/                 # 코드 생성·계약/경계/문서 검사
├── tests/e2e/               # web/admin/API 통합 시나리오
├── docs/                    # prd/specs/adr/architecture/plans/runbooks
├── infra/oracle-vm/         # 독립 이미지·배포·복구 설정
└── Makefile                 # 개발·검증·수동 운영 진입점
```

`apps`는 배포 단위, `packages`는 코드 재사용 단위, `contracts`는 언어 간 계약이다. Flutter 도입 확정 전 `apps/mobile`·Dart SDK·Pub workspace·모바일 CI를 만들지 않는다.

| 책임 | 위치 |
|---|---|
| 제품 권한·RAG·대화 기록·업무 규칙 | `apps/api/app/modules` |
| 웹 로그인 복귀·화면 상태·라우팅 | 각 Next.js 앱 |
| 공통 API 모델 | FastAPI Pydantic → `contracts/openapi.json` → TS SDK |
| SSE | 실제 서버 이벤트와 fixture·소비자 테스트. OpenAPI 생성만으로 검증하지 않음 |
| React UI·테마·화면 UX | 각 앱의 `src/components/ui`, `src/app/globals.css`, 앱별 UI/UX 명세 |
| 공통 개발 설정 | `packages/eslint-config`, `packages/typescript-config` |

`pnpm-lock.yaml`은 JS/TS, `apps/api/uv.lock`은 Python 의존성을 고정한다. Turbo는 작업 실행·캐시를 조율하며 Python/Dart import를 자동 분석하는 도구로 취급하지 않는다.

## 2. 로컬 시작

사전 도구: Node.js 22, pnpm 12.3.4(`corepack enable` 이면 `packageManager` 필드로 자동 선택). API 작업에는 Python 3.12·uv, DB/Qdrant에는 Docker가 추가로 필요하다. 웹 작업만 할 때 uv/Flutter 설치는 필수가 아니다.

1. 루트에서 `pnpm install --frozen-lockfile`을 실행한다.
2. `apps/web/.env.example`과 `apps/admin/.env.example`을 각각 앱의 `.env.local`로 복사하고 로컬 주소를 확인한다.
3. 루트 `pnpm dev`로 두 웹을 실행한다. 하나만 필요하면 `pnpm dev:web` 또는 `pnpm dev:admin`을 사용한다.

API를 함께 실행할 때:

```bash
cp apps/api/.env.example apps/api/.env
# apps/api/.env에 개발용 값을 입력한다. 운영 비밀 값을 복제하지 않는다.
make infra-up
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

기존 로컬 데이터가 있으면 `make infra-up` 전에 [Compose 볼륨 보존 절차](docs/runbooks/monorepo-migration-and-rollback.md#로컬-compose-볼륨-보존)를 먼저 수행한다. 다른 worktree의 Postgres/Qdrant에 연결하거나 볼륨을 지우지 않는다.

| 주소 | 용도 |
|---|---|
| http://localhost:3000 | 사용자 웹·`/history`·`/about` |
| http://localhost:3001 | 관리자 웹·`/dashboard` |
| http://localhost:8000/docs | FastAPI 문서 |

localhost의 쿠키는 포트별로 격리되지 않는다. 이 단계는 기존 데모 인증을 보존하며 일반 사용자 identity 출시를 의미하지 않는다. 상세 설정은 [환경 가이드](docs/runbooks/environment-setup.md)를 따른다.

## 3. API·인증 계약

브라우저는 같은 origin의 `/api/backend/*`로 요청하고 Next.js가 FastAPI로 프록시한다. 이전 `/admin/*`, `/api/chat*`, `/api/chatbots`, `/api/sources/*` 호환 경로도 유지한다. 업무 로직을 Next.js Server Action 안에만 두지 않는다.

| 영역 | 서버 경로·정책 |
|---|---|
| 채팅 | `POST /chat`, `POST /chat/stream`; 쿠키가 있으면 세션 귀속, 기존 rate limit 유지 |
| 본인 대화 기록 | `GET /chat/sessions`, `GET /chat/sessions/{id}`; API에서 소유자 검증 |
| 인증 | `/admin/auth/login`, `logout`, `me`; 기존 HttpOnly `admin_token` 데모 인증 |
| 관리 | `/admin/*`; 서버의 관리자 게이트·CSRF 검증 유지 |
| 헬스 | `GET /health` |

생성 파일은 직접 수정하지 않는다. API 변경 시 export·SDK 재생성·계약 차이·양 앱 소비자를 함께 검증한다. transport는 쿠키·CSRF 헤더·multipart·취소·오류를 처리하고 앱별 로그인 이동을 소유하지 않는다.

## 4. 검증·배포

```bash
make ci
node tooling/checks/docs-links.mjs
```

M1~M4의 전체 회귀와 E2E·계약 검사는 [이전 실행 계획의 완료 증거](docs/plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거), 후속 UI 분리 검증은 [앱별 UI 실행 계획](docs/plans/active/2026-09-05-app-owned-ui.md)을 확인한다. 이전 문서의 테스트 개수를 이번 실행 결과로 취급하지 않는다.

**push 자동 배포는 없다.** 기존 Oracle 운영은 통합 Next.js를 포함한 5컨테이너이며, 저장소에는 분리 후 web/admin/API를 포함한 6컨테이너 구성을 준비한다. Cloudflare의 원격 Public Hostname은 Compose 편집으로 바뀌지 않는다.

배포 승인 후 `make deploy-web`·`make deploy-admin`·`make deploy-backend`, 복구에는 대응하는 `rollback-*`과 명시적 이전 `TAG`를 사용한다. 기존 backend 서비스 DNS·이미지 이름은 유지한다. 단일 VM의 Compose 교체를 무중단으로 보장하지 않는다.

## 5. 문서

| 문서 | 내용 |
|---|---|
| [문서 색인](docs/README.md) | 요구사항·spec·ADR·운영 가이드 |
| [모노레포 설계](docs/architecture/2026-09-05-pwa-flutter-monorepo.md) | 현재/추후 범위와 공유 경계 |
| [사용자 웹 UI/UX](docs/specs/web/ui-ux.md), [관리자 UI/UX](docs/specs/admin/ui-ux.md) | 앱별 현재 구현·소유권. 신규 디자인 승인 문서가 아님 |
| [전환·복구 runbook](docs/runbooks/monorepo-migration-and-rollback.md) | 볼륨·라우팅·쿠키·이미지 보존과 복구 |
| [Oracle 운영](infra/oracle-vm/README.md) | VM·백업·예약 작업·독립 배포 |
| [구조 다이어그램 7종](docs/architecture/diagrams/README.md) | 현재 모노레포·6컨테이너 구조 (main `8980e0c`, 2026-09-06 재생성). 운영 아키텍처·모노레포·데이터 모델·채팅 시퀀스·적재 2종·배포 워크플로 |

main 직접 push 금지. 큰 작업은 통합 브랜치의 sub-task PR을 거쳐 사람이 최종 main PR을 검토한다. [브랜치 가이드](docs/runbooks/integration-branch-workflow.md), [에이전트 지침](AGENTS.md).
