# CI/CD 파이프라인

> 2026-07-29 GCP → Oracle Cloud 이전으로 **배포 자동화가 사라졌다.** CI(테스트)는 GitHub Actions 에 그대로 남고, 배포는 로컬 Mac 에서 `make` 로 수행한다.
> 이전 경위: [`docs/dev-log/2026-07-25-gcp-to-oracle-migration.md`](../dev-log/2026-07-25-gcp-to-oracle-migration.md) · 인프라: [`docs/07_infra/oracle-vm-migration.md`](../07_infra/oracle-vm-migration.md)

## 파이프라인 개요

```
PR (main 또는 dev/**)  → CI (.github/workflows/ci.yml)
                            ├── Backend Tests: pytest
                            └── Frontend Tests: vitest + build

배포 (수동, 로컬 Mac)   → make deploy-backend   # arm64 빌드 → ssh docker load → compose 교체
                        → make deploy-admin     # 동일 패턴

정기 작업
  ├── GitHub Actions  cache-cleanup.yml       매일 18:00 UTC — semantic_cache TTL 만료 정리
  └── VM cron         refresh-questions.sh    매주 일 18:30 UTC — 봇별 추천 질문 갱신
                      backup-db.sh            매일 18:00 UTC — Postgres 덤프 + Object Storage
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

## 정기 작업이 어디서 도는가

DB 위치가 실행 위치를 정한다.

| 작업 | 실행 위치 | 이유 |
|---|---|---|
| `cache-cleanup.yml` | GitHub Actions | Qdrant 를 `vdb.<zone>` HTTPS 로만 호출 — 어디서든 동작 |
| `refresh-questions.sh` | **VM cron** | Postgres 가 필요. VM 로컬 127.0.0.1 바인딩이라 runner 가 닿을 수 없음 |
| `backup-db.sh` | **VM cron** | 같은 이유 |

Postgres 이전 전까지 추천 질문 갱신은 `refresh-suggested-questions.yml` 로 GitHub runner 에서 돌았다. 이전 후 그대로 뒀다면 **낡은 Neon 연결 문자열로 붙어 아무 효과 없는 성공을 기록**했을 것이므로 워크플로를 삭제하고 VM cron 으로 내렸다. 상세는 `infra/oracle-vm/README.md` §정기 작업.

## GitHub Secrets 설정

배포가 로컬로 내려오면서 **운영 환경변수의 원본은 VM 의 `~/truewords/.env`(chmod 600)** 다. GitHub Secrets 는 이제 `cache-cleanup.yml` 이 쓰는 값만 실제로 쓰인다.

| Secret | 사용처 |
|--------|--------|
| `QDRANT_URL` / `QDRANT_API_KEY` | cache-cleanup |
| `DATABASE_URL` | **미사용** — 값이 구 Neon URL 이라 되살려 쓰면 안 된다 |
| `GEMINI_API_KEY` / `GEMINI_TIER` / `ADMIN_JWT_SECRET` / `ADMIN_FRONTEND_URL` | 미사용 (VM `.env` 가 원본) |

GCP 배포용 3종(`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`)은 이전과 함께 삭제했다.

> ⚠️ **2026-07-29 현재 GitHub Actions 가 청구 문제로 실행되지 않는다.** 예약 작업이 `The job was not started because recent account payments have failed or your spending limit needs to be increased` 로 실패하며, PR CI 도 queued 상태로 머문다. Settings → Billing & plans 에서 해소해야 한다. 그동안은 `make backend-test` / `make admin-test` 로컬 실행이 유일한 게이트다.

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
