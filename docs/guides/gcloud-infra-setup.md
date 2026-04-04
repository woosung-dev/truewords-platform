# GCP 인프라 셋업 가이드 (gcloud CLI)

> TrueWords 프로젝트를 예시로 한 GCP 인프라 구성 가이드.
> Cloud SQL, Secret Manager, Qdrant Cloud 연동까지의 전체 흐름을 다룬다.

---

## 사전 준비

### 1. gcloud CLI 설치

```bash
# macOS (Homebrew)
brew install --cask google-cloud-sdk

# 설치 확인
gcloud version
```

### 2. 로그인 & 프로젝트 설정

```bash
# Google 계정 로그인 (브라우저 인증)
gcloud auth login

# 프로젝트 설정
gcloud config set project <PROJECT_ID>

# 현재 설정 확인
gcloud config list
```

### 3. 필요한 API 활성화

```bash
# Cloud SQL, Secret Manager, Cloud Run 등 필요한 API 한 번에 활성화
gcloud services enable \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  --project=<PROJECT_ID>
```

---

## 1단계: Cloud SQL (PostgreSQL) 생성

### 인스턴스 생성

```bash
gcloud sql instances create <INSTANCE_NAME> \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-northeast3 \
  --project=<PROJECT_ID>
```

| 옵션 | 설명 |
|------|------|
| `--database-version` | PostgreSQL 버전 (POSTGRES_14, 15, 16 등) |
| `--tier` | 머신 크기. `db-f1-micro`는 무료 티어급 (vCPU 공유, 614MB RAM) |
| `--region` | 리전. `asia-northeast3` = 서울 |

> 약 5~10분 소요. 완료 전까지 터미널이 블로킹된다.

### 데이터베이스 생성

```bash
gcloud sql databases create <DB_NAME> \
  --instance=<INSTANCE_NAME> \
  --project=<PROJECT_ID>
```

### 유저 비밀번호 설정

```bash
gcloud sql users set-password postgres \
  --instance=<INSTANCE_NAME> \
  --password=<YOUR_PASSWORD> \
  --project=<PROJECT_ID>
```

### 주요 관리 명령어

```bash
# 인스턴스 목록 조회
gcloud sql instances list --project=<PROJECT_ID>

# 인스턴스 상세 정보
gcloud sql instances describe <INSTANCE_NAME> --project=<PROJECT_ID>

# 데이터베이스 목록
gcloud sql databases list --instance=<INSTANCE_NAME> --project=<PROJECT_ID>

# 인스턴스 삭제 (주의!)
gcloud sql instances delete <INSTANCE_NAME> --project=<PROJECT_ID>
```

---

## 2단계: Secret Manager (시크릿 관리)

### 개념

- GCP에서 API 키, 비밀번호, 인증서 등 민감 정보를 안전하게 저장하는 서비스
- Cloud Run, Cloud Functions 등에서 환경변수 대신 시크릿을 마운트할 수 있다
- **코드나 채팅에 키를 직접 노출하지 않는 것이 핵심**

### 시크릿 생성

```bash
# 방법 1: 파이프로 직접 전달
echo -n "실제_비밀값" | gcloud secrets create <SECRET_NAME> \
  --data-file=- \
  --project=<PROJECT_ID>

# 방법 2: 파일에서 읽기
gcloud secrets create <SECRET_NAME> \
  --data-file=./secret-value.txt \
  --project=<PROJECT_ID>

# 방법 3: 랜덤 값 자동 생성 (JWT Secret 등에 유용)
echo -n "$(openssl rand -hex 32)" | gcloud secrets create <SECRET_NAME> \
  --data-file=- \
  --project=<PROJECT_ID>
```

> `-n` 옵션: echo에서 줄바꿈(\n)을 붙이지 않기 위해 필수.
> `--data-file=-`: 표준입력(stdin)에서 값을 읽겠다는 의미.

### 시크릿 값 업데이트 (새 버전 추가)

```bash
echo -n "새로운_비밀값" | gcloud secrets versions add <SECRET_NAME> \
  --data-file=- \
  --project=<PROJECT_ID>
```

### 시크릿 값 조회

```bash
gcloud secrets versions access latest \
  --secret=<SECRET_NAME> \
  --project=<PROJECT_ID>
```

### 주요 관리 명령어

```bash
# 시크릿 목록
gcloud secrets list --project=<PROJECT_ID>

# 시크릿 버전 목록
gcloud secrets versions list <SECRET_NAME> --project=<PROJECT_ID>

# 시크릿 삭제 (주의!)
gcloud secrets delete <SECRET_NAME> --project=<PROJECT_ID>
```

### 보안 주의사항

| 하지 말 것 | 대신 할 것 |
|-----------|-----------|
| 채팅/슬랙에 키 붙여넣기 | `echo -n "값" \| gcloud secrets create ...` 로 터미널에서 직접 실행 |
| `.env` 파일에 프로덕션 키 저장 | Secret Manager에 저장 후 Cloud Run에서 마운트 |
| 코드에 하드코딩 | 환경변수 또는 Secret Manager 참조 |
| 커밋에 키 포함 | `.gitignore`에 `.env*` 추가 |

---

## 3단계: Cloud SQL 접속 문자열 구성

Cloud Run에서 Cloud SQL에 접속할 때는 **Unix Socket** 방식을 사용한다.

```
postgresql+asyncpg://postgres:<DB_PASSWORD>@/truewords?host=/cloudsql/<PROJECT_ID>:<REGION>:<INSTANCE_NAME>
```

### 구성 요소 분해

```
postgresql+asyncpg://  ← 드라이버 (asyncpg = 비동기 PostgreSQL)
postgres               ← DB 유저명
:<DB_PASSWORD>         ← 1단계에서 설정한 비밀번호
@/truewords            ← 데이터베이스 이름
?host=/cloudsql/       ← Cloud SQL Proxy Unix Socket 경로
<PROJECT_ID>:<REGION>:<INSTANCE_NAME>  ← 인스턴스 연결 이름
```

> 이 전체 문자열을 Secret Manager에 `database-url`로 저장한다.

---

## 4단계: Qdrant Cloud 연동

### 클러스터 생성

1. https://cloud.qdrant.io 접속 → 회원가입
2. "Create Cluster" → Free tier 선택
3. 리전: 가까운 곳 선택 (예: AWS Tokyo)
4. 생성 완료 후 **URL**과 **API Key** 메모

### Secret Manager에 등록

```bash
echo -n "https://xxxx.qdrant.io:6333" | gcloud secrets create qdrant-url \
  --data-file=- \
  --project=<PROJECT_ID>

echo -n "실제_QDRANT_API_KEY" | gcloud secrets create qdrant-api-key \
  --data-file=- \
  --project=<PROJECT_ID>
```

---

## 전체 시크릿 목록 (이 프로젝트 기준)

| Secret Name | 설명 | 값 출처 |
|------------|------|--------|
| `gemini-api-key` | Gemini LLM API 키 | Google AI Studio에서 발급 |
| `admin-jwt-secret` | Admin 인증 토큰 서명 | `openssl rand -hex 32`로 생성 |
| `database-url` | PostgreSQL 접속 문자열 | Cloud SQL 정보 조합 |
| `qdrant-url` | Qdrant Cloud 엔드포인트 | Qdrant Cloud 대시보드 |
| `qdrant-api-key` | Qdrant Cloud API 키 | Qdrant Cloud 대시보드 |

---

## 트러블슈팅

### "Permission denied" 에러

```bash
# 현재 계정 확인
gcloud auth list

# 권한 부족 시 프로젝트 Owner/Editor 역할 필요
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="user:your-email@gmail.com" \
  --role="roles/owner"
```

### Cloud SQL 인스턴스 생성 실패

```bash
# Cloud SQL Admin API가 활성화되어 있는지 확인
gcloud services list --enabled --project=<PROJECT_ID> | grep sqladmin

# 비활성 상태라면
gcloud services enable sqladmin.googleapis.com --project=<PROJECT_ID>
```

### 시크릿 생성 시 "already exists" 에러

```bash
# 기존 시크릿에 새 버전 추가 (덮어쓰기)
echo -n "새값" | gcloud secrets versions add <SECRET_NAME> \
  --data-file=- \
  --project=<PROJECT_ID>
```

---

## 참고 링크

- [gcloud CLI 레퍼런스](https://cloud.google.com/sdk/gcloud/reference)
- [Cloud SQL for PostgreSQL 문서](https://cloud.google.com/sql/docs/postgres)
- [Secret Manager 문서](https://cloud.google.com/secret-manager/docs)
- [Qdrant Cloud 문서](https://qdrant.tech/documentation/cloud/)
