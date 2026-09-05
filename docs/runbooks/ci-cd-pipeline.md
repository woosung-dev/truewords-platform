# CI·독립 배포

PR은 GitHub Actions에서 검증하고, 운영 배포는 로컬 Mac에서 명시적으로 실행한다. **main 머지나 push가 Oracle 운영을 자동 배포하지 않는다.** 이번 모노레포 PR은 구성 준비이며 원격 배포·Cloudflare 변경은 미실행이다.

## PR 검사 경로

`.github/workflows/ci.yml`은 `main`과 `dev/**` 대상 모든 PR에서 시작한다. workflow 전체를 path filter로 건너뛰지 않고 job별 영향 범위를 판정한다.

| 변경 | 검사 |
|---|---|
| `apps/web` / `apps/admin` | 해당 앱의 reusable `ci-web.yml`, 공유 UI/SDK 소비자 검사 |
| `apps/api` | `ci-api.yml` 전체 pytest, 계약·양 웹 소비자 검사 |
| `contracts`, 생성 SDK·codegen | `ci-contracts.yml` 재생성 일치·기준 계약 대비 호환성·소비자 검사 |
| 공통 lockfile·설정·tooling·workflow | 필요한 앱·API·계약 검사까지 확대 |
| 문서·모든 PR | Repository checks: 링크·경계·tooling 테스트·`infra/oracle-vm/*.sh` 각 파일을 순회하는 `bash -n` 구문 검사 |

`CI Required`가 하위 job 결과를 집계한다. 변경이 없어 정상 skip한 job만 허용하며, 변경 감지 실패·검사 실패·취소·예상하지 않은 skip은 성공으로 바꾸지 않는다. required check 설정을 바꿀 때 저장소 branch protection의 실제 이름도 확인한다. 기존 검사 이름을 제거해 보호 규칙을 우회하지 않는다.

## 언어별 실행

| 범위 | 명령·원칙 |
|---|---|
| API | `cd apps/api` → `uv sync --frozen --all-groups` → `GEMINI_API_KEY=test-key-for-ci uv run pytest` |
| JS/TS | 루트 `pnpm install --frozen-lockfile`; 앱·패키지별 test/typecheck/build |
| 계약 | `pnpm contracts:generate` 후 생성 산출물 diff·`pnpm contracts:check` |
| 저장소 | `pnpm docs:check`, `pnpm boundaries:check`, `pnpm tooling:test` |
| 통합 | `pnpm test:e2e`; web/admin/API와 격리된 테스트 데이터, 실제 실행 범위는 테스트 설정 참조 |

루트 `make ci`는 전체 로컬 사전 점검이다. CI를 바꾸면 이 명령과 설명을 함께 맞춘다. `make backend-test`에 테스트 제외 옵션이 남아 있으면 전체 회귀의 대체 명령으로 사용하지 않는다. Judge LLM/RAGAS 유료 평가는 CI에 추가하지 않는다.

실제 실행 횟수·통과/실패·외부 의존으로 실행하지 못한 항목은 [완료 증거](../plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)에 남긴다. 과거 청구 차단 기록을 현재 Actions 장애로 단정하지 않는다.

## 계약 생성·호환성

FastAPI 라우트·Pydantic 모델이 원본이다. `contracts/openapi.json`과 `packages/api-client-ts/src/generated`는 직접 편집하지 않는다. 생성기 버전·옵션·lockfile을 고정하고 동일 입력의 재생성 결과가 일치해야 한다.

기준 branch의 계약이 아직 없는 최초 이전 PR은 이동 전 FastAPI schema를 기준선으로 사용한다. 이후 PR은 기준 branch 계약과 비교한다. URL 버전만으로 호환성을 보장하지 않으며, 필드 제거·타입·required·enum·nullable과 오류 응답을 점검한다.

최초 기준 export의 `POST /chat/stream` 200 응답만 `application/json` 오기를 실제 응답 형식인 `text/event-stream`으로 정규화한다. `tooling/checks/legacy-contract.mjs`가 정확한 기존 모양을 검사하며, **기준 branch에 계약이 있는 이후 PR에는 적용하지 않는다.** 실제 REST schema 변경을 허용하는 예외가 아니다. 상세는 [전환 검증 runbook](monorepo-migration-and-rollback.md#최초-계약-pr의-한정된-sse-정규화)을 참조한다.

SSE는 별도 fixture·이벤트 모델·증분 수신 테스트로 검증한다. OpenAPI 생성 성공만으로 chunk 경계·UTF-8·취소·done 처리까지 완료됐다고 주장하지 않는다.

Turbo는 의존 작업·입출력을 명시해야 한다. 생성 결과와 공통 lockfile·도구 설정이 소비자 캐시 입력에 포함되어야 하며, 배포·서명·외부 상태 의존 작업은 캐시된 성공으로 대체하지 않는다. 웹 실행에 API/Flutter 도구 설치를 필수로 묶지 않는다.

## 독립 이미지와 배포

| 앱 | Dockerfile / 이미지 | 배포·복구 |
|---|---|---|
| API | `apps/api/Dockerfile` / `truewords-backend` | `make deploy-backend`, `make rollback-backend TAG=<태그>` |
| 사용자 web | `apps/web/Dockerfile` / `truewords-web` | `make deploy-web`, `make rollback-web TAG=<태그>` |
| 관리자 admin | `apps/admin/Dockerfile` / `truewords-admin` | `make deploy-admin`, `make rollback-admin TAG=<태그>` |

Docker context는 저장소 루트다. API의 venv·소스 레이어 분리, Alembic·운영 scripts 포함, `app.main:app` import 경로를 검증한다. Next standalone은 workspace를 포함하므로 `apps/<app>/server.js`·public·static 배치가 앱별 이미지에 들어가야 한다.

`NEXT_PUBLIC_API_URL`과 앱 간 origin은 build 시 고정된다. 운영에서는 API rewrite를 `http://backend:8080`으로 빌드하고 확정 사용자/admin origin을 전달한다. 런타임 env만 수정한 뒤 목적지가 바뀌었다고 판정하지 않는다.

로컬 arm64 빌드 → entrypoint/smoke 확인 → SSH image load → 태그 갱신 → compose healthy 확인 순이다. 단일 VM의 Compose 교체는 무중단을 보장하지 않는다. 이미지 배포 권한은 PR 생성 권한과 구분한다.

## 최초 분리 전환·rollback

기존 운영은 app origin의 통합 admin 이미지다. **최초 전환에는 이전 web 이미지가 없으므로** 이전 통합 admin 이미지·Compose·Cloudflare 라우팅을 묶어서 복구한다. 단순 `rollback-web`만으로 분리 전 상태가 돌아오지 않는다.

`WEB_TAG`·`ADMIN_TAG`·`BACKEND_TAG`는 독립 관리한다. web 문구 변경마다 API 재배포나 미래 iOS 빌드를 강제하지 않는다. `prune-images.sh`는 세 이미지 저장소를 다루며 실행 중·명시적 rollback 보존 태그를 dry-run에서 확인한다. 최신 3개를 보존한다는 이유로 오래된 전환 전 이미지도 반드시 남는다고 가정하지 않는다.

상세 순서와 승인 항목은 [전환·복구 runbook](monorepo-migration-and-rollback.md), 운영 원본은 [VM 운영](../../infra/oracle-vm/README.md)이다.

## 예약 작업의 소유자

| 작업 | 실행 위치·이유 |
|---|---|
| PR CI | GitHub Actions, 외부 머지 게이트 |
| `cache-cleanup.yml` | GitHub Actions, HTTPS Qdrant 대상; working directory는 `apps/api` |
| PostgreSQL 백업·추천 질문 | VM cron, 호스트 로컬 DB 접근 필요 |
| `ops-check.sh`·이미지 GC | VM cron, 실제 컨테이너·디스크·백업 결과 점검 |
| 수동 실행 | 기존 Make target·VM wrapper. 같은 작업의 스케줄러를 중복 등록하지 않음 |

기존 운영은 6시간마다 DB 백업, 주간 추천 질문 갱신, 일일 운영 점검을 사용한다. 이번 전환에서 cron 업무 정책을 바꾸지 않으며 `ops-check.sh`에는 새 web의 상태를 포함한다. 과거 예약 작업 실패의 근거는 [ADR](../adr/2026-07-30-silent-scheduled-job-failure.md)에 보존했다.

운영 secret의 원본은 VM의 보호된 `.env`다. 템플릿만 커밋하며 CI placeholder를 운영 secret으로 사용하지 않는다. 새 변수는 API 설정·앱 예제·VM 예제·필요한 workflow를 함께 갱신한다.
