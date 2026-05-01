# 전역 규칙 (모든 스택 공통)

---

## 1. 개발 워크플로우

새로운 기능이나 주요 변경 사항은 아래 루프를 따른다:

1. **계획 (Plan)** — 작업 범위와 영향 분석, 관련 규칙·설계 문서 참조
2. **문서화 (Docs)** — 구현 계획을 `docs/` 적절한 위치에 작성
3. **리뷰 (Human Review)** — 사용자 피드백, 만족할 때까지 반복
4. **구현 (Implement)** — 확정된 문서 기반 코드 작성, 중단 없이 끝까지

---

## 2. 문서화 원칙

| 번호 | 성격 | 위치 | 시점 |
|:----:|------|------|------|
| 00 | 프로젝트 개요 | `docs/00_project/` | 프로젝트 시작 시 |
| 01 | 기능 명세 (WHAT) | `docs/01_requirements/` | Phase 시작 시 |
| 02 | 도메인 모델 | `docs/02_domain/` | 설계 시 |
| 03 | API 명세 | `docs/03_api/` | 구현 전 |
| 04 | 아키텍처 설계 (HOW) | `docs/04_architecture/` | Phase 시작 또는 종료 시 |
| 05 | 환경 설정 | `docs/05_env/` | 프로젝트 시작 시 |
| 06 | DevOps / CI/CD | `docs/06_devops/` | 파이프라인 구성 시 |
| 07 | 인프라 | `docs/07_infra/` | 배포 설계 시 |
| — | 의사결정 기록 (WHY) | `docs/dev-log/` | 결정 후 |
| — | 가이드 | `docs/guides/` | 필요 시 |

> **"문서가 없으면 기능도 없다."**

### ID 체계

추적 가능성(Traceability)을 위해 문서 내 주요 항목에 안정적인 ID를 부여한다.

| 대상 | 접두사 | 예시 |
|------|--------|------|
| 화면 | `SCR-` | `SCR-001` 로그인 화면 |
| API | `API-` | `API-012` 사용자 목록 조회 |
| 엔티티 | `ENT-` | `ENT-003` Order |
| 기능 명세 | `REQ-` | `REQ-007` 알림 발송 |

- 한 번 부여된 ID는 변경하지 않는다
- 삭제된 항목의 ID는 재사용하지 않는다

### TODO.md 운영

프로젝트 루트에 `docs/TODO.md`를 유지하며, 주요 작업 후 아래 4가지 섹션을 업데이트한다.

```markdown
## Completed
- [x] SCR-001 로그인 화면 구현

## Blocked
- [ ] API-005 결제 연동 — PG사 API 키 미발급 [확인 필요]

## Questions
- ENT-003 Order 엔티티에 `canceled_at` 필드가 필요한가? [확인 필요]

## Next Actions
- [ ] SCR-002 대시보드 화면 설계
```

- AI가 사용자에게 빈번하게 질문하는 대신, 이 파일에 기록하고 자연스러운 타이밍에 전달한다
- 차단(Blocked) 항목은 이유와 필요한 조치를 함께 기록한다

---

## 3. Git Convention

### 커밋 메시지

```
feat: 새로운 기능 추가
fix: 버그 수정
refactor: 코드 리팩토링 (기능 변경 없음)
docs: 문서 수정
chore: 빌드, 설정 파일 수정
test: 테스트 추가/수정
```

### 브랜치 전략

- main에 직접 커밋/푸쉬하지 않는다
- 기능 브랜치를 만들고 PR을 통해 merge한다
- 브랜치 네이밍: `{type}/{짧은-설명}` (예: `feat/volume-transfer-redesign`, `fix/rrf-score-threshold`)

---

## 4. 환경 변수 관리

- 모든 환경 변수는 `.env.local` (로컬) 또는 배포 플랫폼 대시보드에서 관리한다.
- 코드에 하드코딩 절대 금지
- 민감 값은 반드시 `SecretStr` 타입으로 선언 (backend rules 참조)
- `.env.example` 파일을 항상 최신 상태로 유지한다

```bash
# 환경 변수 목록 (실제 사용 기준)

# 환경 구분
ENVIRONMENT=development          # development | staging | production

# AI (Gemini)
GEMINI_API_KEY=                  # SecretStr
GEMINI_TIER=free                 # free | paid (임베딩 배치 프리셋 자동 적용)

# Database
DATABASE_URL=                    # PostgreSQL connection string (SecretStr)

# Vector DB (Qdrant)
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=                  # SecretStr (optional)
COLLECTION_NAME=malssum_poc

# Admin JWT 인증
ADMIN_JWT_SECRET=                # SecretStr (프로덕션 필수 변경)
ADMIN_JWT_ALGORITHM=HS256
ADMIN_JWT_EXPIRE_MINUTES=1440    # 24시간

# Admin Frontend (CORS)
ADMIN_FRONTEND_URL=http://localhost:3000
COOKIE_SECURE=false              # 프로덕션 True 필수

# Safety
SAFETY_MAX_QUERY_LENGTH=1000
RATE_LIMIT_MAX_REQUESTS=20
RATE_LIMIT_WINDOW_SECONDS=60

# Semantic Cache
CACHE_COLLECTION_NAME=semantic_cache
CACHE_THRESHOLD=0.88
CACHE_TTL_DAYS=7

# Cascading Search 기본값
CASCADE_SCORE_THRESHOLD=0.75
CASCADE_FALLBACK_THRESHOLD=0.60
CASCADE_MIN_RESULTS=3

# 임베딩 파이프라인 (개별 override, 미설정 시 GEMINI_TIER 프리셋 적용)
# EMBED_MAX_CHARS_PER_BATCH=       # TPM 방어 (분당 토큰)
# EMBED_BATCH_SLEEP=               # RPM 방어 (분당 요청)
# EMBED_RPD_LIMIT=                 # RPD 방어 (일일 요청)

# Frontend (Next.js Admin)
NEXT_PUBLIC_API_URL=http://localhost:8000
```
