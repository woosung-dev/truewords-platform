# TrueWords API

Next.js web/admin과 추후 모바일이 사용하는 공통 FastAPI다. 폴더 이전으로 URL·DB 테이블·Alembic 이력·RAG 정책은 변경하지 않는다.

## 구조

```text
apps/api/
├── app/
│   ├── main.py                    # 앱 조립·CORS·OpenAPI
│   ├── core/
│   │   ├── config.py              # 환경 설정
│   │   ├── common/                # DB·Gemini·공통 오류·요청 추적
│   │   └── alembic_support/       # 기존 advisory lock·backfill
│   └── modules/                   # admin/chat/chatbot/datasource/
│                                  # cache/malssum/pipeline/qdrant/safety/search
├── scripts/export_openapi.py       # 무외부접속 계약 생성
├── scripts/                       # 기존 운영·적재·평가 스크립트
├── alembic/versions/               # 기존 revision 유지
├── tests/
├── Dockerfile                     # 저장소 루트 build context
├── docker-compose.yml             # 개발 project: backend
├── pyproject.toml
└── uv.lock
```

도메인은 Router → Service → Repository 책임을 유지한다. Flutter·일반 사용자 인증·알림 확장은 아직 구현 범위가 아니다.

## 로컬 실행

명령은 `apps/api`에서 실행한다. Python 의존성은 uv가 관리하며 웹 작업에 uv 설치를 강제하지 않는다.

1. `.env.example`을 `.env`로 복사하고 개발용 값을 설정한다. 기존 환경 파일을 자동 복제하지 않는다.
2. `uv sync --frozen --all-groups`로 잠긴 의존성을 설치한다.
3. `docker compose up -d postgres qdrant`로 개발 인프라를 실행한다.
4. `uv run alembic upgrade head`로 개발 DB에 기존 마이그레이션을 적용한다.
5. `uv run uvicorn app.main:app --reload --port 8000`으로 API를 시작한다.

web은 `http://localhost:3000`, admin은 `http://localhost:3001`, API 문서는 `http://localhost:8000/docs`다. `ADMIN_FRONTEND_URL`과 `WEB_FRONTEND_URL`은 정확한 origin만 허용한다. 쿠키는 같은 hostname에서 포트별로 격리되지 않는다.

기존 로컬 볼륨 `backend_postgres_data`·`backend_qdrant_data`와 project label `backend`를 확인하여 Compose에 `name: backend`를 고정했다. 테스트 worktree는 `docker compose -p <격리된-이름>`과 `API_PORT`·`POSTGRES_PORT`·`QDRANT_HTTP_PORT`·`QDRANT_GRPC_PORT`를 별도 지정한다. 기존 볼륨을 삭제하지 않는다.

## 계약과 검증

```bash
uv run --frozen python scripts/export_openapi.py
uv run --frozen python scripts/export_openapi.py --check
GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen --all-groups pytest -q
```

exporter는 개인 `.env`·운영 환경변수·lifespan을 사용하지 않고 socket 연결을 차단한다. `--output /absolute/path/openapi.json`으로 임시 산출물을 만들 수 있다. [생성 계약](../../contracts/openapi.json)은 수동 편집하지 않는다.

SSE는 `chunk` → `sources` → `done`이다. `app/modules/chat/stream_schemas.py`의 Pydantic 모델은 OpenAPI의 `x-sse-events`에 연결되고 [공통 fixture](../../contracts/fixtures/chat-stream.json)로 검증한다. 오류 이벤트는 현재 없다. HTTP 오류·중도 끊김·클라이언트 취소를 정상 완료로 해석하지 않는다.

`EMBED_BATCH_SLEEP=0.001`은 I/O를 모킹하는 기존 적재 테스트의 60초 대기를 줄인다. 운영 기본 설정은 변경하지 않는다. paid Gemini 평가·운영 DB 접속은 이 테스트 명령에 포함하지 않는다.

### E2E 격리 인프라

저장소 루트에서 `docker compose -p tw-monorepo-e2e -f apps/api/docker-compose.e2e.yml up -d --wait`를 실행한다. 이 파일은 기존 named volume을 전혀 참조하지 않고 tmpfs만 사용한다. PostgreSQL은 `127.0.0.1:15432`의 `truewords_e2e` DB, Qdrant는 `127.0.0.1:16333`이다.

API 실행·seed 명령에는 `DATABASE_URL=postgresql+asyncpg://truewords:truewords@127.0.0.1:15432/truewords_e2e`, `QDRANT_URL=http://127.0.0.1:16333`, `GEMINI_API_KEY=test-key-for-ci`를 명시한다. `alembic upgrade head` 후 `scripts/create_admin.py <email> test1234`로 `jangwooseng97@gmail.com`과 `admin@test.com` 두 테스트 계정을 만들고 `scripts/seed_chatbot_configs.py`를 실행한다. API를 `--port 18000`으로 실행하고 Playwright의 `E2E_API_ORIGIN=http://127.0.0.1:18000`과 Next의 `NEXT_PUBLIC_API_URL`을 일치시킨다. 기존 개발 계정·DB를 seed 대상으로 사용하지 않는다.

이 Compose의 테스트 데이터는 컨테이너 종료 시 사라진다. 운영 배포 절차가 아니며 테스트 계정과 비밀번호는 로컬 fixture다.

유료 LLM 없이 실제 Next 프록시의 점진 SSE·대화 저장을 검증할 때는 `uv run --frozen uvicorn e2e_app:app --app-dir tests --port 18000`을 사용한다. `tests/e2e_app.py`는 채팅 생성만 공유 fixture와 250ms 간격 이벤트로 대체하며 인증·history·feedback은 실제 API/DB를 사용한다. 이 진입점은 위 격리 DB/Qdrant 주소에서만 시작되고 운영 이미지에 포함되지 않는다. 실제 Gemini 답변 품질 검증의 대체 수단은 아니다.

## 배포

저장소 루트에서 `docker build -f apps/api/Dockerfile -t truewords-backend:<tag> .`을 실행한다. 이미지 내부 엔트리는 `app.main:app`, 운영 Compose 서비스 DNS와 이미지 이름은 기존 `backend`·`truewords-backend`를 유지한다.

Oracle 배포는 [운영 runbook](../../infra/oracle-vm/README.md)을 따른다. main 푸시로 자동 배포되지 않는다. 구조 이전 검증 자체는 운영 배포 권한을 의미하지 않는다.
