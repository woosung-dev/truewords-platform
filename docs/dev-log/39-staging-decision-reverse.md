# Dev-log 39 — Staging 분리 결정 reverse

- **작성일**: 2026-04-25
- **브랜치**: `chore/revert-staging-decision` (PR #52 후보)
- **상위**: 선행 #2 staging 환경 분리 결정 (2026-04-25 채택) reverse
- **연관**:
  - 이전 결정 문서: `docs/07_infra/staging-separation.md` (보존, 본 reverse 후 history 자료)
  - 메인 플랜: `sleepy-sleeping-summit.md` §22 + 선행 #2
  - 본 세션 plan: `polymorphic-scribbling-bengio.md`

---

## Reverse 근거

### 1. Qdrant Cloud 청구 모델 가정 오류

이전 결정 (`staging-separation.md` §3 분리 원칙) 의 핵심:

> 1. **비용 최소화**: staging 은 운영 검증용. 별도 리소스 풀 띄우지 않고 **같은 클러스터/인스턴스에서 네임스페이스로 분리**.

이 원칙의 **숨겨진 가정**: Qdrant Cloud 가 "클러스터 단위" 청구.

**현실**: Qdrant Cloud 는 클러스터 내 **저장 용량 + 검색 호출 단위** 청구.

| 항목 | 운영만 | 운영 + staging |
|------|--------|----------------|
| 컬렉션 | 2개 (`malssum_poc`, `semantic_cache`) | 4개 (+`_staging`) |
| 저장 데이터 | 615권 임베딩 청크 (수십만 건) | 운영 + staging 일부 = **사실상 2배 가까이** |
| 청구 영향 | baseline | **용량 추가분 직접 가중** |

→ "같은 클러스터로 비용 최소화" 라는 원칙의 효과 미미. 무료 티어 또는 작은 플랜에선 **용량 한도 직접 영향**.

### 2. 단일 개발자 + 소규모 운영 단계

staging 의 두 핵심 가치:
- (a) **협업** — 여러 명이 main 머지 전 검증
- (b) **production 배포 검증** — 운영 직배포 위험 회피

현재 단계:
- 단일 개발자 → (a) 가치 부재
- PR #42~#51 까지 main → production 직배포 흐름이 안정적으로 작동 → (b) 의 위험도 실측상 낮음

### 3. R3 PoC 의 안전성 재평가

R3 PoC migration `33d34f262dc2_add_volume_raw_to_answer_citation`:
```sql
ADD COLUMN volume_raw VARCHAR(64) NULL
```
- NULLABLE 컬럼 추가 = 가장 안전한 패턴
- 기존 row 영향 0
- 다운타임 0
- 운영 직접 적용 가능

→ "운영 직배포 검증을 위한 staging 필요성" 도 약화.

### 종합

세 근거가 누적되어 **staging 도입의 비용/복잡도 > 효익**. 결정 reverse.

---

## 본 PR 의 cleanup 범위 (최소 정리)

### A. Active runtime 제거 ✅
| 파일 | 변경 |
|------|------|
| `backend/src/config.py` | L7 environment 주석에서 staging 제거. L80-92 `apply_environment_suffix` validator 전체 삭제 |
| `backend/tests/test_config_staging.py` | 파일 전체 삭제 (단위 9건) |
| `.github/workflows/deploy.yml` | `branches: [main, develop]` → `[main]`. `deploy-staging` job 전체 삭제. staging 관련 주석 정리 |

### B. 결정 reverse 추적 (single source of truth) ✅
- 본 dev-log 39
- 메모리 `project_refactoring_plan.md` 갱신 (별도 commit 또는 본 commit 에 포함)

### C. 보존 (history 가치)
다음은 **수정 없이 그대로 유지** — 미래 staging 재도입 결정 시 이전 분석 자료로 활용:
- `docs/07_infra/staging-separation.md` (메인 설계 문서, §7 D1~D8 체크리스트)
- `docs/06_devops/ci-cd-pipeline.md` (staging 섹션 그대로, 본 dev-log 가 reverse 명시)
- `docs/05_env/environment-setup.md`
- `docs/07_infra/gcp-vercel-infrastructure.md`
- `backend/scripts/qdrant_schema_drift_probe.py` (기본값 `_staging` 유지 — 호출 시 명시적 인자로 운영 컬렉션명 override)
- 모든 dev-log (27, 31, 33, 34, 35, 36, 38)
- 모든 specs / plans

→ 다음 세션이 본 dev-log 39 만 보면 결정 reverse 즉시 인지 가능.

### D. GCP/GitHub 측 cleanup
**0건**. 사용자가 §9.X 어느 단계도 실행하지 않은 상태:
- Cloud SQL `truewords_staging` DB: 미생성
- Qdrant `*_staging` 컬렉션: 미생성
- GitHub Secrets `*_STAGING`: 미등록
- Cloud Run `truewords-backend-staging`: 미배포
- Vercel Preview env: 미설정
- `develop` 브랜치 + 보호 규칙: 미생성

→ 외부 인프라 cleanup 불필요.

---

## 검증 evidence

```bash
# 회귀 0
$ uv run pytest -x
407 → 398 passed, 1 xfailed (-9 의도된 삭제: test_config_staging.py)

# active 잔재 0
$ rg "apply_environment_suffix" backend/src --type py
0건

$ rg "deploy-staging|truewords-backend-staging|develop" .github/workflows/deploy.yml
0건

$ uv run python -c "import yaml; print(list(yaml.safe_load(open('.github/workflows/deploy.yml'))['jobs'].keys()))"
['deploy-production']
```

---

## 운영 흐름 변경 (다음 세션부터)

### 이전 (staging 도입 가정)
```
local pytest → main 머지 → develop merge → staging 자동 배포 → 스모크 → main → production
```

### 현재 (직접 흐름)
```
local pytest → main 머지 → production 자동 배포 (deploy-production job)
```

### 선행 #3/#5 의 영향

**#3 Qdrant schema drift probe**:
- 운영 Qdrant 클러스터에 read-only 호출 (`get_collection().payload_schema`)
- 명시적 인자: `uv run python backend/scripts/qdrant_schema_drift_probe.py --execute --main malssum_poc --cache semantic_cache --report reports/qdrant_drift.json`
- 영향 0 (read-only)

**#5 품질 baseline 200건**:
- 운영 chat API 직접 호출
- analytics 통계에 200건 섞임 + Gemini 비용 ~$1~3
- baseline ID prefix 로 분리해 admin 대시보드 필터 가능 (검토 필요)
- 200건 baseline 자체는 R1/R2/R3 비교 기준선이라 의미 있는 데이터

**R3 PoC migration (`33d34f262dc2`)**:
- 다음 production 배포 시 Cloud Run 이 자동 적용
- Dockerfile entrypoint 의 `alembic upgrade head`
- 별도 작업 0

---

## 미래 staging 재도입 조건

본 reverse 가 영구 결정은 아님. 다음 시점에 재검토:
1. **B2C 공개 직전** — 사용자 데이터 보호 + production 안정성 우선
2. **여러 명 협업 시작** — main 머지 전 동료 검증 필요
3. **Qdrant Cloud 플랜 업그레이드** — 용량 여유 확보로 staging 컬렉션 추가 가능

재도입 시:
- 본 dev-log 39 reverse + 새 dev-log 작성
- `staging-separation.md` 의 D1~D8 체크리스트는 그대로 활용 가능
- 단 §3 비용 가정은 새로 검증 필요 (Qdrant Cloud 플랜에 따라)

---

## 메인 플랜 §23 준수

- 검증 루프: commit 당 1회 (red→green→commit). 3회 상한 미접근.
- 문서 분량: 본 dev-log 약 130줄 / 임계 2,000줄 충분 여유.
- Δ 누적: 0 — 본 PR 은 reverse 만, 새 코드/모델 도입 0.
