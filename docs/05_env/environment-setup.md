# 환경 설정 ��이드

## 로컬 개발 환경

### 사전 요구사항
- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (Python 패키지 매니저)
- Node.js 22+
- Docker & Docker Compose

### 백엔드 설정

```bash
cd backend

# 1. 환경변수 설정
cp .env.example .env
# .env 파일에서 GEMINI_API_KEY 입력

# 2. 인프라 실행 (PostgreSQL + Qdrant)
docker compose up -d postgres qdrant

# 3. 의존성 설치
uv sync

# 4. 서버 실행
uv run uvicorn main:app --reload --port 8000
```

### 프론트엔드 설정

```bash
cd admin

# 1. 의존성 설치
npm install

# 2. 개발 서버 실행
npm run dev
# → http://localhost:3000
```

### 테스트용 관리자 계정 정보 (초기 셋업용)

로컬 서버 구동 시 아래 계정으로 대시보드(`http://localhost:3000`)에 바로 접근할 수 있습니다.
- **이메일:** `admin@truewords.com`
- **비밀번호:** `admin1234`

### Docker Compose 전체 실행 (백엔드 포함)

```bash
cd backend
docker compose up --build
# → 백엔드: http://localhost:8000
# → Qdrant: http://localhost:6333
# → PostgreSQL: localhost:5432
```

---

## 환경 변수 레퍼런스

| 변수 | 설명 | 기본값 | 필수 |
|------|------|--------|------|
| `ENVIRONMENT` | 환경 구분 | `development` | - |
| `GEMINI_API_KEY` | Gemini API 키 | - | **��수** |
| `QDRANT_URL` | Qdrant 서버 URL | `http://localhost:6333` | - |
| `COLLECTION_NAME` | 말씀 컬렉션 이름 | `malssum_poc_v5` | - |
| `DATABASE_URL` | PostgreSQL 연결 문자열 | `postgresql+asyncpg://...localhost...` | - |
| `ADMIN_JWT_SECRET` | JWT 서명 시크릿 | `change-me-in-production` | 프로덕션 필수 |
| `ADMIN_JWT_EXPIRE_MINUTES` | JWT 만료 시간 (분) | `1440` | - |
| `ADMIN_FRONTEND_URL` | admin CORS 허용 URL | `http://localhost:3000` | - |
| `COOKIE_SECURE` | HTTPS 전용 쿠키 | `false` | 프로덕션 `true` |
| `CACHE_COLLECTION_NAME` | 시맨틱 캐시 컬렉션 | `semantic_cache` | - |
| `CACHE_THRESHOLD` | 캐시 유사도 임계값 | `0.93` | - |
| `CACHE_TTL_DAYS` | 캐시 TTL (일) | `7` | - |
| `NEXT_PUBLIC_API_URL` | (프론트엔드) API 서버 URL | `http://localhost:8000` | - |

---

## 환경별 설정

| 변수 | 로컬 | 스테이징 | 프로덕션 |
|------|------|----------|----------|
| `ENVIRONMENT` | `development` | `staging` | `production` |
| `DATABASE_URL` | `localhost:5432/truewords` | Cloud SQL · DB `truewords_staging` | Cloud SQL · DB `truewords` |
| `QDRANT_URL` | `localhost:6333` | Qdrant Cloud (같은 클러스터) | Qdrant Cloud (같은 클러스터) |
| `COLLECTION_NAME` | `malssum_poc_v5` | `malssum_poc_v5_staging` (자동) | `malssum_poc_v5` |
| `CACHE_COLLECTION_NAME` | `semantic_cache` | `semantic_cache_staging` (자동) | `semantic_cache` |
| `ADMIN_FRONTEND_URL` | `localhost:3000` | Vercel Preview URL | `https://admin.truewords.app` |
| `COOKIE_SECURE` | `false` | `true` | `true` |
| `GEMINI_API_KEY` | 로컬 키 | Secret Manager `gemini-api-key-staging` | Secret Manager `gemini-api-key` |
| `ADMIN_JWT_SECRET` | 개발용 | Secret Manager `admin-jwt-secret-staging` | Secret Manager `admin-jwt-secret` |

> "자동" 표기는 `ENVIRONMENT=staging` 시 `backend/src/config.py` 의 `apply_environment_suffix` validator 가 접미사를 자동으로 부여하는 동작(기본값일 때만, 명시 override 존중).
> 전체 분리 설계(Cloud Run 서비스 분리, Vercel Preview, GitHub Actions 파이프라인, Secret Manager) 는 [Staging 환경 분리 설계](../07_infra/staging-separation.md) 참조.

---

## DB 마이그레이션

```bash
cd backend

# 마이그레이션 생성 (모델 변경 후)
uv run alembic revision --autogenerate -m "설명"

# 마이그레이션 적용
uv run alembic upgrade head

# 마이그레이션 롤백
uv run alembic downgrade -1

# 현재 버전 확인
uv run alembic current
```

> 로컬 개발 시 `init_db()`가 자동으로 테이블을 생성합니다.
> 프로덕션에서는 `init_db()` 스킵 → Alembic 마이그레이션으로 관리.
