# CI/CD 파이프라인

> 2026-07-29 GCP → Oracle Cloud 이전으로 **배포 자동화가 사라졌다.** CI(테스트)는 GitHub Actions 에 그대로 남고, 배포는 로컬 Mac 에서 `make` 로 수행한다.
> 이전 경위: [`docs/dev-log/2026-07-25-gcp-to-oracle-migration.md`](../dev-log/2026-07-25-gcp-to-oracle-migration.md) · 인프라: [`docs/07_infra/oracle-vm-migration.md`](../07_infra/oracle-vm-migration.md)

## 파이프라인 개요

```
PR (main 또는 dev/**)  → CI (.github/workflows/ci.yml)
                            ├── Backend Tests: pytest
                            └── Frontend Tests: vitest + build
                       ↳ 로컬 동등 실행: make ci   ← GHA 청구 차단 동안 유일한 게이트

배포 (수동, 로컬 Mac)   → make deploy-backend   # arm64 빌드 → ssh docker load → compose 교체
                        → make deploy-admin     # 동일 패턴

정기 작업 (전부 VM cron — GitHub Actions 에 없음)
  ├── backup-db.sh          매일 18:00 UTC — Postgres 덤프 + Object Storage
  ├── cache-cleanup.sh      매일 18:15 UTC — semantic_cache TTL 만료 정리
  └── refresh-questions.sh  매주 일 18:30 UTC — 봇별 추천 질문 갱신
```

**push 자동 배포는 없다.** Cloud Run 이 사라지면서 `deploy.yml` 을 제거했다. main 에 머지해도 운영 반영은 일어나지 않으므로, 머지 후 명시적으로 `make deploy-backend` 를 실행해야 한다.

---

## CI 파이프라인 (`.github/workflows/ci.yml`)

**트리거:** `pull_request` on `main` 및 `dev/**` (통합 브랜치로 가는 sub-task PR 포함)

### Detect changes
- `dorny/paths-filter@v3` 로 `backend/` · `admin/` 변경 여부 판정.
- 변경 없는 도메인은 해당 job 을 skip 하되 required check 을 만족하도록 구성 (branch protection 호환).

### Backend Tests
1. Python 3.12 + uv 설치
2. `uv sync --frozen --all-groups`
3. `uv run pytest -v` (`GEMINI_API_KEY=test-key-for-ci`)

### Frontend Tests
1. Node.js 22 + pnpm 8
2. `pnpm install --frozen-lockfile`
3. `pnpm test` (vitest)
4. `pnpm build` (빌드 검증)

---

## 배포 (Oracle Cloud VM, 수동)

레지스트리를 쓰지 않는다. 로컬 Mac(Apple Silicon)이 이미 arm64 라 VM 과 아키텍처가 같아, 빌드한 이미지를 SSH 로 직접 밀어 넣는 것이 가장 짧다.

```bash
make deploy-backend            # HEAD sha 로 빌드·배포
make deploy-admin              # admin 도 동일

make rollback-backend TAG=<이전 sha>   # TAG 명시 필수 (가드 있음)
make rollback-admin   TAG=<이전 sha>

make oracle-logs               # VM compose 로그 follow
```

`deploy-backend` 의 단계는 다음과 같다.

1. `docker buildx build --platform linux/arm64` 로 `truewords-backend:<sha>` 빌드
2. **entrypoint 검증** — `alembic --version && uvicorn --version`. dev-log 41~42 의 `uv: not found` 사고(runtime stage 에 binary 부재로 기동 실패) 재발 방지 게이트다.
3. `docker save | gzip -1 | ssh 'gunzip | sudo docker load'` — Makefile 이 `pipefail` 을 켜므로 스트림이 잘리면 즉시 실패한다.
4. VM `~/truewords/.env` 의 `BACKEND_TAG` 를 새 sha 로 치환 → `docker compose up -d --wait backend`

`--wait` 가 healthcheck 통과까지 블로킹하므로, 명령이 성공으로 끝나면 새 컨테이너가 실제로 살아 있는 것이다.

### Frontend

admin 도 같은 VM 에서 컨테이너로 돈다. `truewords-platform.vercel.app` 은 신규 도메인으로 리다이렉트만 하는 상태로 남겨둔다 (기존 안내 링크 보호). 상세는 `infra/oracle-vm/README.md`.

---

## CI 를 로컬에서 — `make ci`

GitHub Actions 가 청구 문제로 멈춘 동안(2026-07-24~) PR 게이트가 사라졌다. `make ci` 가 `ci.yml` 과 **같은 명령을 같은 순서로** 돌린다.

```bash
make ci
# [1/5] backend — uv sync --frozen --all-groups
# [2/5] backend — pytest            (ci.yml 과 동일: --ignore 없음)
# [3/5] admin   — pnpm install --frozen-lockfile
# [4/5] admin   — pnpm test
# [5/5] admin   — pnpm build
```

**`ci.yml` 을 바꿀 때 이 target 도 같이 바꾼다.** 명령이 갈라지면 "로컬에서 CI 통과" 가 아무 뜻도 없어진다.

`ci.yml` 은 path filter 로 변경된 쪽만 돌지만 `make ci` 는 둘 다 돌린다 — 로컬에서 필터를 재현할 이득이 없다.

lint 와 E2E 는 `ci.yml` 에 없어서 `make ci` 에도 없다. 따로 돈다: `make admin-lint`, `make admin-e2e`. E2E 는 로컬 시드가 선행돼야 한다 (`docs/TODO.md` §13 참조).

## 정기 작업이 어디서 도는가

**전부 VM cron 이다. GitHub Actions 에는 예약 작업이 남아 있지 않다.**

| 작업 | 주기 | VM 인 이유 |
|---|---|---|
| `backup-db.sh` | 매일 03:00 KST | Postgres 가 VM 로컬 127.0.0.1 바인딩이라 runner 가 닿을 수 없음 |
| `cache-cleanup.sh` | 매일 03:15 KST | Qdrant 는 HTTPS 라 어디서든 되지만, 예약 작업을 한 곳에 모아 외부 청구·계정 상태와 분리 |
| `refresh-questions.sh` | 매주 월 03:30 KST | Postgres 필요 |

두 사고가 이 배치를 만들었다.

1. **추천 질문 갱신** — Postgres 이전 후에도 `refresh-suggested-questions.yml` 이 남아 있었고 `DATABASE_URL` secret 은 낡은 Neon 값이었다. 그대로 뒀다면 **죽은 DB 에 붙어 "성공"을 기록**했을 것이다.
2. **semantic_cache 정리** — `cache-cleanup.yml` 이 청구 차단으로 매일 실패했지만 아무도 몰랐고 만료 point 가 134개 쌓였다. 외부 청구 상태가 운영 작업을 멈추는 구조를 없앴다.

수동 실행은 로컬 make target 을 쓴다.

```bash
make cron-cache-cleanup ARGS=--dry-run
make cron-cache-cleanup
make cron-refresh-questions ARGS=--dry-run
make cron-refresh-questions
make restore-drill
```

## GitHub Secrets 설정

배포가 로컬로 내려오고 예약 작업이 VM 으로 내려가면서 **운영 환경변수의 원본은 VM 의 `~/truewords/.env`(chmod 600) 하나**다. 남은 워크플로는 `ci.yml` 뿐이고 이건 `GEMINI_API_KEY: test-key-for-ci` 를 인라인으로 쓴다.

| Secret | 상태 |
|--------|------|
| `QDRANT_URL` / `QDRANT_API_KEY` | **미사용** — cache-cleanup 이 VM 으로 이전 |
| `DATABASE_URL` | **미사용** — 값이 구 Neon URL 이라 되살려 쓰면 안 된다 |
| `GEMINI_API_KEY` / `GEMINI_TIER` / `ADMIN_JWT_SECRET` / `ADMIN_FRONTEND_URL` | 미사용 (VM `.env` 가 원본) |

GCP 배포용 3종(`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`)은 이전과 함께 삭제했다. 남은 7개는 지우지 않았다 — 되살릴 워크플로가 생기면 재등록하는 비용이 있고, 값이 유효하지 않다는 사실만 위 표에 명시했다.

> ⚠️ **GitHub Actions 청구 차단 (2026-07-24~).** 모든 Actions 가 `The job was not started because recent account payments have failed or your spending limit needs to be increased` 로 실행되지 않는다. PR CI 도 queued 에서 멈춘다. Settings → Billing & plans 에서 해소해야 한다.
>
> 그동안 **PR 게이트는 `make ci`** 이고 **예약 작업은 VM cron** 이므로 운영에 공백은 없다. 차단이 풀리면 `ci.yml` 이 자동으로 다시 돈다 — 되돌릴 작업은 없다.

---

## 롤백 절차

### Backend / Admin

```bash
make rollback-backend TAG=<직전 배포 sha>
make rollback-admin   TAG=<직전 배포 sha>
```

`TAG` 기본값(현재 HEAD)으로 롤백하면 방금 배포한 태그를 다시 기록하는 no-op 이 된다. 배포 실패 직후 반사적으로 호출하는 경로라 롤백된 줄 알고 장애가 이어지므로, Makefile 이 명시 전달을 강제한다.

이전 이미지는 VM 에 남아 있어야 한다. `docker image ls truewords-backend` 로 확인한다.

### VM 자체 장애

`infra/oracle-vm/README.md` 의 트러블슈팅과 백업/복구 절을 따른다. Postgres 는 `/opt/backups` 의 일일 덤프 + Object Storage 사본으로 복구한다.

---

## 새 환경변수 추가 시

1. `backend/src/config.py` Settings 클래스에 필드 추가
2. `backend/.env.example` 업데이트
3. `infra/oracle-vm/.env.example` 에 추가 (VM `.env` 템플릿)
4. VM `~/truewords/.env` 에 실제 값 기입 → `make deploy-backend` (또는 `docker compose up -d backend`)
5. cron 워크플로가 그 값을 쓴다면 GitHub Secrets 에도 등록하고 위 §GitHub Secrets 표를 갱신
