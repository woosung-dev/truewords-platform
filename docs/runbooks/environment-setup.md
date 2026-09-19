# 로컬 환경 설정

모노레포 전환 후 실행 가이드다. 운영 전환은 [별도 runbook](monorepo-migration-and-rollback.md)을 따른다.

## 웹만 개발하기

Node.js 22와 pnpm 12.3.4를 사용한다(`corepack enable` 이면 루트 `packageManager` 필드가 버전을 고른다. pnpm 10+ 는 `package.json` 의 `pnpm.*` 설정을 읽지 않으므로 overrides·allowBuilds 는 `pnpm-workspace.yaml` 에 있다). API용 uv나 Flutter SDK는 이 경로의 필수 조건이 아니다.

```bash
# 저장소 루트
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
cp apps/admin/.env.example apps/admin/.env.local
pnpm dev
```

`pnpm dev`는 두 웹을 함께 실행한다. 하나만 필요하면 `pnpm dev:web` 또는 `pnpm dev:admin`을 사용한다. 사용자 웹은 3000, 관리자는 3001 포트를 사용한다. 실제 API 기능에는 실행 중인 FastAPI 또는 해당 테스트의 mock이 필요하다.

## API와 로컬 인프라

Python 3.12·uv·Docker Compose가 필요하다.

1. `apps/api/.env.example`을 같은 디렉터리의 `.env`로 복사하고 **개발용 값만** 입력한다.
2. 기존 데이터가 있다면 [Compose project·볼륨 보존](monorepo-migration-and-rollback.md#로컬-compose-볼륨-보존)을 먼저 확인한다.
3. 루트에서 `make infra-up`을 실행한다.
4. `apps/api`에서 아래 의존성·schema·서버 명령을 실행한다.

```bash
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8000
```

API 문서는 http://localhost:8000/docs, 헬스는 http://localhost:8000/health다. 앱의 `.env`는 `apps/api` working directory 기준으로 읽는다. 이전 `backend/.env`를 자동 복제하거나 내용을 로그에 출력하지 않는다.

관리자 계정이 필요하면 개발 DB를 대상으로 `uv run python scripts/create_admin.py`의 안내를 따른다. 예시 이메일/비밀번호가 자동으로 존재한다고 가정하지 않는다. 기존 데모 관리자 게이트를 일반 사용자 권한 모델로 해석하지 않는다.

## 환경변수와 소유자

| 변수 | 소유자·용도 | 로컬 기본/주의 |
|---|---|---|
| `GEMINI_API_KEY` | API, 모델 호출 | 실제 개발용 키 필요. CI는 외부 호출 없는 mock·placeholder |
| `DATABASE_URL` | API, PostgreSQL | `postgresql+asyncpg://…@localhost:5432/truewords`; test worktree는 별도 DB/포트 |
| `QDRANT_URL`, `QDRANT_API_KEY` | API, 검색 저장소 | localhost:6333; 운영 값과 격리 |
| `ADMIN_JWT_SECRET`, `COOKIE_SECURE` | API, 기존 데모 JWT 쿠키 | production은 기본 secret 금지·Secure 필수 |
| `WEB_FRONTEND_URL`, `ADMIN_FRONTEND_URL` | API, 명시적 CORS 허용 origin | http://localhost:3000 / http://localhost:3001 |
| `NEXT_PUBLIC_API_URL` | 두 Next 앱의 API rewrite 목적지 | http://localhost:8000; **build 시 고정** |
| `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_ADMIN_URL` | 두 Next 앱의 앱 간 이동 | http://localhost:3000 / http://localhost:3001; **build 시 고정** |

전체 필드의 원본은 `apps/api/app/core/config.py`와 앱별 `.env.example`이다. `NEXT_PUBLIC_*` 값은 비밀이 아니며 사용자에게 노출될 수 있으므로 토큰·비밀번호를 넣지 않는다. 운영 Next 빌드에서는 API 주소가 내부 `http://backend:8080`이 된다.

| API 선택 설정 | 현재 기본 |
|---|---|
| `COLLECTION_NAME` / `CACHE_COLLECTION_NAME` | `malssum_poc_v5` / `semantic_cache` |
| `CACHE_THRESHOLD` / `CACHE_TTL_DAYS` | 0.88 / 7일 |
| `ADMIN_JWT_EXPIRE_MINUTES` | 1440분 |
| `ENVIRONMENT` | `development`; 운영은 `production` |
| `GEMINI_TIER` | `free`; 개별 배치 설정은 기존 API 설정 참조 |

과거 Cloud SQL/Secret Manager/Vercel Preview staging 표는 현재 환경의 설정값이 아니다. 별도 staging 자동 접미사가 존재한다고 가정하지 않으며 격리된 DB·컬렉션을 명시적으로 지정한다.

## 쿠키·프록시 확인

웹과 관리자는 같은 origin 프록시를 통해 API를 호출한다. 쿠키 전송은 `credentials: include`, 변경 요청은 `X-Requested-With: XMLHttpRequest`를 유지한다. 파일 업로드에는 JSON Content-Type을 강제하지 않는다.

localhost의 **포트는 쿠키 격리 경계가 아니다**. 3000/3001에서 쿠키가 같이 보이는 것은 운영의 서로 다른 hostname에서 로그인된다는 증거가 아니다. 독립 host에서는 별도 로그인이 필요할 수 있으며 broad Domain 쿠키나 SSO를 이번 구조 전환에서 임의로 추가하지 않는다.

## DB 마이그레이션

```bash
cd apps/api
uv run alembic heads
uv run alembic current
```

폴더·import 이동만으로 새 revision을 만들거나 DB schema를 재생성하지 않는다. 실제 모델 변경은 별도 승인·마이그레이션 계획을 가진다. `alembic downgrade`·볼륨 삭제·운영 복원은 구조 이전의 검증 명령이 아니다.

## 검증

루트 `make ci`와 `node tooling/checks/docs-links.mjs`를 실행한다. 전체 pytest는 `apps/api`에서 `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest`로 검증한다. 실제 통과 결과는 [현재 계획](../plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)에 기록하며 과거 개수와 구분한다.
