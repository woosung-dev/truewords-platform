# CI/CD 파이프라인

> 2026-07-29 GCP → Oracle Cloud 이전으로 **배포 자동화가 사라졌다.** CI(테스트)는 GitHub Actions 에 그대로 남고, 배포는 로컬 Mac 에서 `make` 로 수행한다.
> 이전 경위: [`docs/dev-log/2026-07-25-gcp-to-oracle-migration.md`](../dev-log/2026-07-25-gcp-to-oracle-migration.md) · 인프라: [`docs/07_infra/oracle-vm-migration.md`](../07_infra/oracle-vm-migration.md)

## 파이프라인 개요

```
GitHub Actions (provider 무관 — 이전해도 그대로)
  ├── ci.yml             PR(main, dev/**) → pytest + vitest + build
  └── cache-cleanup.yml  매일 18:00 UTC   → semantic_cache TTL 만료 정리
                         ↳ 로컬 사전 점검: make ci / make cron-cache-cleanup

VM cron (리소스가 호스트 로컬이라 여기 있을 수밖에 없음)
  ├── backup-db.sh          매일 18:00 UTC   → Postgres 덤프 + Object Storage
  └── refresh-questions.sh  매주 일 18:30 UTC → 봇별 추천 질문 갱신
                            ↳ 둘 다 Postgres 가 127.0.0.1 바인딩이라 runner 가 못 닿음

배포 (로컬 Mac, 수동)
  ├── make deploy-backend   arm64 빌드 → entrypoint 검증 → ssh docker load → compose 교체
  └── make deploy-admin     동일 패턴
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

## 정책 — orchestration 은 GitHub Actions 에 둔다

**정기 작업과 PR 게이트의 스케줄·트리거는 provider 에 묶지 않는다.** GitHub Actions 는 외부 trigger 라 실행 환경이 GCP 든 Oracle 이든 AWS 든 같은 워크플로가 그대로 돈다. 이전할 때 바뀌는 건 secrets 값뿐이다.

Oracle 이전(2026-07-29) 때 이 정책을 잠깐 어겼다. GHA 가 청구 문제로 멈춘 걸 계기로 `cache-cleanup.yml` 을 VM cron 으로 내렸는데, **청구 문제는 GHA 를 떠날 이유가 아니라 청구를 고칠 이유였다.** 2026-07-30 에 되돌렸다.

### 예외는 단 하나 — 리소스가 호스트 로컬일 때

| 작업 | 위치 | 이유 |
|---|---|---|
| `ci.yml` | **GHA** | provider 무관. 깨끗한 환경에서 도는 머지 게이트 |
| `cache-cleanup.yml` | **GHA** | Qdrant 를 `vdb.<zone>` HTTPS 로만 호출 — 어디서든 동작 |
| `backup-db.sh` | VM cron | **Postgres 가 `127.0.0.1` 바인딩.** runner 가 물리적으로 닿을 수 없다 |
| `refresh-questions.sh` | VM cron | 같은 이유 (Postgres 필요) |
| `make deploy-*` | 로컬 Mac | Mac 이 이미 arm64 라 VM 과 아키텍처 동일. 레지스트리 없이 `docker save \| ssh docker load` 가 최단 |

VM cron 쪽 두 건도 **스크립트 자체는 provider 무관**하다 (`backend/scripts/*.py` 가 env 만 읽는다). VM 특정적인 건 얇은 래퍼뿐이다.

### AWS 로 옮긴다면

Postgres 가 네트워크로 닿는 순간(RDS 등) VM cron 예외가 사라진다.

| 지금 | AWS 이후 | 바뀌는 것 |
|---|---|---|
| `ci.yml` | 그대로 | 없음 |
| `cache-cleanup.yml` | 그대로 | `QDRANT_URL` / `QDRANT_API_KEY` secrets |
| `backup-db.sh` (VM cron) | → **GHA 워크플로** | RDS 자동 백업으로 대체하거나 `DATABASE_URL` secret 만 주고 GHA 로 승격 |
| `refresh-questions.sh` (VM cron) | → **GHA 워크플로** | `DATABASE_URL` secret 추가. 스크립트 변경 0 |
| `make deploy-*` | → ECR push + ECS/App Runner | 이전 방식이 provider 마다 달라 여기만 재작성 |

즉 **정기 작업 4건 중 3건은 AWS 이전 시 코드 변경 0건**이고, 배포만 다시 쓴다.

## CI 를 로컬에서도 — `make ci`

`ci.yml` 이 머지 게이트고, `make ci` 는 **푸시 전 사전 점검**이다. GHA 를 대체하는 게 아니다 — 청구 차단처럼 GHA 가 멈춘 동안에는 임시로 유일한 게이트가 되지만, 정상 상태에서는 "push 전에 미리 돌려 보는 것" 이다.

`make ci` 가 `ci.yml` 과 **같은 명령을 같은 순서로** 돌린다.

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

## 이전 중 겪은 두 사고

정기 작업 배치를 결정한 실제 근거다. 둘 다 **조용히 실패하는** 형태였다.

1. **추천 질문 갱신 — 죽은 DB 에 "성공" 기록.** Postgres 를 Neon 에서 VM 로컬로 옮긴 뒤에도 `refresh-suggested-questions.yml` 이 GHA 에 남아 있었고 `DATABASE_URL` secret 은 낡은 Neon 값이었다. runner 는 VM 의 `127.0.0.1` Postgres 에 닿을 수 없으니, 그대로 뒀다면 구 DB 에 붙어 아무 효과 없는 성공을 기록했을 것이다. → VM cron 으로 내렸다 (닿을 수 없으니 선택이 아니다).

2. **semantic_cache 정리 — 매일 실패, 5일간 아무도 모름.** GHA 청구 차단으로 `cache-cleanup.yml` 이 7/24부터 매일 실패했고 만료 point 가 134개 쌓였다. 반사적으로 VM cron 으로 내렸지만, 그건 **원인(청구)을 고치는 대신 증상을 피한 것**이라 7/30 에 GHA 로 되돌렸다.

두 번째 사고의 교훈은 위치가 아니라 **알림**이다. VM cron 도 실패를 알려주지 않는다. 어느 쪽에 두든 남는 약점이라 `docs/TODO.md` 에 별도 항목으로 뒀다.

## 수동 실행 진입점

스케줄러는 위 표대로 하나씩만 두고, 사람이 돌려야 할 때는 로컬 make target 을 쓴다.

```bash
make cron-cache-cleanup ARGS=--dry-run   # 삭제 대상만 확인
make cron-cache-cleanup                  # GHA 가 멈춘 동안 대신 실행
make cron-refresh-questions ARGS=--dry-run
make cron-refresh-questions
make restore-drill                       # 백업 복구 리허설
```

`cron-cache-cleanup` 은 GHA 워크플로와 **같은 스크립트**(`backend/scripts/cleanup_semantic_cache.py`)를 돌린다. 경로만 다르다 — GHA 는 secrets 로, make 는 VM 컨테이너의 주입된 env 로.

## GitHub Secrets 설정

배포가 로컬로 내려가면서 **운영 환경변수의 원본은 VM 의 `~/truewords/.env`(chmod 600)** 다. GitHub Secrets 는 워크플로가 쓰는 것만 유효해야 한다.

| Secret | 상태 | 사용처 |
|--------|------|--------|
| `QDRANT_URL` / `QDRANT_API_KEY` | ✅ 유효 (2026-07-29 갱신) | `cache-cleanup.yml` |
| `DATABASE_URL` | ⚠️ **값이 구 Neon URL** | 없음. 되살려 쓰면 안 된다 — AWS 이전 시 `refresh-questions` 를 GHA 로 승격할 때 새 값으로 교체 |
| `GEMINI_API_KEY` / `GEMINI_TIER` | 유휴 | 없음 (VM `.env` 가 원본) |
| `ADMIN_JWT_SECRET` / `ADMIN_FRONTEND_URL` | 유휴 | 없음 (VM `.env` 가 원본) |

`ci.yml` 은 secret 을 쓰지 않는다 — `GEMINI_API_KEY: test-key-for-ci` 를 인라인 placeholder 로 쓴다.

GCP 배포용 3종(`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`)은 이전과 함께 삭제했다. 유휴 4종은 남겨 뒀다 — 워크플로가 늘면 재등록 비용이 있고, `DATABASE_URL` 만 값이 무효라는 사실을 위 표에 명시했다.

> ⚠️ **GitHub Actions 청구 차단 (2026-07-24~).** 모든 Actions 가 `The job was not started because recent account payments have failed or your spending limit needs to be increased` 로 실행되지 않는다. PR CI 도 queued 에서 멈춘다. **Settings → Billing & plans 에서 해소해야 한다 — 이게 근본 조치다.**
>
> 그동안의 대응:
> - **PR 게이트** → `make ci` 를 사람이 돌린다
> - **캐시 정리** → `make cron-cache-cleanup` 을 사람이 돌린다. 안 돌아도 응답 정합성은 깨지지 않는다 (조회가 TTL 로 필터링, `src/cache/service.py:89-94`) — 디스크만 찬다
> - **백업·추천 질문** → VM cron 이라 영향 없음
>
> 차단이 풀리면 `ci.yml` 과 `cache-cleanup.yml` 이 자동으로 다시 돈다. **되돌릴 작업은 없다.**

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
