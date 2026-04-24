# Staging 환경 분리 설계 초안 (선행 #2)

- **작성일**: 2026-04-25
- **상태**: 설계 초안 — 사용자 의사결정 필요 (§7 체크리스트)
- **관련**: 플랜 §19.12 #2, dev-log 25/26, `.claude/plans/sleepy-sleeping-summit.md`
- **후속 문서**: `docs/05_env/environment-setup.md` (환경변수 테이블), `docs/06_devops/ci-cd-pipeline.md` (배포 파이프라인), `docs/07_infra/gcp-vercel-infrastructure.md` (인프라 구성)

---

## 1. 목표

- **데이터 격리**: 운영(production) 데이터와 테스트 데이터가 같은 Qdrant 컬렉션 · PostgreSQL DB를 공유하는 **현재 구조를 분리**.
- **배포 검증 단계 확보**: production 직접 배포 전에 실환경과 동일한 구성의 **staging에서 스모크 테스트**.
- **사용자 체크리스트 중심**: 이 문서는 **인프라 의사결정을 위한 자료**. 실제 프로비저닝/배포는 §7 결정 후 별도 세션.

---

## 2. 현 단일 환경 구조 진단

### 2.1 코드
- `backend/src/config.py` L7 — `environment: str = "development"` 필드는 존재하나, Qdrant 컬렉션명 · DB 이름이 환경별로 **분기되지 않음**. `collection_name = "malssum_poc"`, `cache_collection_name = "semantic_cache"`, `database_url` 기본값 모두 **단일**.
- `@model_validator(mode="after")` 두 개(`apply_gemini_tier_presets`, `validate_production`)만 존재. staging 전용 네임스페이싱 로직은 없음.

### 2.2 데이터
- **Qdrant**: 단일 Qdrant Cloud 클러스터 + 컬렉션 2개(`malssum_poc`, `semantic_cache`) 공유. `docs/07_infra/gcp-vercel-infrastructure.md` L63–66.
- **PostgreSQL**: 단일 Cloud SQL 인스턴스 + 단일 DB `truewords`. 동 문서 L33–37.
- → staging 도입 시 **즉시 격리 필수**. 안 그러면 테스트 데이터가 운영 임베딩/DB에 침투.

### 2.3 배포
- `.github/workflows/deploy.yml` — `ENVIRONMENT=production` **하드코드**. staging job 부재.
- Vercel은 admin 프론트엔드를 Preview URL로 자동 배포하지만, `NEXT_PUBLIC_API_URL`이 Production/Preview 동일 Cloud Run URL로 지정 (`docs/07_infra/gcp-vercel-infrastructure.md` L57–59). → preview가 production backend를 호출.
- Cloud Run 서비스는 `truewords-backend` 하나. staging 서비스 없음.

---

## 3. 분리 원칙

1. **비용 최소화**: staging은 운영 검증용. 별도 리소스 풀 띄우지 않고 **같은 클러스터/인스턴스에서 네임스페이스로 분리**.
2. **환경변수 중심 분기**: 코드는 가능한 한 환경별 분기를 하지 않고, `ENVIRONMENT` + 환경변수 값으로 동작. 테스트 용이성 유지.
3. **자동 접미사 + 명시적 override 허용**: `ENVIRONMENT=staging` 하나로 기본 컬렉션/DB 이름이 `_staging`으로 바뀌되, 명시적 env var 로 덮어쓸 수 있음.
4. **IAM · 시크릿 격리**: 운영 시크릿이 staging에 실수로 주입되지 않도록 Secret Manager 항목을 환경별 분리.
5. **단계적 도입**: 코드 PoC → Qdrant/PG 리소스 네임 분리 → Cloud Run staging 서비스 → Vercel preview env var → GitHub Actions staging job. 순서대로.

---

## 4. 레이어별 분리 방안

### 4.1 환경변수 네임스페이싱

| 변수 | development | staging | production |
|------|-------------|---------|------------|
| `ENVIRONMENT` | `development` | `staging` | `production` |
| `DATABASE_URL` | `localhost:5432/truewords` | Cloud SQL · DB `truewords_staging` | Cloud SQL · DB `truewords` |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant Cloud (같은 클러스터) | Qdrant Cloud (같은 클러스터) |
| `COLLECTION_NAME` | `malssum_poc` (자동) | `malssum_poc_staging` (자동) | `malssum_poc` (자동) |
| `CACHE_COLLECTION_NAME` | `semantic_cache` (자동) | `semantic_cache_staging` (자동) | `semantic_cache` (자동) |
| `ADMIN_FRONTEND_URL` | `http://localhost:3000` | Vercel Preview URL (예: `https://truewords-admin-git-develop-*.vercel.app`) | `https://admin.truewords.app` |
| `NEXT_PUBLIC_API_URL` (admin) | `http://localhost:8000` | staging Cloud Run URL | production Cloud Run URL |
| `COOKIE_SECURE` | `false` | `true` | `true` |
| `ADMIN_JWT_SECRET` | 개발용 | Secret Manager `admin-jwt-secret-staging` | Secret Manager `admin-jwt-secret` |
| `GEMINI_API_KEY` | 로컬 | Secret Manager `gemini-api-key-staging` | Secret Manager `gemini-api-key` |

"자동"은 `ENVIRONMENT=staging`일 때 code validator가 `_staging` 접미사를 붙이는 동작(§5 참조).

### 4.2 Qdrant 컬렉션

- **권장**: 단일 Qdrant Cloud 클러스터 + 컬렉션 네임 접미사 분리.
  - production: `malssum_poc`, `semantic_cache`
  - staging: `malssum_poc_staging`, `semantic_cache_staging`
- **대안**: 별도 Qdrant 클러스터 (격리 강도↑, 월 +$25~50). 초기 도입 시 과잉 투자 가능성.
- 장점: Qdrant 클러스터 리소스(RAM 1GB)를 그대로 공유. staging 컬렉션은 데이터 1만~10만 vector 정도 소규모 테스트.
- 주의: staging 컬렉션은 실데이터 일부/전체 복사(`copy_collection` 또는 파이프라인 재실행). 복사 주기는 §6.

### 4.3 PostgreSQL DB

- **권장**: 단일 Cloud SQL 인스턴스 + DB 분리.
  - production: DB `truewords`
  - staging: DB `truewords_staging`
- Alembic 마이그레이션: 같은 revision history 공유. staging에 먼저 upgrade → 이상 없으면 production upgrade.
- **대안**: 별도 Cloud SQL 인스턴스 (격리 강도↑, 월 +$10~25).
- **선택지 C**: 동일 DB + schema 분리 (`truewords.staging`) — Alembic이 기본 `public` schema 가정. schema 변수화하려면 env.py 수정 필요. 복잡도 대비 격리 이점 미약. **비권장**.

### 4.4 Cloud Run 서비스

- **권장**: 별도 서비스 `truewords-backend-staging`.
  - 환경변수/시크릿 독립 주입 가능.
  - IAM 권한, 트래픽 분기 관리 용이.
  - production과 같은 Artifact Registry 이미지 공유 (같은 commit을 staging→production 순으로 배포).
- **대안**: 같은 서비스 + revision tag (`--tag=staging`). 구현 간단하지만 시크릿/환경변수 분리 번거로움. **비권장**.
- 리전: `asia-northeast3` 동일.
- 스펙: `min-instances=0` (비용 최소화), `cpu=1`, `memory=512Mi` (production과 동일).

### 4.5 Vercel Preview

현재 admin 프론트엔드는 Vercel Git 연동으로 **Preview URL이 PR마다 자동 생성**. 이를 staging 용도로 활용.

- **방안**: Vercel 프로젝트 설정에서 환경변수를 **Environment-scoped**로 분리.
  - `Preview` scope: `NEXT_PUBLIC_API_URL` = staging Cloud Run URL
  - `Production` scope: `NEXT_PUBLIC_API_URL` = production Cloud Run URL
- PR 생성 시 preview 자동 배포 → 자동으로 staging backend에 연결.
- 추가 작업 없음 (Vercel 대시보드 설정만).

### 4.6 Secret Manager

환경별 시크릿 이름 접미사:

| 기존 | staging | production |
|------|---------|------------|
| `gemini-api-key` | `gemini-api-key-staging` | `gemini-api-key` (유지) |
| `admin-jwt-secret` | `admin-jwt-secret-staging` | `admin-jwt-secret` (유지) |
| `database-url` | `database-url-staging` | `database-url` (유지) |

Cloud Run 서비스별 `--set-secrets` 플래그로 주입.

### 4.7 GitHub Actions 배포 파이프라인

현재 `deploy.yml`은 `main` push → production. staging 추가 방안:

**방안 A (권장)**: 브랜치 기반 분기.
- `develop` 브랜치 push → staging Cloud Run 배포 (ENVIRONMENT=staging, staging 시크릿)
- `main` 브랜치 push → production Cloud Run 배포 (현재 동작 유지)
- matrix strategy로 env별 job 정의, 중복 최소화.

**방안 B**: workflow_dispatch 수동 트리거.
- PR 머지 없이 수동으로 environment 선택 후 배포.
- 브랜치 제약 없음. 유연하지만 기록 추적 불리.

**방안 C**: Tag 기반.
- `staging-*` 태그 → staging, `v*.*.*` 태그 → production.
- 자동화/명시성 균형.

→ **사용자 결정 필요** (§7).

---

## 5. 코드 변경 (PoC)

`backend/src/config.py`에 환경 기반 자동 접미사 validator 추가. 최소 변경.

```python
@model_validator(mode="after")
def apply_environment_suffix(self):
    """ENVIRONMENT=staging 일 때 기본 Qdrant 컬렉션명에 '_staging' 접미사 자동 부여.

    - env var 로 COLLECTION_NAME 등을 명시 설정한 경우(기본값과 다름) 그대로 존중.
    - development/production 은 기존 동작 유지.
    """
    if self.environment != "staging":
        return self
    if self.collection_name == "malssum_poc":
        object.__setattr__(self, "collection_name", "malssum_poc_staging")
    if self.cache_collection_name == "semantic_cache":
        object.__setattr__(self, "cache_collection_name", "semantic_cache_staging")
    return self
```

단위 테스트: `backend/tests/test_config_staging.py` (이번 세션 커밋). `ENVIRONMENT=staging` + 기본값 → 접미사 적용, `COLLECTION_NAME=custom` 명시 → 그대로 유지 등.

DB URL 자동 suffix는 **제외**: Cloud SQL 접속 문자열 구조(Host/port/user/password/dbname)가 복잡하고 환경별로 Host도 바뀔 가능성. env var로 직접 전달하는 게 명시적이고 안전.

---

## 6. 마이그레이션 전략 (단일 → 분리)

현재 production 데이터만 존재. staging 도입 시:

1. **Qdrant staging 컬렉션 생성**
   - `POST /collections/malssum_poc_staging` (동일 스키마)
   - `POST /collections/semantic_cache_staging`
   - 데이터: 초기엔 비움. staging에서 파이프라인 재실행하여 샘플 데이터 적재. 또는 Qdrant `copy_collection` API 로 일부만 복사 (실환경 검증용).

2. **PostgreSQL staging DB 생성**
   - Cloud SQL: `CREATE DATABASE truewords_staging;`
   - Alembic: `DATABASE_URL=...truewords_staging uv run alembic upgrade head`
   - 관리자 계정: staging용으로 별도 생성 (운영 계정 재사용 금지).

3. **Cloud Run staging 서비스 초기 배포**
   - 동일 Artifact Registry 이미지를 staging 서비스에 배포.
   - 환경변수: `ENVIRONMENT=staging`, `COOKIE_SECURE=true`, `ADMIN_FRONTEND_URL=<Vercel Preview pattern>`.
   - 시크릿: `*-staging` 3종 주입.

4. **Vercel Preview 환경변수 설정**
   - Vercel 대시보드 → Settings → Environment Variables → `NEXT_PUBLIC_API_URL` (Preview scope)에 staging Cloud Run URL 입력.

5. **GitHub Actions staging job 추가**
   - 방안 A (권장) 기준, `develop` 브랜치 workflow 추가.

6. **스모크 테스트**
   - staging 에서 로그인, 채팅 쿼리 1건, 관리자 API 호출 각 1회.
   - Qdrant staging 컬렉션에 embedding 저장 확인.
   - 이 후 production 배포.

---

## 7. 사용자 결정 체크리스트

> **결정 완료 (2026-04-25)** — D1~D8 전 항목 권장안 채택. 일관된 "같은 리소스 풀 + 네임스페이스 격리 + 브랜치 기반 CI" 전략으로 월 +$5~20 증가 수준. §9 순서대로 인프라 프로비저닝 진행.


| # | 항목 | 옵션 | 권장 | 결정 |
|---|------|------|------|------|
| D1 | Qdrant 격리 수준 | 같은 클러스터 + 컬렉션 suffix / 별도 클러스터 | **같은 클러스터 + suffix** (비용↓) | ☑ (2026-04-25) |
| D2 | PostgreSQL 격리 수준 | 같은 인스턴스 + DB 분리 / 별도 인스턴스 / schema 분리 | **같은 인스턴스 + DB 분리** | ☑ (2026-04-25) |
| D3 | Cloud Run 서비스 구성 | 별도 서비스 / 같은 서비스 + revision tag | **별도 서비스** | ☑ (2026-04-25) |
| D4 | GitHub Actions 트리거 | 브랜치 기반 / workflow_dispatch / Tag 기반 | **브랜치 기반 (`develop`→staging, `main`→production)** | ☑ (2026-04-25) |
| D5 | staging 공개 URL | Cloud Run 기본 URL / DNS (`admin.staging.truewords.app`) | 초기엔 **Cloud Run 기본 URL**, 안정화 후 DNS | ☑ (2026-04-25) |
| D6 | staging 데이터 초기 공급 | 비움 (파이프라인 재실행) / production 일부 복제 | **비움 + 파이프라인 재실행** (PII 회피) | ☑ (2026-04-25) |
| D7 | staging 접근 제한 | IAP / IP allowlist / 기본 공개 | 초기엔 **기본 공개 + 관리자 계정 필요**, 필요 시 IAP | ☑ (2026-04-25) |
| D8 | 브랜치 전략 | 새 `develop` 브랜치 도입 / 기존 `main` 외 별도 장기 브랜치 없음 | **`develop` 브랜치 도입** | ☑ (2026-04-25) |

각 항목에 대한 결정이 모이면 §6 마이그레이션 순서대로 별도 세션에서 실행.

---

## 8. 비용 추정 (월)

§7 권장 기준:

| 서비스 | 현재 (production만) | staging 추가 후 | 증가분 |
|--------|---------------------|-----------------|--------|
| Cloud Run | $0~30 | $0~40 | **+$0~10** (staging traffic 적음) |
| Cloud SQL | $10~25 | $10~25 | **+$0** (같은 인스턴스 · DB만 추가) |
| Qdrant Cloud | $25~50 | $25~50 | **+$0** (같은 클러스터 · 컬렉션만 추가) |
| Gemini API | $30~100 | $35~110 | **+$5~10** (staging 테스트 쿼리) |
| Artifact Registry | $1~5 | $1~5 | **+$0** (같은 이미지) |
| Secret Manager | $0 | $0 | **+$0** (무료 티어) |
| Vercel | $0 | $0 | **+$0** (Preview는 Hobby 플랜 포함) |
| **합계** | **$66~210** | **$71~230** | **+$5~20** |

**별도 클러스터/인스턴스 선택 시** 월 추가 $35~75 (D1 또는 D2 비권장 옵션 선택 시).

---

## 9. 후속 구현 단계 (별도 세션)

§7 결정 완료 (2026-04-25). 아래 순서로 인프라 프로비저닝 + 배포 파이프라인 구성. 각 단계는 사용자가 GCP 콘솔/CLI에서 실행하거나, 필요 시 이 리포에서 스크립트로 자동화.


### 9.0 선반영 완료 (PR #42)

- `backend/src/config.py` — `apply_environment_suffix` validator (`ENVIRONMENT=staging` 시 기본 컬렉션명에 `_staging` 자동 부여). 기본 OFF.
- `.github/workflows/deploy.yml` — `deploy-staging` job 추가 (`github.ref == 'refs/heads/develop'` 가드). `develop` 브랜치 미존재 시 트리거 안 됨.

사용자 작업은 §9.1 부터 순서대로 수행.

### 9.1 Cloud SQL staging DB 생성

```bash
PROJECT_ID="<GCP_PROJECT_ID>"
INSTANCE_NAME="truewords-pg"    # 실제 운영 Cloud SQL 인스턴스 이름으로 교체

gcloud sql databases create truewords_staging \
  --instance="$INSTANCE_NAME" \
  --project="$PROJECT_ID"
```

DB 생성 직후엔 스키마 비어 있음. Cloud Run staging 첫 배포 시 Dockerfile 이 `alembic upgrade head` 를 수행(또는 컨테이너 내부에서 수동 실행) 하여 스키마 생성. 관리자 계정은 이후 admin API 로 별도 생성.

### 9.2 Qdrant staging 컬렉션 생성

같은 Qdrant Cloud 클러스터에 접미사 컬렉션 2종.

```bash
QDRANT_URL="https://<cluster>.qdrant.io:6333"
QDRANT_API_KEY="<api-key>"

# 운영 컬렉션의 정확한 vectors_config 는 아래로 먼저 확인:
curl -s "$QDRANT_URL/collections/malssum_poc" -H "api-key: $QDRANT_API_KEY" | jq .result.config

# 본 컬렉션 (dense 1536 Cosine + sparse BM25 named vector)
curl -X PUT "$QDRANT_URL/collections/malssum_poc_staging" \
  -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "vectors": {"dense": {"size": 1536, "distance": "Cosine"}},
    "sparse_vectors": {"sparse": {}}
  }'

# 캐시 컬렉션 (dense only) — backend 기동 시 자동 생성될 수 있지만 선생성 권장
curl -X PUT "$QDRANT_URL/collections/semantic_cache_staging" \
  -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vectors": {"size": 1536, "distance": "Cosine"}}'
```

### 9.3 GitHub Secrets 등록 (staging 전용)

`deploy.yml` 의 `deploy-staging` job 이 참조. **Repository → Settings → Secrets and variables → Actions**:

| Secret 이름 | 설명 / 값 |
|-------------|-----------|
| `DATABASE_URL_STAGING` | `postgresql+asyncpg://truewords:<pw>@/truewords_staging?host=/cloudsql/<INSTANCE_CONNECTION_NAME>` 형식 |
| `ADMIN_JWT_SECRET_STAGING` | `openssl rand -base64 32` 결과 |
| `ADMIN_FRONTEND_URL_STAGING` | Vercel Preview URL 패턴 (예: `https://truewords-admin-git-develop-<team>.vercel.app`) |

기존 공유 secret(`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `QDRANT_URL`, `QDRANT_API_KEY`, `GEMINI_API_KEY`) 은 production 과 그대로 공유 (D1/D7 결정).

### 9.4 Cloud Run staging 서비스 초기 배포

`deploy.yml` 이 `develop` push 시 자동 배포하지만, **서비스 최초 생성은 수동 배포**가 안전 (IAM 연결, Cloud SQL 연결 등을 먼저 확인):

```bash
PROJECT_ID="<GCP_PROJECT_ID>"
INSTANCE_CONNECTION_NAME="$PROJECT_ID:asia-northeast3:truewords-pg"
STAGING_DB_URL="postgresql+asyncpg://truewords:<pw>@/truewords_staging?host=/cloudsql/$INSTANCE_CONNECTION_NAME"
STAGING_JWT_SECRET="<ADMIN_JWT_SECRET_STAGING 값>"
VERCEL_PREVIEW_URL="https://truewords-admin-git-develop-<team>.vercel.app"

# 운영과 같은 이미지(:latest) 로 최초 생성
gcloud run deploy truewords-backend-staging \
  --project="$PROJECT_ID" \
  --region=asia-northeast3 \
  --image="asia-northeast3-docker.pkg.dev/$PROJECT_ID/truewords-docker/truewords-backend:latest" \
  --platform=managed \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=2 \
  --cpu=1 --memory=512Mi \
  --set-env-vars="ENVIRONMENT=staging,COOKIE_SECURE=true,ADMIN_FRONTEND_URL=$VERCEL_PREVIEW_URL,QDRANT_URL=<Qdrant URL>,QDRANT_API_KEY=<Qdrant key>,DATABASE_URL=$STAGING_DB_URL,GEMINI_API_KEY=<Gemini key>,ADMIN_JWT_SECRET=$STAGING_JWT_SECRET" \
  --add-cloudsql-instances="$INSTANCE_CONNECTION_NAME"
```

서비스 생성 성공 시 나오는 URL(`https://truewords-backend-staging-xxxx-an.a.run.app`) 을 §9.5 / §9.7 에 사용.

이후 `develop` 브랜치에 push 되면 `deploy-staging` job 이 자동으로 이 서비스를 업데이트.

### 9.5 Vercel Preview scope 환경변수

Vercel 대시보드 → `truewords-admin` 프로젝트 → Settings → Environment Variables:

| 변수 | Scope | 값 |
|------|-------|----|
| `NEXT_PUBLIC_API_URL` | Preview | §9.4 에서 얻은 staging Cloud Run URL |
| `NEXT_PUBLIC_API_URL` | Production | 기존 prod Cloud Run URL (유지) |

저장 후 `develop` 브랜치에 push 하면 Vercel Preview 가 staging backend 와 연결.

### 9.6 `develop` 브랜치 생성 + 보호 규칙

```bash
git checkout main
git pull
git checkout -b develop
git push -u origin develop

# 보호 규칙 — CI 통과 필수
gh api "repos/:owner/:repo/branches/develop/protection" \
  --method PUT \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Detect changes", "Backend Tests", "Frontend Tests"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

`gh api` 의 `:owner/:repo` 가 현재 repo 로 치환됨. 수동 대체 시 `woosung-dev/truewords-platform`.

### 9.7 Staging 스모크 테스트

```bash
STAGING_URL="https://truewords-backend-staging-<hash>-an.a.run.app"

# 1. Backend 기동 + Alembic 적용 확인
curl -I "$STAGING_URL/health"

# 2. 관리자 계정 생성 (최초 1회)
curl -X POST "$STAGING_URL/admin/users" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@staging.truewords.com","password":"<temp>","role":"admin"}'

# 3. Admin preview UI 에서 로그인 → 챗봇 목록 → 채팅 쿼리 1건

# 4. Qdrant staging 컬렉션 적재 확인
curl -s "$QDRANT_URL/collections/malssum_poc_staging" \
  -H "api-key: $QDRANT_API_KEY" | jq .result.points_count
curl -s "$QDRANT_URL/collections/semantic_cache_staging" \
  -H "api-key: $QDRANT_API_KEY" | jq .result.points_count
```

이 스모크가 통과하면 **staging 환경 준비 완료**. 이후 선행 #3 / #5 를 staging 에서 수행 → 본 리팩토링(R1/R2/R3) 착수 가능.

### 9.8 선행 #3 / #5 수행 (staging 이후)

- **선행 #3 운영 Qdrant 1000건 payload dry-run** — staging 컬렉션에 운영 샘플 1000건 복사 → schema drift 사전 확인. `backend/scripts/migrate_from_qdrant_cloud.py` 또는 신규 스크립트 활용.
- **선행 #5 품질 게이트 기준선 200건** — staging 에서 실제 질문 200건 응답 수집. R1/R2/R3 전/후 비교용 baseline.

---

## 부록 A — staging deploy용 env 참조

```bash
# Cloud Run staging 서비스에 주입할 env (gcloud run deploy 또는 deploy.yml 에서)
ENVIRONMENT=staging
COOKIE_SECURE=true

# Qdrant (같은 클러스터, 컬렉션만 분리. code validator가 자동 접미사 부여)
QDRANT_URL=https://<qdrant-cloud>.qdrant.io:6333
QDRANT_API_KEY=...  # 운영과 동일 또는 분리 선택

# PostgreSQL (같은 인스턴스, DB만 분리)
DATABASE_URL=postgresql+asyncpg://truewords:<pw>@<cloud-sql-host>:5432/truewords_staging

# Admin
ADMIN_FRONTEND_URL=https://truewords-admin-git-develop-<team>.vercel.app
ADMIN_JWT_SECRET=<from Secret Manager: admin-jwt-secret-staging>

# Gemini
GEMINI_API_KEY=<from Secret Manager: gemini-api-key-staging>
GEMINI_TIER=paid   # staging도 paid로 실운영 조건 재현
```

주의: `COLLECTION_NAME`/`CACHE_COLLECTION_NAME`은 **env에 지정하지 않음**. `ENVIRONMENT=staging` 하나로 validator가 `_staging` 접미사 자동 부여.
