# GCP + Vercel 인프라 구성

## 아키텍처

```
[사용자]
   ↓
[Vercel] ─── admin 프론트엔드 (Next.js 16)
   ↓ API 호출
[Cloud Run] ─── FastAPI 백엔드
   ├── [Cloud SQL] ─── PostgreSQL 16 (운영 데이터)
   ├── [Qdrant Cloud] ─── 벡터 DB (말씀 검색 + 캐시)
   └── [Gemini API] ─── LLM 생성
```

---

## GCP 리소스

### Cloud Run (`truewords-backend`)
- **리전:** `asia-northeast3` (서울)
- **CPU:** 1 vCPU
- **메모리:** 512Mi
- **인스턴스:** 0~3 (자동 스케일링, 비용 최적화)
- **동시 요청:** 80 (기본)
- **콜드 스타트:** ~2초 (DB 풀 초기화 + Qdrant 캐시 컬렉션 확인)

### Artifact Registry (`truewords-docker`)
- **리전:** `asia-northeast3`
- Docker 이미지 저장소
- CI/CD에서 빌드된 이미지 푸시

### Cloud SQL (PostgreSQL 16)
- **인스턴스 타입:** db-f1-micro (개발) / db-custom-1-3840 (프로덕션)
- **연결:** Private IP + VPC Connector (또는 Cloud SQL Auth Proxy)
- **백업:** 자동 일일 백업 활성화
- **DB 이름:** `truewords`

### Secret Manager
| 시크릿 | 용도 |
|--------|------|
| `gemini-api-key` | Gemini API 키 |
| `admin-jwt-secret` | JWT 서명 시크릿 |
| `database-url` | Cloud SQL 연결 문자열 |

---

## Vercel 리소스

### 프로젝트 설정
- **프로젝트명:** `truewords-admin`
- **Root Directory:** `admin`
- **Framework:** Next.js (자동 감지)
- **Node.js:** 22.x

### 환경변수
| 변수 | Production | Preview |
|------|------------|---------|
| `NEXT_PUBLIC_API_URL` | Cloud Run URL | Cloud Run URL |

---

## Qdrant Cloud
- **클러스터:** 1GB RAM (시작)
- **컬렉션:** `malssum_poc` (말씀 검색), `semantic_cache` (캐시)
- **API 키:** Cloud Run 환경변수로 관리

---

## 예상 월 비용

| 서비스 | 예상 비용 |
|--------|----------|
| Cloud Run | $0~30 (트래픽 기반, 무료 티어 포함) |
| Cloud SQL | $10~25 (micro 인스턴스) |
| Qdrant Cloud | $25~50 |
| Gemini API | $30~100 (시맨틱 캐시로 40-50% 절감) |
| Vercel | $0 (Hobby/무료) |
| Artifact Registry | $1~5 |
| Secret Manager | $0 (무료 티어) |
| **합계** | **$66~210/월** |

---

## 초기 배포 체크리스트

### GCP 설정
- [ ] GCP 프로젝트 생성
- [ ] Artifact Registry 리포지토리 생성
- [ ] Cloud SQL 인스턴스 생성 + DB 생성
- [ ] Secret Manager 시크릿 3개 생성
- [ ] Workload Identity Federation 설정 (GitHub Actions용)
- [ ] Cloud Run 서비스 초기 배포

### Vercel 설정
- [ ] Vercel에 GitHub 리포지토리 연결
- [ ] Root Directory: `admin` 설정
- [ ] 환경변수 `NEXT_PUBLIC_API_URL` 설정

### DB 마이그레이션
- [ ] Cloud SQL에서 `alembic stamp head` 실행 (기존 스키마 마킹)
- [ ] 이후 변경은 `alembic upgrade head`로 적용

### DNS (추후)
- [ ] `api.truewords.app` → Cloud Run
- [ ] `admin.truewords.app` → Vercel
