# TrueWords Platform

종교 텍스트(615권) 기반 RAG AI 챗봇 플랫폼

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| Frontend (App) | Flutter |
| Frontend (Admin) | Next.js 16 + React 19 + TailwindCSS 4 |
| Backend | FastAPI + Python 3.11+ |
| Database | PostgreSQL 16 |
| Vector DB | Qdrant |
| AI Model | Google Gemini 2.5 |
| Embedding | FastEmbed (qdrant-client 내장) |
| Deploy | GCP Cloud Run (Backend) + Vercel (Admin) |

---

## 프로젝트 구조

```
truewords-platform/
├── backend/               # FastAPI 백엔드
│   ├── main.py            # FastAPI 앱 엔트리포인트
│   ├── src/
│   │   ├── admin/         # 관리자 인증, 데이터 관리 API
│   │   ├── cache/         # Semantic Cache (Qdrant 기반)
│   │   ├── chat/          # 채팅 API (RAG 응답 생성)
│   │   ├── chatbot/       # 챗봇 버전 설정 API
│   │   ├── common/        # DB 연결, 공통 유틸리티
│   │   ├── datasource/    # 데이터 소스 관리 API
│   │   ├── pipeline/      # 데이터 인제스트 파이프라인 (청킹, 임베딩)
│   │   ├── safety/        # 보안 가드레일
│   │   ├── search/        # 하이브리드 검색 (벡터 + 키워드)
│   │   ├── config.py      # Pydantic Settings
│   │   └── qdrant_client.py
│   ├── scripts/           # 유틸리티 스크립트
│   │   ├── ingest.py      # 데이터 인제스트 실행
│   │   ├── create_admin.py # 관리자 계정 생성
│   │   ├── seed_chatbot_configs.py
│   │   └── evaluate.py    # RAG 평가
│   ├── alembic/           # DB 마이그레이션
│   ├── tests/             # 테스트
│   ├── docker-compose.yml # PostgreSQL + Qdrant + Backend
│   └── pyproject.toml     # uv 패키지 관리
├── admin/                 # Next.js 관리자 대시보드
│   ├── src/
│   │   ├── app/           # Next.js App Router
│   │   ├── components/    # UI 컴포넌트
│   │   └── lib/           # API 클라이언트, 유틸리티
│   └── package.json
├── data/                  # 원본 데이터 (종교 텍스트)
└── docs/                  # 설계 문서
    ├── 00_project/        # 프로젝트 개요
    ├── 01_requirements/   # 기능 명세
    ├── 02_domain/         # 도메인 모델
    ├── 04_architecture/   # 시스템 설계
    ├── 05_env/            # 환경 설정
    ├── 06_devops/         # CI/CD
    ├── 07_infra/          # 인프라 구성
    ├── dev-log/           # 의사결정 기록 (ADR)
    └── guides/            # 개발 가이드
```

---

## 로컬 개발 환경 설정

### 사전 요구사항

- Docker & Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python 패키지 매니저)
- Node.js 22+

### 1. 환경변수 설정

```bash
# 백엔드
cp backend/.env.example backend/.env
# .env 파일에서 GEMINI_API_KEY 등 필수 값 설정

# 프론트엔드
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > admin/.env.local
```

### 2. DB 실행 (PostgreSQL + Qdrant)

```bash
cd backend
docker compose up postgres qdrant -d
```

### 3. 백엔드 실행

```bash
cd backend

# 의존성 설치
uv sync

# DB 마이그레이션
uv run alembic upgrade head

# 관리자 계정 생성 (최초 1회)
uv run python scripts/create_admin.py

# 서버 실행 (자동 리로드)
uv run uvicorn main:app --reload --port 8000
```

- API 문서: http://localhost:8000/docs
- Health Check: http://localhost:8000/health

### 4. Admin 프론트엔드 실행

```bash
cd admin

pnpm install
pnpm dev
```

- Admin 대시보드: http://localhost:3000

### 5. 데이터 인제스트 (선택)

```bash
cd backend
uv run python scripts/ingest.py
```

---

## 핵심 기능

- **RAG 파이프라인**: 계층적 청킹 + 하이브리드 검색 (벡터 + 키워드) + Re-ranking
- **다중 챗봇 버전**: 데이터 소스 A|B|C|D 조합별 필터링 검색
- **Semantic Cache**: Qdrant 기반 유사 질문 캐시 (비용 절감 + 응답 속도 향상)
- **보안 가드레일**: 악의적 질문 방어, 답변 범위 제한
- **관리자 대시보드**: 데이터 소스/챗봇/카테고리 관리

---

## 아키텍처

```
┌─────────────┐     ┌─────────────┐
│ Flutter App  │     │ Admin (Next)│
└──────┬───────┘     └──────┬──────┘
       │                    │
       └────────┬───────────┘
                │ REST API
         ┌──────▼──────┐
         │   FastAPI    │
         │  (Cloud Run) │
         └──┬───┬───┬──┘
            │   │   │
    ┌───────▼┐ ┌▼────▼──────┐
    │Qdrant  │ │ PostgreSQL  │
    │(Vector)│ │ (운영 DB)    │
    └────────┘ └─────────────┘
         │
    ┌────▼────┐
    │ Gemini  │
    │  2.5    │
    └─────────┘
```

---

## 테스트

```bash
# 백엔드 단위 테스트
cd backend && uv run pytest

# Admin 단위 테스트
cd admin && pnpm test

# Admin E2E 테스트
cd admin && pnpm test:e2e
```

---

## 설계 문서

상세 기술 문서는 [`docs/README.md`](./docs/README.md) 참조

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
