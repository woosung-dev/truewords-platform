# Phase 4: 프로덕션 인프라 — 설계 스펙

> 작성일: 2026-03-28
> 상태: Draft
> 작성자: AI (Claude)

---

## 1. 목표와 성공 기준

### 목표

Phase 1에서 구축한 FastAPI + Qdrant RAG 파이프라인을 **인터넷에서 접근 가능한 프로덕션 환경**으로 배포하고, 보안/운영/CI-CD 기반을 확립한다.

### 성공 기준

| # | 기준 | 검증 방법 |
|---|------|-----------|
| SC-1 | 스테이징 URL에서 `/health` 200 응답 | `curl https://truewords-staging-xxxxx-an.a.run.app/health` |
| SC-2 | API Key 없는 요청이 401로 거부됨 | `curl -X POST .../chat` → 401 |
| SC-3 | 유효한 API Key로 `/chat` 정상 응답 | `curl -H "Authorization: Bearer <key>" -X POST .../chat` → 200 |
| SC-4 | 분당 21번째 요청이 429로 거부됨 | 연속 요청 스크립트로 검증 |
| SC-5 | 허용되지 않은 Origin의 CORS 요청 차단 | 브라우저 DevTools 또는 curl로 확인 |
| SC-6 | `main` 브랜치 push 시 CI(pytest+lint) 자동 실행 | GitHub Actions 로그 확인 |
| SC-7 | CI 통과 후 Cloud Run 자동 배포 | GCP Console 또는 `gcloud run services describe` 확인 |
| SC-8 | Qdrant Cloud에 데이터 정상 조회 | `/chat` 응답에 출처 포함 |
| SC-9 | HTTPS 자동 적용 | `curl -I https://...` → TLS 확인 |
| SC-10 | structured logging으로 JSON 로그 출력 | `gcloud logging read` 에서 JSON 형식 확인 |
| SC-11 | 레드팀(이시카와, 김인지 교수)이 스테이징에서 테스트 가능 | API Key 전달 후 정상 사용 확인 |

---

## 2. 설계 결정 + 트레이드오프

### 2.1 배포 플랫폼

| 옵션 | 장점 | 단점 | 월 예상 비용 |
|------|------|------|-------------|
| **GCP Cloud Run** | 서울 리전(asia-northeast3) 가용, 자동 HTTPS, Docker 네이티브, 종량제(무료 할당량), GCP 생태계(Secret Manager, Cloud Build 등) | GCP 초기 설정이 Fly.io보다 복잡 | $0 (무료 할당량 내) |
| Fly.io | 자동 HTTPS, 글로벌 엣지, Docker 기반, 무료 티어 있음 | 한국 리전 없음 (도쿄 nrt 사용), 디버깅 경험 부족 | $0–5 (hobby) |
| Railway | 간단한 배포, Git 연동 | 무료 티어 제한적, 커스텀 설정 어려움 | $5–10 |
| Render | 무료 정적 사이트, Docker 지원 | 무료 인스턴스 sleep, cold start 느림 | $0–7 |
| AWS EC2 | 완전한 제어 | 설정 복잡, 비용 예측 어려움, 과도한 인프라 | $10–30 |

**결정: GCP Cloud Run**
- 이유: 서울 리전(asia-northeast3) 가용으로 최저 지연, 자동 HTTPS, Docker 네이티브, 종량제(무료 할당량 있음), GCP 생태계(Secret Manager, Cloud Build 등)와의 통합 용이
- 트레이드오프: GCP 초기 설정(프로젝트 생성, IAM, Artifact Registry 등)이 Fly.io보다 복잡하지만, 장기적으로 확장성 우수 (Cloud SQL, Pub/Sub, Cloud Monitoring 등 자연스러운 확장)

### 2.2 Qdrant 호스팅

| 옵션 | 장점 | 단점 | 월 예상 비용 |
|------|------|------|-------------|
| **Qdrant Cloud** | 관리형, 자동 백업, 고가용성 | 비용 발생 | $0 (1GB 무료) → $25 |
| Self-hosted (Cloud Run) | 완전 제어 | 볼륨 관리, 백업 직접 구현, 메모리 제약 | $5–15 (GCE VM) |
| Self-hosted (docker-compose) | 로컬과 동일 | 프로덕션 안정성 부족, 단일 장애점 | $0 (VM 내) |

**결정: Qdrant Cloud (Free tier로 시작)**
- 이유: 관리 오버헤드 제거, 자동 백업
- 주의: Phase 3 임베딩 결과 615권 전체 적재 시 ~2GB 예상 → Free tier(1GB) 초과 가능. 우선 Free tier로 시작하고, 용량 초과 시 Starter tier($25/월)로 업그레이드
- 트레이드오프: 외부 의존성 추가 → Qdrant Cloud 장애 시 서비스 중단 (완화: 헬스체크에서 Qdrant 연결 상태 모니터링)

### 2.3 인증 방식

| 옵션 | 장점 | 단점 |
|------|------|------|
| **API Key (Bearer)** | 구현 간단, FastAPI Dependency로 3줄 | 키 노출 시 교체 필요 |
| JWT | 토큰 만료/갱신, 사용자별 권한 | 구현 복잡, 이 단계에선 과도 |
| OAuth 2.0 | 표준, 3rd party 연동 | 복잡도 높음, 사용자 < 1,000명에 불필요 |

**결정: API Key (Bearer token)**
- 이유: 초기 사용자 < 1,000명, 레드팀 5-10명에게 키 배포만 하면 됨
- 구현: `FastAPI Depends` + 환경변수 `API_KEY`
- 트레이드오프: 사용자별 추적 불가 → [가정] Phase 5에서 JWT/Clerk 도입 시 교체 예정

### 2.4 Rate Limiting

| 옵션 | 장점 | 단점 |
|------|------|------|
| **slowapi** | FastAPI 네이티브, 데코레이터 방식, 검증됨 | Redis 없으면 인메모리 (단일 인스턴스 OK) |
| 직접 구현 | 완전 제어 | 유지보수 부담, 버그 가능성 |
| API Gateway (Cloudflare) | 인프라 레벨 | 추가 비용, 설정 복잡 |

**결정: slowapi (인메모리)**
- 이유: 단일 Cloud Run 인스턴스에서 인메모리 rate limit 충분, 별도 Redis 불필요
- 설정: IP 기반 분당 20 요청
- 트레이드오프: 인스턴스 재시작 시 카운터 리셋 → 초기 단계에서 허용 가능

### 2.5 CI/CD

| 옵션 | 장점 | 단점 |
|------|------|------|
| **GitHub Actions** | 코드와 같은 플랫폼, 무료 2,000분/월 | GitHub 종속 |
| GitLab CI | 자체 호스팅 가능 | 현재 GitHub 사용 중, 마이그레이션 비용 |

**결정: GitHub Actions**
- CI: pytest + ruff lint (PR/push 시)
- CD: main push 시 Cloud Run 자동 배포 (`google-github-actions/deploy-cloudrun`)

### 2.6 로깅

| 옵션 | 장점 | 단점 |
|------|------|------|
| **structlog** | JSON 출력, 구조화된 컨텍스트, 타입 안전 | 학습 곡선 |
| python-json-logger | 간단, stdlib logging 호환 | 기능 제한 |
| loguru | 간편, 색상 출력 | 프로덕션 JSON 출력 설정 추가 필요 |

**결정: structlog**
- 이유: JSON structured logging이 GCP Cloud Logging과 호환, 요청 ID/사용자 추적에 유리
- 트레이드오프: 초기 설정 코드 필요 → 한 번 설정하면 재사용

---

## 3. 범위 제한 (NOT in scope)

| 항목 | 이유 | 예상 Phase |
|------|------|-----------|
| JWT/OAuth 인증 | 사용자 < 1,000명, 과도한 복잡도 | Phase 5 |
| Redis 기반 rate limiting | 단일 인스턴스, 인메모리 충분 | 스케일 아웃 시 |
| 다중 리전 배포 | 사용자 대부분 한국/일본 | Phase 6+ |
| 프론트엔드 배포 (Vercel) | Phase 2 범위 | Phase 2 |
| 모니터링 대시보드 (Grafana) | 비용/복잡도, Cloud Logging으로 충분 | Phase 6+ |
| 데이터베이스 (PostgreSQL) | 현재 Qdrant만 사용 | Phase 5 (사용자 관리 시) |
| WAF (Web Application Firewall) | 비용, Cloud Run 기본 보호로 충분 | 필요 시 |
| 자동 스케일링 | 초기 트래픽 낮음, 단일 인스턴스 | Phase 6+ |

---

## 4. 비용 분석

### 월간 예상 비용 (최소 구성)

| 서비스 | 티어 | 월 비용 | 비고 |
|--------|------|---------|------|
| GCP Cloud Run (backend) | 무료 할당량: 200만 요청/월, 360,000 GB-초/월, 180,000 vCPU-초/월 | $0 | 무료 할당량 내 운영 가능 |
| GCP Artifact Registry | 0.5GB 이하 이미지 | $0 | 무료 할당량 내 |
| Qdrant Cloud | Free tier(1GB)로 시작, 용량 초과 시 Starter($25/월) 업그레이드 | $0~$25 | Phase 3 기준 615권 전체 적재 시 ~2GB 예상 → Free tier 초과 가능 |
| GitHub Actions | Free (2,000분/월) | $0 | 공개 리포 무료 |
| 도메인 (선택) | — | $0 | Cloud Run 자동 생성 URL 사용 |
| **합계** | | **$0~$25/월** | Free tier 유지 시 $0, Qdrant Starter 업그레이드 시 $25 |

### 스케일 업 시나리오 (사용자 500+ 시)

| 서비스 | 티어 | 월 비용 |
|--------|------|---------|
| GCP Cloud Run (backend) | 1 vCPU, 512MB, min-instances=1 | $5–10 |
| Qdrant Cloud | Starter (4GB) | $25 |
| **합계** | | **~$30–35/월** |

---

## 5. 보안 체크리스트

### OWASP 기본 대응

| # | 위협 | 대응 | 상태 |
|---|------|------|------|
| A01 | Broken Access Control | API Key 인증, Bearer token | Phase 4 구현 |
| A02 | Cryptographic Failures | HTTPS 강제 (Cloud Run 자동) | Phase 4 구현 |
| A03 | Injection | Pydantic 입력 검증, Qdrant 파라미터화 쿼리 | Phase 1 구현됨 |
| A04 | Insecure Design | Rate limiting, CORS | Phase 4 구현 |
| A05 | Security Misconfiguration | 환경변수 관리, .env 미커밋 | Phase 4 검증 |
| A06 | Vulnerable Components | Dependabot 활성화, CI에서 확인 | Phase 4 구현 |
| A07 | Auth Failures | API Key 검증, 실패 로깅 | Phase 4 구현 |
| A08 | Data Integrity | Docker 이미지 고정 태그, lockfile | Phase 4 구현 |
| A09 | Logging & Monitoring | structlog JSON, GCP Cloud Logging | Phase 4 구현 |
| A10 | SSRF | 외부 호출 제한 (Gemini API만) | Phase 1 구현됨 |

### config.py 민감 필드 SecretStr 적용

Phase 4에서 secrets 관리를 강화하면서, `config.py`의 민감 필드를 `SecretStr` 타입으로 변경해야 한다.
기존 `str` 타입은 로그/직렬화 시 값이 노출될 수 있다.

| 필드 | 기존 타입 | 변경 타입 | 비고 |
|------|-----------|-----------|------|
| `gemini_api_key` | `str` | `SecretStr` | Gemini API 호출 시 `.get_secret_value()` 호출 필요 |
| `api_key` | (신규) | `SecretStr` | 클라이언트 인증용 |
| `qdrant_api_key` | (신규) | `SecretStr \| None` | Qdrant Cloud 인증용 |

> 변경 후 `src/chat/generator.py` 등 `gemini_api_key`를 직접 참조하는 코드에서 `.get_secret_value()` 호출로 수정 필요.

### API Key 관리

- 환경변수 `API_KEY`로 관리 (GCP Secret Manager 또는 Cloud Run 환경변수)
- `.env` 파일은 `.gitignore`에 포함 (확인 필요)
- 레드팀에게는 별도 채널(DM)로 전달, 문서에 키 미기재
- [가정] 초기에는 단일 API Key, 추후 다중 키 지원 가능

### CORS 정책

- `ALLOWED_ORIGINS` 환경변수로 관리
- 개발: `http://localhost:3000`
- 스테이징: Cloud Run 자동 생성 URL (또는 프론트엔드 URL)
- 프로덕션: 확정된 도메인만
- `allow_credentials=False` (JWT 미사용이므로 쿠키 불필요)

### 환경변수 관리

| 변수 | 용도 | 저장소 |
|------|------|--------|
| `GEMINI_API_KEY` | Gemini API 호출 | GCP Secret Manager |
| `QDRANT_URL` | Qdrant Cloud 연결 | Cloud Run 환경변수 |
| `QDRANT_API_KEY` | Qdrant Cloud 인증 | GCP Secret Manager |
| `COLLECTION_NAME` | 컬렉션 이름 | Cloud Run 환경변수 |
| `API_KEY` | 클라이언트 인증 | GCP Secret Manager |
| `ALLOWED_ORIGINS` | CORS 허용 도메인 | Cloud Run 환경변수 |
| `ENVIRONMENT` | dev/staging/prod 구분 | Cloud Run 환경변수 |

---

## 6. 리스크 + 완화 전략

| # | 리스크 | 확률 | 영향 | 완화 전략 |
|---|--------|------|------|-----------|
| R1 | GCP Cloud Run 장애 | 낮음 | 높음 | 헬스체크 모니터링, 장애 시 로컬 Docker로 임시 운영 가능 |
| R2 | Qdrant Cloud 장애 | 낮음 | 높음 | 헬스체크에서 Qdrant 연결 상태 확인, 로컬 백업 유지 |
| R3 | API Key 노출 | 중간 | 중간 | Rate limiting으로 피해 최소화, 키 즉시 교체 절차 문서화 |
| R4 | Gemini API 할당량 초과 | 중간 | 중간 | Rate limiting이 간접 방어, 사용량 모니터링 로그 |
| R5 | DNS 전파 지연 | 낮음 | 낮음 | Cloud Run 자동 생성 URL 사용으로 회피 |
| R6 | Docker 이미지 빌드 실패 | 낮음 | 중간 | CI에서 사전 검증, lockfile 고정 |
| R7 | 레드팀 과도한 사용 | 낮음 | 낮음 | Rate limiting + 사용량 로그 모니터링 |
| R8 | Cold start 지연 | 중간 | 낮음 | Cloud Run `--min-instances=1` 설정 |

---

## 7. 아키텍처 다이어그램

```
                    ┌─────────────┐
                    │  레드팀 / 프론트엔드  │
                    └──────┬──────┘
                           │ HTTPS
                    ┌──────▼──────┐
                    │  GCP Cloud  │
                    │  Run        │
                    │  (Auto TLS) │
                    │ ┌─────────┐ │
                    │ │  FastAPI │ │
                    │ │ Backend  │ │
                    │ ├─────────┤ │
                    │ │API Key  │ │
                    │ │Auth     │ │
                    │ ├─────────┤ │
                    │ │Rate     │ │
                    │ │Limiter  │ │
                    │ ├─────────┤ │
                    │ │CORS     │ │
                    │ ├─────────┤ │
                    │ │structlog│ │
                    │ └─────────┘ │
                    └──┬─────┬───┘
                       │     │
              ┌────────▼┐  ┌─▼──────────┐
              │ Qdrant  │  │  Gemini    │
              │ Cloud   │  │  API       │
              └─────────┘  └────────────┘

              ┌────────────────────────┐
              │  GCP Secret Manager    │
              │  (민감 환경변수 관리)    │
              └────────────────────────┘
```

---

## 8. 배포 전략

### 환경 구성

| 환경 | URL | 용도 |
|------|-----|------|
| Local | `http://localhost:8000` | 개발 |
| Staging | `https://truewords-staging-xxxxx-an.a.run.app` | 레드팀 테스트 (Cloud Run 서비스: truewords-staging) |
| Production | `https://truewords-prod-xxxxx-an.a.run.app` | 일반 사용 (Phase 4 완료 후, Cloud Run 서비스: truewords-prod) |

### 배포 흐름

```
개발자 push → GitHub Actions CI (pytest + ruff)
                     │
                     ├─ 실패 → 알림, 배포 중단
                     │
                     └─ 성공 → gcloud run deploy (staging)
                                   │
                                   └─ 헬스체크 통과 → 완료
```

### 롤백 전략

- Cloud Run은 이전 리비전으로 즉시 롤백 가능: `gcloud run services update-traffic truewords-staging --to-revisions=<previous-revision>=100 --region=asia-northeast3`
- Git revert → push → 자동 재배포로도 가능

---

## 9. config.py 누적 변경 사항

> 각 Phase에서 `backend/src/config.py`의 `Settings` 클래스에 추가되는 필드를 추적한다.
> 추적 목적: 환경변수 누락 방지, `.env.example` 최신 상태 유지, Phase 간 의존성 파악.

| Phase | 추가 필드 | 타입 | 비고 |
|-------|-----------|------|------|
| 1 | `gemini_api_key` | `str` → Phase 4에서 `SecretStr`로 격상 | Gemini API 호출 키 |
| 1 | `qdrant_url` | `str` | Qdrant 연결 URL (기본값: `http://localhost:6333`) |
| 1 | `collection_name` | `str` | Qdrant 컬렉션 이름 (기본값: `malssum_poc`) |
| 2 | (변경 없음) | | |
| 3 | `embed_delay` | `float` | 임베딩 요청 간 딜레이(초) |
| 3 | `cache_collection_name` | `str` | 캐시용 컬렉션 이름 |
| 3 | `progress_file` | `str` | 진행 상황 저장 파일 경로 |
| 4 | `api_key` | `SecretStr` | 클라이언트 Bearer 인증 키 |
| 4 | `qdrant_api_key` | `SecretStr \| None` | Qdrant Cloud 인증 키 (로컬은 None) |
| 4 | `allowed_origins` | `str` | CORS 허용 도메인 (쉼표 구분) |
| 4 | `environment` | `str` | 실행 환경 구분 (`development` / `staging` / `production`) |

> **참고:** Phase 4에서 `gemini_api_key`를 `str`에서 `SecretStr`로 변경한다.
> 이 변경에 따라 `src/chat/generator.py` 등 해당 필드를 직접 참조하는 코드에서 `.get_secret_value()` 호출로 수정 필요.
