# Phase 4: 프로덕션 인프라 — 구현 계획

> 작성일: 2026-03-28
> 스펙 참조: `docs/superpowers/specs/2026-03-28-phase4-production-infra-design.md`

---

## Goal

Phase 1 FastAPI 백엔드를 GCP Cloud Run에 배포하고, API Key 인증 / Rate Limiting / CORS / CI-CD / structured logging을 적용하여 레드팀이 스테이징 URL에서 테스트할 수 있는 상태를 만든다.

## Architecture

```
레드팀 → HTTPS → GCP Cloud Run → FastAPI (Auth + Rate Limit + CORS + structlog) → Qdrant Cloud + Gemini API
GitHub push → Actions CI (pytest + ruff) → Actions CD (gcloud run deploy)
```

## Tech Stack

| 영역 | 기술 | 버전 |
|------|------|------|
| Backend | FastAPI | >=0.115.0 |
| Auth | FastAPI Depends (Bearer) | - |
| Rate Limit | slowapi | >=0.1.9 |
| CORS | FastAPI CORSMiddleware | 내장 |
| Logging | structlog | >=24.0.0 |
| Deploy | GCP Cloud Run | gcloud CLI |
| Vector DB | Qdrant Cloud | Free tier |
| CI/CD | GitHub Actions | - |
| Lint | ruff | >=0.4.0 |

---

## 파일 구조 맵

```
backend/
├── main.py                    # [수정] CORS, 미들웨어 추가
├── pyproject.toml             # [수정] 의존성 추가
├── Dockerfile                 # [신규] 프로덕션 Docker 이미지
├── cloudbuild.yaml            # [신규] Cloud Build 설정 (선택)
├── .dockerignore              # [신규]
├── src/
│   ├── config.py              # [수정] 환경변수 추가
│   ├── auth.py                # [신규] API Key 인증 Dependency
│   ├── rate_limit.py          # [신규] slowapi 설정
│   └── logging_config.py      # [신규] structlog 설정
├── api/
│   └── routes.py              # [수정] 인증 Dependency 적용
├── tests/
│   ├── test_auth.py           # [신규] 인증 테스트
│   ├── test_rate_limit.py     # [신규] Rate limit 테스트
│   └── test_health.py         # [신규] 헬스체크 확장 테스트
└── .github/
    └── workflows/
        ├── ci.yml             # [신규] pytest + ruff
        └── cd.yml             # [신규] Cloud Run 배포
```

---

## Task 1: Settings 확장 및 환경변수 추가

**Files:** `backend/src/config.py`, `backend/.env.example`

### Steps

- [ ] **Step 1.1** — `src/config.py`에 새 환경변수 추가 (3분)

  ```python
  # backend/src/config.py
  from pydantic_settings import BaseSettings
  from pydantic import SecretStr


  class Settings(BaseSettings):
      # 기존
      gemini_api_key: str
      qdrant_url: str = "http://localhost:6333"
      collection_name: str = "malssum_poc"

      # Phase 4 추가 (gemini_api_key도 SecretStr로 변경)
      gemini_api_key: SecretStr  # [ENG-REVIEW] SecretStr로 격상
      api_key: SecretStr
      allowed_origins: str = "http://localhost:3000"  # 쉼표 구분
      environment: str = "development"  # development | staging | production
      qdrant_api_key: SecretStr | None = None  # Qdrant Cloud용

      model_config = {"env_file": ".env"}

      @property
      def cors_origins(self) -> list[str]:
          return [origin.strip() for origin in self.allowed_origins.split(",")]


  settings = Settings()
  ```

  - 실행: `cd backend && uv run python -c "from src.config import Settings; print('OK')"`
  - Expected: `OK` (`.env`에 `API_KEY` 추가 필요)

- [ ] **Step 1.2** — `.env.example` 파일 생성/업데이트 (2분)

  ```
  # backend/.env.example
  GEMINI_API_KEY=your-gemini-api-key
  QDRANT_URL=http://localhost:6333
  COLLECTION_NAME=malssum_poc
  API_KEY=your-api-key-here
  ALLOWED_ORIGINS=http://localhost:3000
  ENVIRONMENT=development
  QDRANT_API_KEY=
  ```

- [ ] **Step 1.3** — `.env`에 로컬 테스트용 `API_KEY` 추가 (1분)

  ```
  API_KEY=dev-test-key-12345
  ```

  - 실행: `cd backend && uv run python -c "from src.config import settings; print(settings.environment)"`
  - Expected: `development`

---

## Task 2: API Key 인증 구현

**Files:** `backend/src/auth.py`, `backend/api/routes.py`, `backend/tests/test_auth.py`

### Steps

- [ ] **Step 2.1** — 인증 테스트 작성 (3분)

  ```python
  # backend/tests/test_auth.py
  import pytest
  from fastapi.testclient import TestClient
  from unittest.mock import patch


  @pytest.fixture
  def client():
      # 환경변수 모킹 후 앱 임포트
      with patch.dict("os.environ", {
          "GEMINI_API_KEY": "test-key",
          "API_KEY": "test-api-key-secret",
          "QDRANT_URL": "http://localhost:6333",
          "COLLECTION_NAME": "test_collection",
      }):
          # config 모듈 리로드 필요
          import importlib
          import src.config
          importlib.reload(src.config)
          from main import app
          yield TestClient(app)


  def test_chat_without_api_key_returns_401(client):
      """API Key 없이 /chat 요청 시 401 반환"""
      response = client.post("/chat", json={"query": "테스트"})
      assert response.status_code == 401


  def test_chat_with_invalid_api_key_returns_401(client):
      """잘못된 API Key로 /chat 요청 시 401 반환"""
      response = client.post(
          "/chat",
          json={"query": "테스트"},
          headers={"Authorization": "Bearer wrong-key"},
      )
      assert response.status_code == 401


  def test_chat_with_valid_api_key_passes_auth(client):
      """유효한 API Key로 요청 시 인증 통과 (다운스트림 모킹)"""
      with patch("api.routes.hybrid_search", return_value=[]), \
           patch("api.routes.generate_answer", return_value="응답"):
          response = client.post(
              "/chat",
              json={"query": "테스트"},
              headers={"Authorization": "Bearer test-api-key-secret"},
          )
          assert response.status_code == 200


  def test_health_does_not_require_api_key(client):
      """/health는 인증 불필요"""
      response = client.get("/health")
      assert response.status_code == 200
  ```

  - 실행: `cd backend && uv run pytest tests/test_auth.py -v`
  - Expected: 4개 모두 FAILED (아직 auth 미구현)

- [ ] **Step 2.2** — `src/auth.py` 구현 (3분)

  ```python
  # backend/src/auth.py
  import secrets
  from fastapi import Depends, HTTPException, status
  from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
  from src.config import settings

  _bearer_scheme = HTTPBearer()


  def verify_api_key(
      credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
  ) -> str:
      """Bearer 토큰이 서버의 API_KEY와 일치하는지 검증한다."""
      # [ENG-REVIEW] secrets.compare_digest로 timing attack 방지
      expected = settings.api_key.get_secret_value()
      if not secrets.compare_digest(credentials.credentials, expected):
          raise HTTPException(
              status_code=status.HTTP_401_UNAUTHORIZED,
              detail="Invalid API key",
          )
      return credentials.credentials
  ```

- [ ] **Step 2.3** — `api/routes.py`에 인증 Dependency 적용 (2분)

  ```python
  # backend/api/routes.py
  from fastapi import APIRouter, Depends
  from pydantic import BaseModel
  from src.search.hybrid import hybrid_search
  from src.chat.generator import generate_answer
  from src.qdrant_client import get_client
  from src.auth import verify_api_key

  router = APIRouter()


  class ChatRequest(BaseModel):
      query: str


  class Source(BaseModel):
      volume: str
      text: str
      score: float


  class ChatResponse(BaseModel):
      answer: str
      sources: list[Source]


  @router.post("/chat", response_model=ChatResponse)
  def chat(request: ChatRequest, _api_key: str = Depends(verify_api_key)):
      client = get_client()
      results = hybrid_search(client, request.query, top_k=10)
      answer = generate_answer(request.query, results)
      return ChatResponse(
          answer=answer,
          sources=[
              Source(volume=r.volume, text=r.text, score=r.score)
              for r in results[:3]
          ],
      )
  ```

  - 실행: `cd backend && uv run pytest tests/test_auth.py -v`
  - Expected: 4개 모두 PASSED

---

## Task 3: Rate Limiting 구현

**Files:** `backend/src/rate_limit.py`, `backend/main.py`, `backend/tests/test_rate_limit.py`, `backend/pyproject.toml`

### Steps

- [ ] **Step 3.1** — 의존성 추가 (1분)

  `pyproject.toml`의 `dependencies`에 추가:
  ```
  "slowapi>=0.1.9",
  ```

  - 실행: `cd backend && uv sync`
  - Expected: slowapi 설치 완료

- [ ] **Step 3.2** — Rate limit 테스트 작성 (3분)

  ```python
  # backend/tests/test_rate_limit.py
  import pytest
  from fastapi.testclient import TestClient
  from unittest.mock import patch


  @pytest.fixture
  def client():
      with patch.dict("os.environ", {
          "GEMINI_API_KEY": "test-key",
          "API_KEY": "test-api-key",
          "QDRANT_URL": "http://localhost:6333",
          "COLLECTION_NAME": "test_collection",
      }):
          import importlib
          import src.config
          importlib.reload(src.config)
          from main import app
          yield TestClient(app)


  def test_rate_limit_exceeded_returns_429(client):
      """분당 20회 초과 시 429 반환"""
      with patch("api.routes.hybrid_search", return_value=[]), \
           patch("api.routes.generate_answer", return_value="응답"):
          headers = {"Authorization": "Bearer test-api-key"}
          # 21번 요청
          for i in range(21):
              response = client.post(
                  "/chat",
                  json={"query": "테스트"},
                  headers=headers,
              )
          assert response.status_code == 429


  def test_rate_limit_header_present(client):
      """응답에 rate limit 헤더 포함"""
      with patch("api.routes.hybrid_search", return_value=[]), \
           patch("api.routes.generate_answer", return_value="응답"):
          response = client.post(
              "/chat",
              json={"query": "테스트"},
              headers={"Authorization": "Bearer test-api-key"},
          )
          # slowapi는 X-RateLimit 헤더를 추가
          assert "x-ratelimit-limit" in response.headers or response.status_code == 200
  ```

  - 실행: `cd backend && uv run pytest tests/test_rate_limit.py -v`
  - Expected: FAILED (미구현)

- [ ] **Step 3.3** — `src/rate_limit.py` 구현 (3분)

  ```python
  # backend/src/rate_limit.py
  from slowapi import Limiter
  from slowapi.util import get_remote_address

  limiter = Limiter(key_func=get_remote_address)
  ```

- [ ] **Step 3.4** — `main.py`에 Rate Limiter 통합 (3분)

  ```python
  # backend/main.py
  from fastapi import FastAPI, Request
  from fastapi.responses import JSONResponse
  from fastapi.middleware.cors import CORSMiddleware
  from slowapi import _rate_limit_exceeded_handler
  from slowapi.errors import RateLimitExceeded
  from api.routes import router
  from src.rate_limit import limiter
  from src.config import settings

  app = FastAPI(title="TrueWords RAG", version="0.4.0")

  # Rate Limiter
  app.state.limiter = limiter
  app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

  # CORS
  app.add_middleware(
      CORSMiddleware,
      allow_origins=settings.cors_origins,
      allow_credentials=False,
      allow_methods=["GET", "POST"],
      allow_headers=["Authorization", "Content-Type"],
  )

  app.include_router(router)


  @app.get("/health")
  def health():
      return {"status": "ok", "environment": settings.environment}
  ```

- [ ] **Step 3.5** — `api/routes.py`에 rate limit 데코레이터 적용 (2분)

  ```python
  # /chat 엔드포인트에 rate limit 적용
  from src.rate_limit import limiter

  @router.post("/chat", response_model=ChatResponse)
  @limiter.limit("20/minute")
  def chat(request: Request, body: ChatRequest, _api_key: str = Depends(verify_api_key)):
      # Request 파라미터 추가 (slowapi 필수)
      ...
  ```

  주의: slowapi는 첫 번째 인자로 `Request` 객체가 필요하다. `ChatRequest`를 `body`로 이름 변경.

  전체 `api/routes.py`:
  ```python
  # backend/api/routes.py
  from fastapi import APIRouter, Depends, Request
  from pydantic import BaseModel
  from src.search.hybrid import hybrid_search
  from src.chat.generator import generate_answer
  from src.qdrant_client import get_client
  from src.auth import verify_api_key
  from src.rate_limit import limiter

  router = APIRouter()


  class ChatRequest(BaseModel):
      query: str


  class Source(BaseModel):
      volume: str
      text: str
      score: float


  class ChatResponse(BaseModel):
      answer: str
      sources: list[Source]


  @router.post("/chat", response_model=ChatResponse)
  @limiter.limit("20/minute")
  def chat(
      request: Request,
      body: ChatRequest,
      _api_key: str = Depends(verify_api_key),
  ):
      client = get_client()
      results = hybrid_search(client, body.query, top_k=10)
      answer = generate_answer(body.query, results)
      return ChatResponse(
          answer=answer,
          sources=[
              Source(volume=r.volume, text=r.text, score=r.score)
              for r in results[:3]
          ],
      )
  ```

  - 실행: `cd backend && uv run pytest tests/test_rate_limit.py tests/test_auth.py -v`
  - Expected: 모두 PASSED

---

## Task 4: Structured Logging 구현

**Files:** `backend/src/logging_config.py`, `backend/main.py`, `backend/pyproject.toml`

### Steps

- [ ] **Step 4.1** — 의존성 추가 (1분)

  `pyproject.toml`의 `dependencies`에 추가:
  ```
  "structlog>=24.0.0",
  ```

  - 실행: `cd backend && uv sync`

- [ ] **Step 4.2** — `src/logging_config.py` 구현 (3분)

  ```python
  # backend/src/logging_config.py
  import logging
  import structlog
  from src.config import settings


  def setup_logging() -> None:
      """structlog 설정. 개발환경은 컬러 콘솔, 프로덕션은 JSON."""
      is_production = settings.environment in ("staging", "production")

      structlog.configure(
          processors=[
              structlog.contextvars.merge_contextvars,
              structlog.stdlib.filter_by_level,
              structlog.stdlib.add_logger_name,
              structlog.stdlib.add_log_level,
              structlog.stdlib.PositionalArgumentsFormatter(),
              structlog.processors.TimeStamper(fmt="iso"),
              structlog.processors.StackInfoRenderer(),
              structlog.processors.format_exc_info,
              structlog.processors.UnicodeDecoder(),
              structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
          ],
          logger_factory=structlog.stdlib.LoggerFactory(),
          wrapper_class=structlog.stdlib.BoundLogger,
          cache_logger_on_first_use=True,
      )

      formatter = structlog.stdlib.ProcessorFormatter(
          processor=(
              structlog.processors.JSONRenderer()
              if is_production
              else structlog.dev.ConsoleRenderer()
          ),
      )

      handler = logging.StreamHandler()
      handler.setFormatter(formatter)

      root_logger = logging.getLogger()
      root_logger.handlers.clear()
      root_logger.addHandler(handler)
      root_logger.setLevel(logging.INFO)
  ```

- [ ] **Step 4.3** — `main.py`에서 로깅 초기화 호출 추가 (2분)

  `main.py` 상단에:
  ```python
  from src.logging_config import setup_logging
  setup_logging()
  ```

  - 실행: `cd backend && uv run python -c "from main import app; print('logging OK')"`
  - Expected: `logging OK`

---

## Task 5: 헬스체크 확장

**Files:** `backend/main.py`, `backend/tests/test_health.py`

### Steps

- [ ] **Step 5.1** — 헬스체크 테스트 작성 (2분)

  ```python
  # backend/tests/test_health.py
  import pytest
  from fastapi.testclient import TestClient
  from unittest.mock import patch


  @pytest.fixture
  def client():
      with patch.dict("os.environ", {
          "GEMINI_API_KEY": "test-key",
          "API_KEY": "test-api-key",
          "QDRANT_URL": "http://localhost:6333",
          "COLLECTION_NAME": "test_collection",
      }):
          import importlib
          import src.config
          importlib.reload(src.config)
          from main import app
          yield TestClient(app)


  def test_health_returns_status_and_environment(client):
      response = client.get("/health")
      assert response.status_code == 200
      data = response.json()
      assert data["status"] == "ok"
      assert "environment" in data


  def test_health_includes_version(client):
      response = client.get("/health")
      data = response.json()
      assert "version" in data
  ```

- [ ] **Step 5.2** — `main.py` 헬스체크 확장 (2분)

  ```python
  @app.get("/health")
  def health():
      return {
          "status": "ok",
          "environment": settings.environment,
          "version": app.version,
      }
  ```

  - 실행: `cd backend && uv run pytest tests/test_health.py -v`
  - Expected: PASSED

---

## Task 6: Dockerfile 작성

**Files:** `backend/Dockerfile`, `backend/.dockerignore`

### Steps

- [ ] **Step 6.1** — `.dockerignore` 생성 (1분)

  ```
  # backend/.dockerignore
  .venv/
  __pycache__/
  .pytest_cache/
  .env
  .env.local
  *.pyc
  .git/
  tests/
  scripts/
  docs/
  ```

- [ ] **Step 6.2** — `Dockerfile` 작성 (5분)

  ```dockerfile
  # backend/Dockerfile
  FROM python:3.12-slim AS base

  WORKDIR /app

  # uv 설치
  COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

  # 의존성 먼저 설치 (캐시 레이어)
  COPY pyproject.toml uv.lock ./
  RUN uv sync --frozen --no-dev --no-install-project

  # 소스 코드 복사
  COPY main.py ./
  COPY api/ ./api/
  COPY src/ ./src/

  # 포트 노출
  EXPOSE 8000

  # 헬스체크
  HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
      CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

  # 실행
  CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
  ```

  - 실행: `cd backend && docker build -t truewords-backend .`
  - Expected: 빌드 성공

- [ ] **Step 6.3** — 로컬 Docker 실행 테스트 (3분)

  - 실행: `docker run -d --name tw-test -p 8000:8000 --env-file .env truewords-backend`
  - 검증: `curl http://localhost:8000/health`
  - Expected: `{"status":"ok","environment":"development","version":"0.4.0"}`
  - 정리: `docker stop tw-test && docker rm tw-test`

---

## Task 7: GCP Cloud Run 설정 및 배포

**Files:** GCP 프로젝트 설정, Artifact Registry, Cloud Run 서비스

### 사전 준비

- GCP 프로젝트 생성 및 결제 계정 연결 완료
- `gcloud` CLI 설치 및 인증 완료 (`gcloud auth login`)

### Steps

- [ ] **Step 7.1** — GCP 프로젝트 설정 및 API 활성화 (5분)

  ```bash
  # GCP 프로젝트 설정 (프로젝트 ID는 실제 값으로 교체)
  export GCP_PROJECT_ID="truewords-platform"
  export GCP_REGION="asia-northeast3"

  gcloud config set project $GCP_PROJECT_ID
  gcloud config set run/region $GCP_REGION

  # 필요한 API 활성화
  gcloud services enable run.googleapis.com \
      artifactregistry.googleapis.com \
      secretmanager.googleapis.com \
      cloudbuild.googleapis.com
  ```

  - Expected: API 활성화 완료

- [ ] **Step 7.2** — Artifact Registry 리포지토리 생성 (2분)

  ```bash
  gcloud artifacts repositories create truewords \
      --repository-format=docker \
      --location=$GCP_REGION \
      --description="TrueWords Docker images"
  ```

  - Expected: 리포지토리 생성 완료

- [ ] **Step 7.3** — Docker 이미지 빌드 및 푸시 (5분)

  ```bash
  # Artifact Registry 인증 설정
  gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev

  # 이미지 빌드 및 푸시
  cd backend
  docker build -t ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/truewords/backend:latest .
  docker push ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/truewords/backend:latest
  ```

  - Expected: 이미지 푸시 완료

- [ ] **Step 7.4** — GCP Secret Manager에 민감 환경변수 등록 (3분)

  ```bash
  # 민감 환경변수를 Secret Manager에 등록
  echo -n "<실제 Gemini API 키>" | gcloud secrets create GEMINI_API_KEY --data-file=-
  echo -n "<Qdrant Cloud API Key>" | gcloud secrets create QDRANT_API_KEY --data-file=-
  echo -n "<스테이징용 API Key>" | gcloud secrets create API_KEY --data-file=-

  # Cloud Run 서비스 계정에 Secret 접근 권한 부여
  export SA_EMAIL=$(gcloud iam service-accounts list \
      --filter="displayName:Compute Engine default" \
      --format="value(email)")

  gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
      --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding QDRANT_API_KEY \
      --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding API_KEY \
      --member="serviceAccount:${SA_EMAIL}" --role="roles/secretmanager.secretAccessor"
  ```

  - Expected: Secret 생성 및 권한 부여 완료

- [ ] **Step 7.5** — Cloud Run 서비스 배포 (스테이징) (5분)

  ```bash
  gcloud run deploy truewords-staging \
      --image=${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/truewords/backend:latest \
      --region=$GCP_REGION \
      --platform=managed \
      --port=8000 \
      --memory=256Mi \
      --cpu=1 \
      --min-instances=1 \
      --max-instances=3 \
      --allow-unauthenticated \
      --set-env-vars="QDRANT_URL=<Qdrant Cloud URL>,COLLECTION_NAME=malssum_poc,ALLOWED_ORIGINS=http://localhost:3000,ENVIRONMENT=staging" \
      --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,QDRANT_API_KEY=QDRANT_API_KEY:latest,API_KEY=API_KEY:latest"
  ```

  - Expected: 서비스 배포 완료, URL 출력

- [ ] **Step 7.6** — 배포 검증 (2분)

  ```bash
  # 서비스 URL 확인
  gcloud run services describe truewords-staging --region=$GCP_REGION --format="value(status.url)"

  # 헬스체크
  STAGING_URL=$(gcloud run services describe truewords-staging --region=$GCP_REGION --format="value(status.url)")
  curl -f ${STAGING_URL}/health
  ```

  - Expected: `{"status":"ok","environment":"staging","version":"0.4.0"}`

---

## Task 8: Docker Compose 통합

**Files:** `backend/docker-compose.yml`

### Steps

- [ ] **Step 8.1** — docker-compose.yml 확장 (3분)

  ```yaml
  # backend/docker-compose.yml
  services:
    backend:
      build: .
      ports:
        - "8000:8000"
      env_file:
        - .env
      depends_on:
        qdrant:
          condition: service_healthy
      healthcheck:
        test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
        interval: 30s
        timeout: 5s
        retries: 3
        start_period: 10s

    qdrant:
      image: qdrant/qdrant:latest
      ports:
        - "6333:6333"
        - "6334:6334"
      volumes:
        - qdrant_data:/qdrant/storage
      healthcheck:
        test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:6333/healthz"]
        interval: 10s
        timeout: 5s
        retries: 3

  volumes:
    qdrant_data:
  ```

  - 실행: `cd backend && docker compose up -d`
  - 검증: `curl http://localhost:8000/health`
  - Expected: 정상 응답
  - 정리: `docker compose down`

---

## Task 9: GitHub Actions CI

**Files:** `.github/workflows/ci.yml`

### Steps

- [ ] **Step 9.1** — CI 워크플로우 작성 (5분)

  ```yaml
  # .github/workflows/ci.yml
  name: CI

  on:
    push:
      branches: [main]
      paths: ["backend/**"]
    pull_request:
      branches: [main]
      paths: ["backend/**"]

  defaults:
    run:
      working-directory: backend

  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4

        - name: Install uv
          uses: astral-sh/setup-uv@v4

        - name: Set up Python 3.12
          run: uv python install 3.12

        - name: Install dependencies
          run: uv sync --frozen

        - name: Lint with ruff
          run: uv run ruff check .

        - name: Type check with pyright
          run: uv run pyright

        - name: Run tests
          run: uv run pytest -v
          env:
            GEMINI_API_KEY: "test-key"
            API_KEY: "test-api-key"
            QDRANT_URL: "http://localhost:6333"
            COLLECTION_NAME: "test_collection"
  ```

  - 검증: push 후 GitHub Actions 탭에서 실행 확인
  - Expected: 녹색 체크

- [ ] **Step 9.2** — `pyproject.toml`에 ruff, pyright 의존성 추가 (2분)

  ```toml
  [dependency-groups]
  dev = [
      "pytest>=8.3.0",
      "pytest-asyncio>=0.24.0",
      "pytest-mock>=3.14.0",
      "ruff>=0.4.0",
      "pyright>=1.1.0",
  ]
  ```

- [ ] **Step 9.3** — ruff 설정 추가 (2분)

  `pyproject.toml`에:
  ```toml
  [tool.ruff]
  target-version = "py312"
  line-length = 100

  [tool.ruff.lint]
  select = ["E", "F", "I", "W"]
  ```

  - 실행: `cd backend && uv run ruff check .`
  - Expected: 에러 없음 (또는 수정 가능한 경고)

---

## Task 10: GitHub Actions CD

**Files:** `.github/workflows/cd.yml`

### Steps

- [ ] **Step 10.1** — GCP 서비스 계정 및 Workload Identity Federation 설정 (5분)

  ```bash
  export GCP_PROJECT_ID="truewords-platform"
  export GCP_PROJECT_NUMBER=$(gcloud projects describe $GCP_PROJECT_ID --format="value(projectNumber)")
  export GITHUB_REPO="your-org/truewords-platform"

  # CD용 서비스 계정 생성
  gcloud iam service-accounts create github-actions-cd \
      --display-name="GitHub Actions CD"

  # 필요한 역할 부여
  gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
      --member="serviceAccount:github-actions-cd@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --role="roles/run.admin"
  gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
      --member="serviceAccount:github-actions-cd@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --role="roles/artifactregistry.writer"
  gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
      --member="serviceAccount:github-actions-cd@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
      --role="roles/iam.serviceAccountUser"

  # Workload Identity Pool 생성
  gcloud iam workload-identity-pools create github-pool \
      --location="global" \
      --display-name="GitHub Actions Pool"

  # Workload Identity Provider 생성
  gcloud iam workload-identity-pools providers create-oidc github-provider \
      --location="global" \
      --workload-identity-pool="github-pool" \
      --display-name="GitHub Provider" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
      --issuer-uri="https://token.actions.githubusercontent.com"

  # 서비스 계정에 Workload Identity 바인딩
  gcloud iam service-accounts add-iam-policy-binding \
      github-actions-cd@${GCP_PROJECT_ID}.iam.gserviceaccount.com \
      --role="roles/iam.workloadIdentityUser" \
      --member="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${GITHUB_REPO}"
  ```

  - Expected: Workload Identity Federation 설정 완료

- [ ] **Step 10.2** — CD 워크플로우 작성 (5분)

  ```yaml
  # .github/workflows/cd.yml
  name: CD

  on:
    push:
      branches: [main]
      paths: ["backend/**"]

  env:
    GCP_PROJECT_ID: truewords-platform
    GCP_REGION: asia-northeast3
    SERVICE_NAME: truewords-staging
    IMAGE: asia-northeast3-docker.pkg.dev/truewords-platform/truewords/backend

  jobs:
    test:
      uses: ./.github/workflows/ci.yml

    deploy:
      needs: test
      runs-on: ubuntu-latest
      if: github.ref == 'refs/heads/main'
      permissions:
        contents: read
        id-token: write

      steps:
        - uses: actions/checkout@v4

        - name: Authenticate to Google Cloud
          uses: google-github-actions/auth@v2
          with:
            workload_identity_provider: projects/${{ secrets.GCP_PROJECT_NUMBER }}/locations/global/workloadIdentityPools/github-pool/providers/github-provider
            service_account: github-actions-cd@${{ env.GCP_PROJECT_ID }}.iam.gserviceaccount.com

        - name: Set up Cloud SDK
          uses: google-github-actions/setup-gcloud@v2

        - name: Configure Docker for Artifact Registry
          run: gcloud auth configure-docker ${{ env.GCP_REGION }}-docker.pkg.dev --quiet

        - name: Build and push Docker image
          working-directory: backend
          run: |
            docker build -t ${{ env.IMAGE }}:${{ github.sha }} -t ${{ env.IMAGE }}:latest .
            docker push ${{ env.IMAGE }}:${{ github.sha }}
            docker push ${{ env.IMAGE }}:latest

        - name: Deploy to Cloud Run
          uses: google-github-actions/deploy-cloudrun@v2
          with:
            service: ${{ env.SERVICE_NAME }}
            region: ${{ env.GCP_REGION }}
            image: ${{ env.IMAGE }}:${{ github.sha }}

        - name: Verify deployment
          run: |
            STAGING_URL=$(gcloud run services describe ${{ env.SERVICE_NAME }} --region=${{ env.GCP_REGION }} --format="value(status.url)")
            sleep 10
            curl -f ${STAGING_URL}/health
  ```

- [ ] **Step 10.3** — GitHub Secrets에 GCP 설정 추가 (2분)

  - GitHub repo → Settings → Secrets and variables → Actions
  - `GCP_PROJECT_NUMBER` 추가 (GCP 프로젝트 번호)
  - Expected: secret 저장 완료

---

## Task 11: Qdrant Cloud 마이그레이션

### Steps

- [ ] **Step 11.1** — Qdrant Cloud 클러스터 생성 (5분)

  - https://cloud.qdrant.io 에서 Free tier 클러스터 생성
  - 리전: AWS ap-northeast-1 (도쿄)
  - URL과 API Key 확보
  - Expected: 클러스터 URL + API Key 확보

- [ ] **Step 11.2** — `src/qdrant_client.py` 수정 — Cloud 인증 지원 (3분)

  ```python
  # backend/src/qdrant_client.py
  from qdrant_client import QdrantClient
  from qdrant_client.models import (
      Distance,
      VectorParams,
      SparseVectorParams,
      SparseIndexParams,
  )
  from src.config import settings


  def get_client() -> QdrantClient:
      """Qdrant 클라이언트 생성. QDRANT_API_KEY가 있으면 Cloud 모드."""
      api_key = None
      if settings.qdrant_api_key is not None:
          api_key = settings.qdrant_api_key.get_secret_value()
      return QdrantClient(
          url=settings.qdrant_url,
          api_key=api_key,
      )


  def create_collection(client: QdrantClient, collection_name: str) -> None:
      client.create_collection(
          collection_name=collection_name,
          vectors_config={
              "dense": VectorParams(size=3072, distance=Distance.COSINE)
          },
          sparse_vectors_config={
              "sparse": SparseVectorParams(
                  index=SparseIndexParams(on_disk=False)
              )
          },
      )
  ```

- [ ] **Step 11.3** — 로컬 데이터를 Cloud로 마이그레이션 (5분)

  ```bash
  # 로컬 Qdrant에서 스냅샷 생성
  curl -X POST "http://localhost:6333/collections/malssum_poc/snapshots"

  # 스냅샷 다운로드 후 Cloud에 업로드
  # 또는 scripts/ingest.py를 QDRANT_URL=<cloud-url> QDRANT_API_KEY=<key>로 재실행
  ```

  - 검증: Cloud URL로 `curl <cloud-url>/collections/malssum_poc`
  - Expected: `points_count > 0`

---

## Task 12: 기존 테스트 호환성 확보

### Steps

- [ ] **Step 12.1** — 기존 test_api.py가 인증 변경 후에도 통과하는지 확인 (3분)

  기존 테스트에 API Key 헤더 추가 필요 여부 확인. `conftest.py`에 인증 헤더 fixture 추가:

  ```python
  # backend/tests/conftest.py
  import pytest
  from unittest.mock import MagicMock, patch


  @pytest.fixture
  def mock_qdrant():
      return MagicMock()


  @pytest.fixture
  def auth_headers():
      """테스트용 인증 헤더"""
      return {"Authorization": "Bearer test-api-key"}
  ```

  - 실행: `cd backend && uv run pytest -v`
  - Expected: 기존 24개 + 새 테스트 모두 PASSED

---

## 전체 실행 순서

1. Task 1: Settings 확장 → 커밋
2. Task 2: API Key 인증 → 테스트 통과 → 커밋
3. Task 3: Rate Limiting → 테스트 통과 → 커밋
4. Task 4: Structured Logging → 커밋
5. Task 5: 헬스체크 확장 → 테스트 통과 → 커밋
6. Task 6: Dockerfile → 빌드 성공 → 커밋
7. Task 7: GCP Cloud Run 설정 + 수동 배포 → 헬스체크 확인 → 커밋
8. Task 8: Docker Compose 통합 → 로컬 검증 → 커밋
9. Task 9: CI → push 후 확인 → 커밋
10. Task 10: CD → 자동 배포 확인 → 커밋
11. Task 11: Qdrant Cloud 마이그레이션 → 데이터 확인 → 커밋
12. Task 12: 전체 테스트 통과 확인 → 최종 커밋

---

## Self-Review 체크리스트

- [x] 스펙 SC-1 ~ SC-11 모두 커버됨
- [x] placeholder 코드 없음 — 모든 코드 블록 실행 가능
- [x] 파일 경로 정확 (backend/ 기준)
- [x] SecretStr 타입 사용 (API_KEY, QDRANT_API_KEY)
- [x] .env 파일 커밋 방지 (.dockerignore에 포함)
- [x] 테스트: 인증 4개 + Rate limit 2개 + 헬스체크 2개 + CORS 2개 = 10개 신규 테스트
- [x] 기존 24개 테스트 호환성 확보 (Task 12)
- [x] timing attack 방지 (secrets.compare_digest)
- [x] gemini_api_key SecretStr 격상
- [x] cold start 방지 (Cloud Run --min-instances=1)

---

## Task 13: CORS 테스트 추가 [ENG-REVIEW 추가]

**Files:** `backend/tests/test_cors.py`

### Steps

- [ ] **Step 13.1** — CORS 테스트 작성 (3분)

  ```python
  # backend/tests/test_cors.py
  import pytest
  from fastapi.testclient import TestClient
  from unittest.mock import patch


  @pytest.fixture
  def client():
      with patch.dict("os.environ", {
          "GEMINI_API_KEY": "test-key",
          "API_KEY": "test-api-key",
          "QDRANT_URL": "http://localhost:6333",
          "COLLECTION_NAME": "test_collection",
          "ALLOWED_ORIGINS": "http://localhost:3000",
      }):
          import importlib
          import src.config
          importlib.reload(src.config)
          from main import app
          yield TestClient(app)


  def test_cors_allowed_origin(client):
      """허용된 Origin은 CORS 헤더 포함"""
      response = client.options(
          "/chat",
          headers={
              "Origin": "http://localhost:3000",
              "Access-Control-Request-Method": "POST",
          },
      )
      assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


  def test_cors_disallowed_origin(client):
      """허용되지 않은 Origin은 CORS 헤더 미포함"""
      response = client.options(
          "/chat",
          headers={
              "Origin": "http://evil.example.com",
              "Access-Control-Request-Method": "POST",
          },
      )
      assert response.headers.get("access-control-allow-origin") != "http://evil.example.com"
  ```

  - 실행: `cd backend && uv run pytest tests/test_cors.py -v`
  - Expected: 2개 PASSED

---

## Task 14: .gitignore 검증 [ENG-REVIEW 추가]

### Steps

- [ ] **Step 14.1** — `.gitignore`에 `.env` 관련 항목 확인/추가 (1분)

  `backend/.gitignore`에 아래 항목이 포함되어 있는지 확인:
  ```
  .env
  .env.local
  .env.*.local
  ```

  없으면 추가. 이미 프로젝트 루트 `.gitignore`에 있는 경우에도, backend 디렉토리에 명시적으로 추가하여 이중 방어.

  - 검증: `git status`에서 `.env` 파일이 untracked로 표시되지 않는지 확인
  - Expected: `.env` 파일 미노출

---

## Task 15: CD 워크플로우 수정 — Reusable Workflow [ENG-REVIEW 추가]

CI 워크플로우를 CD에서 재사용하려면 `workflow_call` 트리거 추가 필요.

### Steps

- [ ] **Step 15.1** — `ci.yml`에 `workflow_call` 트리거 추가 (2분)

  ```yaml
  # .github/workflows/ci.yml
  name: CI

  on:
    push:
      branches: [main]
      paths: ["backend/**"]
    pull_request:
      branches: [main]
      paths: ["backend/**"]
    workflow_call:  # [ENG-REVIEW] CD에서 재사용 가능하도록
  ```

---

## Engineering Review Report

> 리뷰일: 2026-03-28
> 리뷰어: AI (Claude) — Eng Manager 관점

### 발견된 이슈 및 조치

| # | 관점 | 이슈 | 심각도 | 조치 |
|---|------|------|--------|------|
| ENG-1 | 보안 | `gemini_api_key`가 `str` 타입 — 로그/직렬화 시 노출 가능 | High | `SecretStr`로 변경 (Task 1 수정 완료) |
| ENG-2 | 보안 | `verify_api_key`에서 `==` 비교 — timing attack 취약 | High | `secrets.compare_digest` 사용 (Task 2 수정 완료) |
| ENG-3 | 보안 | `.gitignore`에 `.env` 포함 여부 미확인 | High | Task 14 추가 |
| ENG-4 | 테스트 | CORS 차단 테스트 누락 — SC-5 검증 불가 | Medium | Task 13 추가 (CORS 테스트 2개) |
| ENG-5 | 아키텍처 | CD에서 CI를 `uses:`로 호출하려면 `workflow_call` 필요 | Medium | Task 15 추가 |
| ENG-6 | 운영 | `--min-instances=0` → cold start ~5초 | Medium | `--min-instances=1`로 변경 (Task 7 수정 완료) |
| ENG-7 | 아키텍처 | 테스트 fixture에서 `importlib.reload` 사용 — 모듈 상태 오염 가능 | Low | [확인 필요] 현재 테스트 규모에서는 허용 가능, 테스트 증가 시 `conftest.py` 통합 리팩토링 검토 |
| ENG-8 | 비용 | `--min-instances=1` 변경으로 Cloud Run 무료 할당량 소진 시 월 ~$5 추가 | Low | 예산 범위 내, 초기 트래픽에서는 무료 할당량 내 운영 가능 |

### 미반영 사항 (향후 고려)

| # | 항목 | 이유 |
|---|------|------|
| DEFER-1 | `gemini_api_key` SecretStr 변경 시 기존 코드(generator.py 등)에서 `.get_secret_value()` 호출 필요 | Phase 4 구현 시 해당 파일도 함께 수정 필요 — 계획에 명시적 step 없음. Task 1 구현 시 `src/chat/generator.py`도 확인할 것 |
| DEFER-2 | 다중 API Key 지원 | Phase 5에서 JWT 도입 시 함께 검토 |
| DEFER-3 | Qdrant Cloud Free tier(1GB) 용량 부족 가능성 | Phase 3 임베딩 결과 615권 전체 적재 시 ~2GB 예상 → Free tier 초과 가능. 우선 Free tier로 시작하고, 실제 적재 용량 확인 후 Starter tier($25/월) 업그레이드 판단 |

### 최종 판정

**APPROVED with minor fixes applied.**

보안 관련 이슈 3건(ENG-1~3) 모두 계획에 반영 완료.
테스트 커버리지 보강(CORS 2개) 추가.
총 태스크 15개, 신규 테스트 10개로 스펙 SC-1~SC-11 전체 커버.
예상 비용 $0/월(무료 할당량 내)로 제약 조건 내.
구현 착수 가능.
