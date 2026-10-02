# CI·독립 배포

PR은 GitHub Actions에서 검증하고, main 의 CI 가 성공하면 `release.yml` 이 arm64 이미지를 GHCR 에 올린다. **운영 배포는 지금 수동 실행(`deploy=true`) + `production` 환경 승인일 때만 일어난다** — main 머지만으로는 이미지만 만들어진다. 결정 배경은 [배포 파이프라인 ADR](../adr/2026-10-02-gha-deploy-pipeline.md)이다.

## PR 검사 경로

`.github/workflows/ci.yml`은 `main`과 `dev/**` 대상 모든 PR에서 시작한다. workflow 전체를 path filter로 건너뛰지 않고 job별 영향 범위를 판정한다. **`main` push와 수동 `workflow_dispatch`에서도 실행**되며, 이때는 변경 감지를 건너뛰고 전체 검사를 돌린다(필터가 "변경 없음"을 내면 전부 skip인 채 초록이 되는 함정 회피). main push 실행이 남기는 "main은 green"이 `make deploy-guard`의 "main에 포함된 커밋만 배포" 규칙의 근거다. PR run은 새 push가 이전 run을 취소하지만 main push run은 취소하지 않는다.

| 변경 | 검사 |
|---|---|
| `apps/web` / `apps/admin` | 해당 앱의 reusable `ci-web.yml`, 앱 로컬 UI·테마·SDK 소비자 검사 |
| `apps/api` | `ci-api.yml` 전체 pytest, 계약·양 웹 소비자 검사 |
| `contracts`, 생성 SDK·codegen | `ci-contracts.yml` 재생성 일치·기준 계약 대비 호환성·소비자 검사 |
| 공통 lockfile·설정·tooling·workflow | 필요한 앱·API·계약 검사까지 확대 |
| 문서·모든 PR | Repository checks: 링크·경계·tooling 테스트·`infra/oracle-vm/*.sh` 각 파일을 순회하는 `bash -n` 구문 검사 |

`CI Required`가 하위 job 결과를 집계한다. 변경이 없어 정상 skip한 job만 허용하며, 변경 감지 실패·검사 실패·취소·예상하지 않은 skip은 성공으로 바꾸지 않는다. required check 설정을 바꿀 때 저장소 branch protection의 실제 이름도 확인한다. 기존 검사 이름을 제거해 보호 규칙을 우회하지 않는다. **2026-09-05 기준 main 에는 보호 규칙이 없었다**(`protected: false`, Free private 레포는 설정 불가). public 전환 후 ruleset 으로 `CI Required` 를 필수 체크로 등록하기 전까지 `CI Required` 는 표시용이며 `gh pr merge --auto` 도 CI 를 기다리지 않는다([ADR](../adr/2026-09-05-cicd-audit-decisions.md)).

## 언어별 실행

| 범위 | 명령·원칙 |
|---|---|
| API | `cd apps/api` → `uv sync --frozen`(dev 그룹만, `eval` 그룹은 평가 스크립트 전용) → `GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run pytest` |
| JS/TS | 루트 `pnpm install --frozen-lockfile`; 앱·패키지별 test/typecheck/build |
| 계약 | `pnpm contracts:generate` 후 생성 산출물 diff·`pnpm contracts:check`. 전제: 사전 `uv sync`, **Docker 데몬**(oasdiff 컨테이너), 기준 커밋을 포함한 git 이력. 비교 기준은 PR=base 브랜치 tip, main push=직전 커밋, 로컬·수동 실행=`merge-base HEAD origin/main` |
| 저장소 | `pnpm docs:check`, `pnpm boundaries:check`, `pnpm tooling:test`, `bash -n infra/oracle-vm/*.sh` |
| 통합 | `pnpm test:e2e`; web/admin/API와 격리된 테스트 데이터, 실제 실행 범위는 테스트 설정 참조. 로컬은 `make e2e`가 격리 compose 기동→migration→시드→실행→정리를 묶는다 |

루트 `make ci`는 ci.yml의 검사 집합(E2E 제외)을 로컬에서 재현하고, `make e2e`가 `ci-e2e.yml`과 같은 격리 compose·시드·env로 E2E를 돌린다. CI를 바꾸면 두 target과 이 문서를 함께 맞춘다. `make backend-test`는 CI와 같은 env·범위로 전체 회귀를 실행한다(과거의 테스트 제외 옵션은 제거했다). Judge LLM/RAGAS 유료 평가는 CI에 추가하지 않는다.

실제 실행 횟수·통과/실패·외부 의존으로 실행하지 못한 항목은 해당 실행 계획에 남긴다. [최초 M1~M4 완료 증거](../plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)와 [후속 앱별 UI 분리 검증](../plans/active/2026-09-05-app-owned-ui.md)을 구분한다. 과거 청구 차단 기록을 현재 Actions 장애로 단정하지 않는다.

UI·CSS는 앱별 소유이므로 다른 앱의 소스·스타일에 의존하지 않는지 경계 검사를 유지한다. API SDK·ESLint·TypeScript 설정은 공유 패키지로 유지하며 변경 시 양 앱 소비자를 검사한다. Docker 빌드는 각 앱 로컬 UI·테마와 필요한 공유 패키지를 포함한다.

## 계약 생성·호환성

FastAPI 라우트·Pydantic 모델이 원본이다. `contracts/openapi.json`과 `packages/api-client-ts/src/generated`는 직접 편집하지 않는다. 생성기 버전·옵션·lockfile을 고정하고 동일 입력의 재생성 결과가 일치해야 한다.

기준 branch의 계약이 아직 없는 최초 이전 PR은 이동 전 FastAPI schema를 기준선으로 사용한다. 이후 PR은 기준 branch 계약과 비교한다. URL 버전만으로 호환성을 보장하지 않으며, 필드 제거·타입·required·enum·nullable과 오류 응답을 점검한다.

합의한 하위 호환 깨짐(쓰는 곳이 함께 배포되는 우리 앱뿐인 필드 제거 등)은 `contracts/breaking-allowlist.txt`에 oasdiff 메시지 한 줄씩 적어 그 항목만 통과시킨다. 목록에 없는 깨짐은 그대로 실패한다. 해당 PR이 머지된 뒤 다음 계약 PR에서 항목을 지운다.

최초 기준 export의 `POST /chat/stream` 200 응답만 `application/json` 오기를 실제 응답 형식인 `text/event-stream`으로 정규화한다. `tooling/checks/legacy-contract.mjs`가 정확한 기존 모양을 검사하며, **기준 branch에 계약이 있는 이후 PR에는 적용하지 않는다.** 실제 REST schema 변경을 허용하는 예외가 아니다. 상세는 [전환 검증 runbook](monorepo-migration-and-rollback.md#최초-계약-pr의-한정된-sse-정규화)을 참조한다.

SSE는 별도 fixture·이벤트 모델·증분 수신 테스트로 검증한다. OpenAPI 생성 성공만으로 chunk 경계·UTF-8·취소·done 처리까지 완료됐다고 주장하지 않는다.

Turbo는 의존 작업·입출력을 명시해야 한다. 생성 결과와 공통 lockfile·도구 설정이 소비자 캐시 입력에 포함되어야 하며, 배포·서명·외부 상태 의존 작업은 캐시된 성공으로 대체하지 않는다. 웹 실행에 API/Flutter 도구 설치를 필수로 묶지 않는다.

## 독립 이미지와 배포

| 앱 | Dockerfile / 이미지 (`ghcr.io/woosung-dev/…`) | 비상 배포·복구 |
|---|---|---|
| API | `apps/api/Dockerfile` / `truewords-backend:<sha12>` | `make deploy-backend [MIGRATE=1]`, `make rollback-backend TAG=<태그>` |
| 사용자 web | `apps/web/Dockerfile` / `truewords-web:<sha12>` | `make deploy-web`, `make rollback-web TAG=<태그>` |
| 관리자 admin | `apps/admin/Dockerfile` / `truewords-admin:<sha12>` | `make deploy-admin`, `make rollback-admin TAG=<태그>` |

Docker context는 저장소 루트다. API의 venv·소스 레이어 분리, Alembic·운영 scripts 포함, `app.main:app` import 경로를 검증한다. Next standalone은 workspace를 포함하므로 `apps/<app>/server.js`·public·static 배치가 앱별 이미지에 들어가야 한다.

`NEXT_PUBLIC_*` 는 build 시 고정된다. 원본은 커밋된 `infra/oracle-vm/build-args.env`(시연 관리자 이메일만 저장소 Variable `DEMO_ADMIN_EMAIL`)이고, release 와 비상 경로가 같은 파일을 읽는다. 런타임 env만 수정한 뒤 목적지가 바뀌었다고 판정하지 않는다.

### 정상 경로 — `release.yml`

| 단계 | 내용 |
|---|---|
| 시작 | CI 의 main push run 이 성공하면(`workflow_run`) 또는 수동 실행. 대상 sha 가 `origin/main` 의 조상이 아니면 멈춘다 |
| 빌드 | 서비스마다 `ubuntu-24.04-arm` 에서 빌드·push. 같은 태그가 이미 있으면 건너뛴다. 오프라인 probe(리비전·빌드 설정 라벨, backend 는 alembic·uvicorn·import, web/admin 은 rewrite 목적지·origin) |
| 배포 판정 | `tooling/checks/deploy-services.mjs` 가 운영 태그 → 이 sha 사이에 **각 Dockerfile 이 실제로 읽는 파일**이 바뀐 서비스만 고른다. 운영 태그가 이 sha 의 조상이 아니면 `rollback=true` 없이는 멈춘다 |
| 배포 | 강제 명령 SSH 로 VM 의 **최신 main** `deploy.sh` 를 ssh 와 떨어진 프로세스로 실행한다(대상 sha 는 태그를 고르는 데이터). DB migration 이 필요하면 아무것도 바꾸지 않고 `deploy-migrate` job 이 `production-migrate` 승인과 그 환경의 migration 전용 키로 진행한다 |
| 검증 | 운영 태그 확인 + 공개 URL 스모크(캐시 우회, 3회). 실패하면 직전 태그로 자동 롤백(migration 배포는 제외) |
| 알림 | 실패하면 `[deploy-alert]` GitHub Issue 를 열거나 댓글(저장소 소유자에게 메일), 다음 성공 배포가 닫는다. `NTFY_TOPIC` secret 이 있을 때만 ntfy 도 보낸다 |

자동 배포로 바꾸려면 `release.yml` deploy job 의 `if:` 를 바로 아래 주석 줄로 바꾼다. 환경 승인은 그대로 남는다.

### 비상 경로 — `make deploy-*`

Actions 를 쓸 수 없을 때만 쓴다. `deploy-guard`(HEAD ∈ `origin/main`, 깨끗한 트리, 운영 태그가 HEAD 의 조상) → ops-check(advisory) → 로컬 arm64 빌드(같은 GHCR 이름·같은 빌드 인자) → 이미지 전송 → **VM 에 rsync 한 같은 `deploy.sh`** 순이다. 그래서 교체·검사·롤백·`deploy.log` 규칙이 정상 경로와 같다. 예외는 `FORCE_DEPLOY=1` 뿐이며 `deploy.log` 에 `forced` 로 남는다. 실패 모드와 VM 쪽 절차는 [VM 운영 §배포와 롤백](../../infra/oracle-vm/README.md#배포와-롤백)이 원본이다. 단일 VM의 Compose 교체는 무중단을 보장하지 않는다.

## 최초 분리 전환·rollback

기존 운영은 app origin의 통합 admin 이미지다. **최초 전환에는 이전 web 이미지가 없으므로** 이전 통합 admin 이미지·Compose·Cloudflare 라우팅을 묶어서 복구한다. 단순 `rollback-web`만으로 분리 전 상태가 돌아오지 않는다.

`WEB_TAG`·`ADMIN_TAG`·`BACKEND_TAG`는 독립 관리한다. web 문구 변경마다 API 재배포나 미래 iOS 빌드를 강제하지 않는다. `prune-images.sh`는 세 이미지 저장소를 다루며 실행 중·명시적 rollback 보존 태그를 dry-run에서 확인한다. 최신 3개를 보존한다는 이유로 오래된 전환 전 이미지도 반드시 남는다고 가정하지 않는다.

상세 순서와 승인 항목은 [전환·복구 runbook](monorepo-migration-and-rollback.md), 운영 원본은 [VM 운영](../../infra/oracle-vm/README.md)이다.

## 예약 작업의 소유자

| 작업 | 실행 위치·이유 |
|---|---|
| PR CI | GitHub Actions, 외부 머지 게이트 |
| `cache-cleanup.yml` | GitHub Actions, HTTPS Qdrant 대상; working directory는 `apps/api` |
| `release.yml` | GitHub Actions, CI 성공 뒤 이미지 빌드·승인 배포 |
| `ghcr-cleanup.yml` | GitHub Actions 주간, GHCR 오래된 버전 정리(`GHCR_CLEANUP_ENABLED=true` 전까지 dry-run) |
| PostgreSQL 백업·추천 질문 | VM cron, 호스트 로컬 DB 접근 필요 |
| `ops-check.sh`·이미지 GC | VM cron, 실제 컨테이너·디스크·백업 결과 점검 |
| `ops-alert.yml` | GitHub Actions 매일 19:20 UTC, `ops-check.sh` 결과를 읽기 전용 키로 당겨 `[ops-alert] VM 점검` 이슈로 전달(VM 미응답·낡은 결과도 알림) |
| 수동 실행 | 기존 Make target·VM wrapper. 같은 작업의 스케줄러를 중복 등록하지 않음 |

기존 운영은 6시간마다 DB 백업, 주간 추천 질문 갱신, 일일 운영 점검을 사용한다. 이번 전환에서 cron 업무 정책을 바꾸지 않으며 `ops-check.sh`에는 새 web의 상태를 포함한다. 과거 예약 작업 실패의 근거는 [ADR](../adr/2026-07-30-silent-scheduled-job-failure.md)에 보존했다.

운영 secret의 원본은 VM의 보호된 `.env`다. 템플릿만 커밋하며 CI placeholder를 운영 secret으로 사용하지 않는다. 새 변수는 API 설정·앱 예제·VM 예제·필요한 workflow를 함께 갱신한다.
