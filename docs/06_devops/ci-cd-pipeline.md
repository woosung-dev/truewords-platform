# CI/CD 파이프라인

## 파이프라인 개요

```
PR → CI (테스트)
        ├── backend: pytest (187개)
        └── frontend: vitest + build

main 머지 → Deploy
        ├── backend: Docker → Artifact Registry → Cloud Run
        └── frontend: Vercel 자동 배포 (GitHub 연동)
```

---

## CI 파이프라인 (`.github/workflows/ci.yml`)

**트리거:** `pull_request` on `main`

### Backend Job
1. Python 3.12 + uv 설치
2. `uv sync --frozen` (의존성 설치)
3. `pytest -v` (GEMINI_API_KEY=dummy)

### Frontend Job (병렬)
1. Node.js 22 설치
2. `npm ci`
3. `npm run test` (vitest)
4. `npm run build` (빌드 검증)

---

## Deploy 파이프라인 (`.github/workflows/deploy.yml`)

**트리거:** `push` to `main`

### Backend → Cloud Run
1. GCP 인증 (Workload Identity Federation)
2. Docker 이미지 빌드 (`backend/Dockerfile`)
3. Artifact Registry 푸시
4. Cloud Run 배포 (서울 리전: `asia-northeast3`)
   - 메모리: 512Mi, CPU: 1
   - 인스턴스: 0~3 (자동 스케일링)
   - 환경변수 + Secret Manager 시크릿

### Frontend → Vercel
- Vercel GitHub 연동으로 자동 배포 (별도 Actions 불필요)
- Root Directory: `admin`
- main 푸시 → 프로덕션, PR → Preview

---

## GitHub Secrets 설정

| Secret | 용도 |
|--------|------|
| `GCP_PROJECT_ID` | GCP 프로젝트 ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload Identity Provider |
| `GCP_SERVICE_ACCOUNT` | 배포용 서비스 어카운트 |
| `QDRANT_URL` | Qdrant Cloud URL |
| `ADMIN_FRONTEND_URL` | 프로덕션 admin URL |

> GCP Secret Manager에 저장: `gemini-api-key`, `admin-jwt-secret`, `database-url`

---

## 롤백 절차

### Cloud Run 롤백
```bash
# 이전 리비전 목록 확인
gcloud run revisions list --service=truewords-backend --region=asia-northeast3

# 특정 리비전으로 트래픽 전환
gcloud run services update-traffic truewords-backend \
  --to-revisions=REVISION_NAME=100 \
  --region=asia-northeast3
```

### Vercel 롤백
- Vercel 대시보드 → Deployments → 이전 배포 선택 → "Promote to Production"

---

## 새 환경변수 추가 시

1. `backend/src/config.py` Settings 클래스에 필드 추가
2. `backend/.env.example` 업데이트
3. `.github/workflows/deploy.yml` env_vars 또는 secrets에 추가
4. GCP Secret Manager에 시크릿 생성 (민감값인 경우)
5. 이 문서 (`docs/06_devops/ci-cd-pipeline.md`) 업데이���
