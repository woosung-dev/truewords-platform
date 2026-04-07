# TrueWords Backend

FastAPI 기반 RAG AI 챗봇 백엔드 서버

---

## 기술 스택

| 기술 | 버전 | 용도 |
|------|------|------|
| FastAPI | 0.115+ | REST API 프레임워크 |
| Python | 3.11+ | 런타임 |
| SQLModel | 0.0.22+ | ORM (SQLAlchemy + Pydantic) |
| PostgreSQL | 16 | 운영 데이터베이스 |
| Qdrant | latest | 벡터 데이터베이스 (검색 + 캐시) |
| Gemini 2.5 | google-genai | LLM 응답 생성 |
| FastEmbed | qdrant-client 내장 | 임베딩 모델 |
| Alembic | 1.14+ | DB 마이그레이션 |
| uv | - | 패키지 매니저 |

---

## 디렉토리 구조

```
backend/
├── main.py                  # FastAPI 앱 엔트리포인트
├── src/
│   ├── admin/               # 관리자 인증 + 데이터 관리
│   │   ├── auth.py          # JWT 인증
│   │   ├── router.py        # 관리자 인증 API (/api/admin)
│   │   ├── data_router.py   # 데이터 관리 API (/api/admin/data)
│   │   ├── service.py       # 비즈니스 로직
│   │   ├── repository.py    # DB 접근
│   │   ├── models.py        # SQLModel 엔티티
│   │   └── schemas.py       # Pydantic 요청/응답 스키마
│   ├── cache/               # Semantic Cache (Qdrant 컬렉션 기반)
│   ├── chat/                # 채팅 API (RAG 파이프라인 호출)
│   ├── chatbot/             # 챗봇 버전 설정 CRUD
│   ├── common/              # DB 연결, 공통 유틸리티
│   ├── datasource/          # 데이터 소스 관리
│   ├── pipeline/            # 인제스트 파이프라인
│   │   ├── chunker.py       # 계층적 청킹
│   │   ├── embedder.py      # 벡터 임베딩
│   │   └── ingestor.py      # 파이프라인 오케스트레이션
│   ├── safety/              # 보안 가드레일
│   ├── search/              # 하이브리드 검색 (벡터 + 키워드)
│   ├── config.py            # Pydantic Settings (환경변수)
│   └── qdrant_client.py     # Qdrant 클라이언트 싱글턴
├── scripts/
│   ├── ingest.py            # 데이터 인제스트 실행
│   ├── create_admin.py      # 관리자 계정 생성
│   ├── seed_chatbot_configs.py  # 챗봇 설정 시드 데이터
│   └── evaluate.py          # RAG 성능 평가
├── alembic/                 # DB 마이그레이션
│   └── versions/            # 마이그레이션 파일
├── tests/                   # pytest 테스트
├── docker-compose.yml       # PostgreSQL + Qdrant + Backend
├── Dockerfile               # 프로덕션 빌드 (멀티스테이지)
├── pyproject.toml           # 프로젝트 설정 + 의존성
└── uv.lock                  # 의존성 락파일
```

---

## 로컬 개발

### 사전 요구사항

- Docker & Docker Compose
- [uv](https://docs.astral.sh/uv/) — `curl -LsSf https://astral.sh/uv/install.sh | sh`

### 1. 인프라 실행

```bash
# PostgreSQL + Qdrant 컨테이너 실행
docker compose up postgres qdrant -d

# 상태 확인
docker compose ps
```

- PostgreSQL: `localhost:5432` (user: truewords / pw: truewords / db: truewords)
- Qdrant: `localhost:6333` (Dashboard: http://localhost:6333/dashboard)

### 2. 환경변수 설정

```bash
cp .env.example .env
```

`.env` 파일에서 아래 값을 설정:

| 변수 | 필수 | 설명 |
|------|:---:|------|
| `GEMINI_API_KEY` | O | Google AI Studio에서 발급 |
| `DATABASE_URL` | O | 기본값 사용 가능 (Docker Compose 연동) |
| `QDRANT_URL` | O | 기본값: `http://localhost:6333` |
| `ADMIN_JWT_SECRET` | O | JWT 서명 키 (개발용은 아무 문자열) |
| `ADMIN_FRONTEND_URL` | O | CORS 허용 출처 (기본: `http://localhost:3000`) |
| `COLLECTION_NAME` | - | Qdrant 컬렉션명 (기본: `malssum_poc`) |
| `CACHE_THRESHOLD` | - | 캐시 유사도 임계값 (기본: `0.93`) |

### 3. 의존성 설치 + DB 마이그레이션

```bash
# 의존성 설치
uv sync

# DB 테이블 생성
uv run alembic upgrade head
```

### 4. 초기 데이터

```bash
# 관리자 계정 생성
uv run python scripts/create_admin.py

# 챗봇 설정 시드
uv run python scripts/seed_chatbot_configs.py

# 데이터 인제스트 (data/ 폴더의 종교 텍스트)
uv run python scripts/ingest.py
```

### 5. 서버 실행

```bash
uv run uvicorn main:app --reload --port 8000
```

- API 문서 (Swagger): http://localhost:8000/docs
- Health Check: http://localhost:8000/health

---

## API 엔드포인트

| 그룹 | 경로 | 설명 |
|------|------|------|
| Health | `GET /health` | 서버 상태 확인 |
| Chat | `/api/chat/*` | RAG 채팅 (질문 → 응답) |
| Chatbot | `/api/chatbot/*` | 챗봇 버전 설정 (공개) |
| Admin Auth | `/api/admin/*` | 관리자 로그인/인증 |
| Admin Chatbot | `/api/admin/chatbot/*` | 챗봇 설정 관리 |
| Admin Data | `/api/admin/data/*` | 데이터 소스 관리 (업로드/인제스트) |
| DataSource | `/api/datasource/*` | 데이터 소스 목록/상태 |

---

## DB 마이그레이션

```bash
# 새 마이그레이션 생성 (모델 변경 후)
uv run alembic revision --autogenerate -m "설명"

# 마이그레이션 적용
uv run alembic upgrade head

# 마이그레이션 롤백 (1단계)
uv run alembic downgrade -1

# 현재 마이그레이션 상태 확인
uv run alembic current
```

---

## 테스트

```bash
# 전체 테스트 실행
uv run pytest

# 특정 파일 실행
uv run pytest tests/test_ingestor.py

# 상세 출력
uv run pytest -v
```

---

## 배포

### Docker 빌드

```bash
docker build -t truewords-backend .
```

### Docker Compose (풀 스택)

```bash
docker compose up -d
```

### Cloud Run

GitHub Actions CI/CD를 통해 `main` 브랜치 푸시 시 자동 배포됩니다.
상세 설정은 [`docs/06_devops/ci-cd-pipeline.md`](../docs/06_devops/ci-cd-pipeline.md) 참조.

---

## 레이어 아키텍처

```
Router (API 엔드포인트)
  ↓
Service (비즈니스 로직)
  ↓
Repository (DB/Qdrant 접근)
```

- **Router**: 요청 파싱, 응답 직렬화만 담당
- **Service**: 비즈니스 로직 (여러 Repository 조합)
- **Repository**: DB/Qdrant 쿼리만 담당 (AsyncSession 보유)
