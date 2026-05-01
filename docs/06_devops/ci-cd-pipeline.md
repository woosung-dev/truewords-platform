# CI/CD 파이프라인

## 파이프라인 개요

```
PR → CI (테스트)
        ├── Backend Tests: pytest
        └── Frontend Tests: vitest + build

push
  ├── main    → Deploy production
  │   ├── backend: Docker → Artifact Registry → Cloud Run (truewords-backend)
  │   └── frontend: Vercel Production 자동 배포
  └── develop → Deploy staging          [선행 #2 Staging 분리]
      ├── backend: Docker → Artifact Registry → Cloud Run (truewords-backend-staging)
      └── frontend: Vercel Preview 자동 배포 (NEXT_PUBLIC_API_URL=staging backend)
```

---

## CI 파이프라인 (`.github/workflows/ci.yml`)

**트리거:** `pull_request` on `main`

### Detect changes
- `dorny/paths-filter@v3` 로 `backend/` · `admin/` 변경 여부 판정.
- 변경 없는 도메인은 해당 job 을 skip 하되 required check 을 만족하도록 구성 (branch protection 호환).

### Backend Tests
1. Python 3.12 + uv 설치
2. `uv sync --frozen`
3. `uv run pytest -v` (`GEMINI_API_KEY=test-key-for-ci`)

### Frontend Tests
1. Node.js 22 + pnpm 8
2. `pnpm install --frozen-lockfile`
3. `pnpm test` (vitest)
4. `pnpm build` (빌드 검증)

---

## Deploy 파이프라인 (`.github/workflows/deploy.yml`)

**트리거:** `push` to `main` (production) · `push` to `develop` (staging). `paths` 필터로 `backend/**` 또는 `deploy.yml` 변경 시에만.

### `deploy-production` (main)

- **Cloud Run 서비스**: `truewords-backend`
- **이미지 태그**: `${{ github.sha }}` + `latest`
- **리소스**: `memory=1Gi`, `cpu=1`, `min-instances=1`, `max-instances=3`
- **환경변수**: `ENVIRONMENT=production`, `COLLECTION_NAME=malssum_poc_v5`, `CACHE_COLLECTION_NAME=semantic_cache`, `COOKIE_SECURE=true`
- **시크릿 주입**: GitHub Secrets → Cloud Run `env_vars` (아래 §GitHub Secrets 참조)

### `deploy-staging` (develop) — 선행 #2

- **Cloud Run 서비스**: `truewords-backend-staging`
- **이미지 태그**: `${{ github.sha }}` + `staging`
- **리소스**: `memory=512Mi`, `cpu=1`, `min-instances=0`, `max-instances=2` (비용 최소화)
- **환경변수**: `ENVIRONMENT=staging`, `COOKIE_SECURE=true`
  - `COLLECTION_NAME` / `CACHE_COLLECTION_NAME` 은 **설정하지 않음**.
  - `ENVIRONMENT=staging` 이면 `config.py` 의 `apply_environment_suffix` validator 가 기본 컬렉션명에 `_staging` 접미사를 자동 부여 (`docs/07_infra/staging-separation.md §5`).
- **시크릿 주입**: GitHub Secrets `*_STAGING` 3종 + 공유 4종

### Frontend (Vercel)

Vercel GitHub 연동 자동 배포. Actions 불필요.
- Production: `main` push → Production 배포
- Preview: `develop` · PR 브랜치 push → Preview 배포. `NEXT_PUBLIC_API_URL` (Preview scope) 을 staging backend URL 로 설정하면 staging 용으로 활용.
- Root Directory: `admin`

---

## GitHub Secrets 설정

> 과거 문서에 "GCP Secret Manager에 저장"으로 표기된 항목이 있었으나, 현재 실제 구조는 **GitHub Secrets 직접 주입** 방식. Secret Manager 는 미사용.

### 공유 (production + staging)

| Secret | 용도 |
|--------|------|
| `GCP_PROJECT_ID` | GCP 프로젝트 ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Provider |
| `GCP_SERVICE_ACCOUNT` | 배포용 서비스 어카운트 |
| `QDRANT_URL` | Qdrant Cloud URL (같은 클러스터) |
| `QDRANT_API_KEY` | Qdrant API 키 |
| `GEMINI_API_KEY` | Gemini API 키 |

### Production 전용

| Secret | 용도 |
|--------|------|
| `DATABASE_URL` | Cloud SQL production DB URL |
| `ADMIN_JWT_SECRET` | Production JWT 시크릿 |
| `ADMIN_FRONTEND_URL` | Production admin URL (`https://admin.truewords.app`) |

### Staging 전용 (선행 #2 프로비저닝 후 등록)

| Secret | 용도 |
|--------|------|
| `DATABASE_URL_STAGING` | Cloud SQL staging DB URL (`truewords_staging`) |
| `ADMIN_JWT_SECRET_STAGING` | Staging 전용 JWT 시크릿 (`openssl rand -base64 32`) |
| `ADMIN_FRONTEND_URL_STAGING` | Vercel Preview URL 패턴 |

구체적인 값 / 생성 방법은 `docs/07_infra/staging-separation.md §9.3`.

---

## 롤백 절차

### Cloud Run 롤백 (production / staging 공통)
```bash
SERVICE="truewords-backend"       # staging 은 truewords-backend-staging
gcloud run revisions list --service="$SERVICE" --region=asia-northeast3
gcloud run services update-traffic "$SERVICE" \
  --to-revisions=REVISION_NAME=100 \
  --region=asia-northeast3
```

### Vercel 롤백
Vercel 대시보드 → Deployments → 이전 배포 → "Promote to Production" (또는 Preview 롤백).

---

## 새 환경변수 추가 시

1. `backend/src/config.py` Settings 클래스에 필드 추가
2. `backend/.env.example` 업데이트
3. `.github/workflows/deploy.yml` 의 `deploy-production` + `deploy-staging` 두 job 모두에 `env_vars` 또는 `${{ secrets.* }}` 추가
4. 민감값이면 **GitHub Secrets** 에 등록 (production/staging 별도 이름 구분)
5. 이 문서 (`docs/06_devops/ci-cd-pipeline.md`) 의 §GitHub Secrets 표 갱신
