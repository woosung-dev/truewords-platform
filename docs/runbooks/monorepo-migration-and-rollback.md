# 모노레포 전환·복구 runbook

- 대상: `PLAN-MONO-001` M1~M4의 경로·앱 분리. 기존 DB schema와 RAG 정책은 바꾸지 않는다.
- 상태: **2026-09-06 운영 전환 실행 완료** — 실측은 [§실행 기록](#실행-기록-2026-09-06). 이후 재배포·롤백 절차 문서로 유지한다. 코드·테스트의 완료 증거는 [현재 실행 계획](../plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)에 기록한다.
- 후속 [APP-UI-001](../plans/active/2026-09-05-app-owned-ui.md)은 UI·테마를 각 앱으로 옮기고 API SDK·ESLint·TypeScript 설정 3개 패키지만 유지한다. 앱별 CSS·UI를 이미지에 포함해 재검증하며 아래 최초 전환의 이미지 성공을 후속 변경 성공으로 재사용하지 않는다. 운영 라우팅·쿠키·DB 정책은 이 UI 이동으로 바꾸지 않는다.

## 외부 Vercel 설정 (종결)

[구현 PR #221](https://github.com/woosung-dev/truewords-platform/pull/221)의 최초 레거시 Vercel preview는 Root Directory `admin` 미존재로 실패했고, `DEC-MONO-005` 승인으로 배포별 override(`apps/admin`)의 preview `READY`만 확인했었다. 2026-09-05 main 머지 후 Production 배포가 같은 이유로 실패한 것을 확인했고, 그동안 살아 있던 host 조건부 307 리다이렉트는 분리 전 마지막 성공 배포가 서빙하고 있었다. 같은 날 **Vercel 프로젝트 삭제**를 결정해 양 앱의 `next.config.ts` redirect 블록과 테스트를 제거했다. 이후 Vercel preview는 검증 항목이 아니다. 기록: [`docs/TODO.md` §남은 것](../TODO.md).

- 승인 경계: 이번 요청은 구현·PR까지다. 아래 원격 배포·터널 변경·계정 이전은 별도 승인을 받은 후 실행한다.

## 로컬 Compose 볼륨 보존

기존 `backend/docker-compose.yml`은 디렉터리명에서 기본 project 이름이 정해졌다. 새 `apps/api/docker-compose.yml`은 `name: backend`로 이전 기본값을 유지하지만, 사용자가 `-p`/`COMPOSE_PROJECT_NAME`을 지정했던 환경은 **실제 이름이 우선**이다.

1. 이동 전후 `docker compose ls --format json`과 `docker volume ls --filter label=com.docker.compose.project`로 기존 project·볼륨을 확인한다.
2. 대상 볼륨의 `com.docker.compose.project`, `com.docker.compose.volume` 라벨과 mount 위치를 `docker volume inspect <확인한 볼륨명>`으로 기록한다. 실제 이름을 추측해서 새 볼륨을 만들지 않는다.
3. 이전 project가 `backend`가 아니라면 새 경로에서도 `docker compose -p <확인한 project> -f apps/api/docker-compose.yml ...` 또는 같은 `COMPOSE_PROJECT_NAME`을 유지한다.
4. 기존 PostgreSQL schema head·읽기 전용 행 수, Qdrant 컬렉션 목록·exact count를 대조한다. 이 전환 때문에 DB 생성·reseed·새 Alembic revision을 실행하지 않는다.

테스트 worktree는 기존 환경과 격리한다. 아래는 **예시**이며 `.env`와 포트 사용 여부를 확인한 뒤 실행한다.

```bash
POSTGRES_PORT=55432 QDRANT_HTTP_PORT=56333 QDRANT_GRPC_PORT=56334 API_PORT=58000 \
  docker compose -p truewords-monorepo-review -f apps/api/docker-compose.yml up -d postgres qdrant
```

테스트 API의 `DATABASE_URL`·`QDRANT_URL`도 같은 격리 포트를 가리켜야 한다. `down -v`, `volume prune`, 기존 볼륨 삭제를 검증 명령으로 사용하지 않는다. 테스트 리소스 정리는 정확히 만든 project만 대상으로 하고, 데이터 삭제가 필요하면 먼저 승인받는다.

## 운영 전환 전 기록

| 보존 대상 | 기록 내용 |
|---|---|
| 이미지 | 실행 중 backend/admin 태그·이미지 ID, 보존할 rollback 태그, 새 web 태그 |
| 구성 | VM의 기존 Compose 파일, `.env`의 변수 이름과 백업 위치. 비밀 값은 PR·로그에 남기지 않음 |
| 라우팅 | 기존 Cloudflare Published application routes·Access 정책 |
| 인증·데이터 | 기존 cookie host/SameSite/Secure, 본인 기록 접근, schema head·읽기 전용 기준값 |
| 자원 | 메모리·CPU·디스크 현재값, 대표 채팅/업로드 동시 부하에서 peak |

원격 Cloudflare는 대시보드 관리형이다. 저장소의 Compose·환경 예제 변경으로 원격 hostname이 자동 갱신되지 않는다.

## 빌드와 URL 대응

| 항목 | 기존 운영 | 분리 후 제안·상태 |
|---|---|---|
| 사용자 origin | `app.<zone>` → `admin:3000` | `truewords.<zone>` → `web:3000` (canonical), `app.<zone>` 은 301 → `truewords.<zone>`. 2026-09-06 컷오버는 `app → web:3000` 으로 먼저 전환한 뒤 같은 날 canonical 을 바꿨다 |
| 관리자 origin | 같은 `app.<zone>` | `truewords-admin.<zone>` → `admin:3000`, 2026-09-06 등록·분리 admin `41a9ef2` 배포 완료 |
| API·Qdrant | `backend:8080`, `qdrant:6333` | 기존 DNS·서비스 이름 유지 |
| Next API rewrite | build 시 API 주소 고정 | `NEXT_PUBLIC_API_URL=http://backend:8080`; 런타임 env만으로 변경 불가 |
| 앱 간 이동·CORS | 단일 앱 origin | 빌드 `NEXT_PUBLIC_WEB_URL`/`NEXT_PUBLIC_ADMIN_URL`, API `WEB_FRONTEND_URL`/`ADMIN_FRONTEND_URL` 일치 |

두 Next 이미지는 저장소 루트 context로 각각 `apps/web/Dockerfile`, `apps/admin/Dockerfile`을 빌드한다. 루트 lockfile·workspace·공유 패키지를 포함하고 standalone의 실제 `apps/<app>/server.js`·static/public 경로를 확인한다. API 이미지는 `apps/api/Dockerfile`을 사용하되 운영 이름 `truewords-backend`를 유지한다.

새 web이 사용자 origin을 맡을 때 기존 `/dashboard`, `/chatbots`, `/data-sources`, `/analytics`, `/feedback`, `/audit-logs`, `/settings` 링크를 관리자 origin으로 안내하는지 확인한다. `/admin/*`는 **관리 화면이 아닌 API 호환 경로**이므로 일괄 화면 redirect로 덮어쓰지 않는다. 이전 `/api/chat*`, `/api/chatbots`, `/api/sources/*` rewrite도 보존한다.

## 이미지·SSE 검증 기록 (2026-09-05)

web/admin/API의 ARM 이미지 3개 빌드·로컬 기동과 양 웹 이미지 통합 smoke가 통과했다. **격리 fixture 환경 검증이며 운영 배포 성공은 아니다.** 최종 smoke 결과는 [실행 계획 §5](../plans/completed/2026-09-05-monorepo-migration.md#5-현재-완료-증거)에 기록한다.

격리 fixture API가 250ms 간격으로 보내는 동일 SSE를 `curl --no-buffer --compressed`로 검사한 결과다. 모두 로컬 테스트 DB만 사용했으며 실제 Gemini 호출·운영 접속은 하지 않았다.

| 경로·Accept-Encoding | 이벤트 도착 시점 | 결과 |
|---|---|---|
| 직접 API · gzip | 21 / 274 / 526 / 778ms | 압축 없이 점진 수신 |
| Docker web 프록시 · identity | 118 / 369 / 621 / 871ms | 점진 수신 |
| Docker web 프록시 · gzip | 784ms, 571바이트 한 번 | `done`까지 압축 버퍼에 모인 뒤 도착 |

원인은 Next 16.2.2의 기본 `compression()`이다. `X-Accel-Buffering: no`는 이 gzip 버퍼를 해제하지 않는다. 대응은 **API SSE 응답에 `Cache-Control: no-cache, no-transform`을 명시**하여 해당 응답만 압축 변환에서 제외하는 것이다. 전역 `compress: false`나 새로운 Route Handler는 추가하지 않는다.

설치된 Next 압축 모듈을 사용한 격리 loopback 재현에서는 `no-cache`가 286ms에 전체를 전달했고, `no-cache, no-transform`은 4/259ms에 두 번 전달했다. 이 결과는 원인·대응의 근거이며 **수정한 실제 이미지 smoke 성공을 대신하지 않는다.** 이미지 재검증 명령:

```bash
node tooling/checks/smoke-images.mjs
```

이 검사는 이미 실행 중인 로컬 web `127.0.0.1:13000`·admin `127.0.0.1:13001`과 격리 fixture API를 전제로 한다. 정적 CSS·프록시 헬스·쿠키·CSRF·이전 alias·SSE 첫 chunk/done 분리·취소를 확인한다. 서버를 자동 시작하지 않으며, 운영 URL로 바꿔 실행하지 않는다. 원격 Cloudflare 이후의 전달·실부하 검증은 별도로 남는다.

### 최초 계약 PR의 한정된 SSE 정규화

기존 API는 실제로 `text/event-stream`을 반환했지만 이전 OpenAPI의 `POST /chat/stream` 200 응답에는 `application/json`으로 표시되어 있었다. **기준 branch에 `contracts/openapi.json`이 없는 최초 전환 PR에만**, 이전 `backend` 코드에서 export한 비교 기준의 이 MIME 오기를 `text/event-stream` 문자열 스키마로 정규화한다.

이 예외는 실제 REST schema·URL·SSE 동작 변경을 허용하는 규칙이 아니다. `tooling/checks/legacy-contract.mjs`가 정확한 기존 모양을 확인하며 예상과 다르면 실패한다. 이미 계약이 있는 이후 PR에는 정규화를 적용하지 않고 기준 계약 그대로 하위 호환성을 검사한다.

## 배포 승인 후 순서

1. 새 web/admin/API 이미지를 다른 태그로 준비하고 격리 환경에서 헬스·정적 파일·로그인·SSE·기록·업로드를 검증한다. 이전 이미지는 보존한다.
2. 검증용 hostname에서 두 앱의 로그인·권한 거부·로그아웃·관리자 링크를 확인한다. 서로 다른 hostname에서 쿠키가 자동 공유된다고 가정하지 않는다.
3. VM Compose와 `.env`에 `WEB_TAG`, 기존 `ADMIN_TAG`/`BACKEND_TAG`, 확정 origin을 반영한다. **메모리 부하 검증 전 운영 배포하지 않는다.**
4. 승인한 Cloudflare 라우팅을 전환한 뒤 기존 링크와 app/admin origin을 모두 확인한다. 변경 시간과 전후 설정을 기록한다.
5. `ops-check.sh`의 web 포함 6서비스 상태를 확인하고 대표 사용자 시나리오를 재실행한다. 아래 실패 기준에 해당하면 복구한다.

`make deploy-web`/`deploy-admin`(과 rollback)은 `docker compose up -d --no-deps --wait <svc>`로 대상 컨테이너만 바꾼다. backend가 `env_file: .env`를 읽어 `WEB_TAG`/`ADMIN_TAG` sed만으로 설정 해시가 바뀌므로, `--no-deps`가 없으면 프론트 배포가 backend를 재생성해 진행 중 SSE가 끊긴다(2026-09-06 최초 deploy-web에서 실측). 반대로 `.env`의 backend 값(origin·게이트 이메일 등)을 바꿨을 때는 `make deploy-backend` 또는 `docker compose up -d --wait backend`를 명시 실행해야 반영된다.

분리 후 메모리 limit 합계는 11.5GiB(qdrant 6 + backend 3 + postgres 1 + admin 0.5 + web 0.5 + cloudflared 0.5)다. 12GiB VM에 OS·페이지 캐시 여유가 작으므로 limit 합계만으로 안전을 입증하지 않는다. 과거 단일 admin의 실사용값을 분리 후 부하 검증으로 재사용하지 않는다.

실측(2026-09-06, 다른 프로젝트 3개와 VM 공유): 전환 전 host available 6.8GB, truewords 합계 ≈1.8GiB. web 기동 후 idle 35MiB, web 경유 동시 SSE 5건(전부 200·done)에서 **web 피크 72MiB / 512MiB**, backend 피크 500MiB / 3GiB, 컷오버 후 available 7.2GB. limit 절반(256MiB) 기준을 크게 밑돈다.

## 실행 기록 (2026-09-06)

| 시각(UTC) | 단계 | 결과 |
|---|---|---|
| 23:2x | VM 기록·백업 | `.env` `BACKEND_TAG=446a4bf`·`ADMIN_TAG=30ca81f`, 5컨테이너 healthy, available 6.8GB. `docker-compose.yml.pre-split-20260906`·`.env.pre-split-20260906` 백업 |
| 23:3x | 롤백 보존·env·compose | `preserve-images.txt` = `truewords-admin:30ca81f`, `truewords-backend:446a4bf`(prune dry-run 미포함 확인). `.env` 에 `WEB_TAG=`·`WEB_FRONTEND_URL=https://app.woosung.dev`·`ADMIN_FRONTEND_URL=https://truewords-admin.woosung.dev`. 6서비스 compose 전달, `docker compose config` OK. `prune-images.sh` 를 main 버전으로 갱신 |
| 23:41 | `make deploy-backend` **e833ce9** | guarded. `/health` 200, SSE chunk·sources·done, 컨테이너 env origin 반영, fastembed 0.8.0·pillow 12.3.0·cryptography 50.0.1·starlette 1.3.1 |
| 23:46 | `make deploy-web` **dfb6916** | guarded, web healthy. 컨테이너 내부 `/login` 200·CSS 200·`/api/backend/chat/stream` 200 `no-cache, no-transform` 첫 chunk 387ms. **backend 가 함께 Recreate 됨**(env_file 해시) → [#239](https://github.com/woosung-dev/truewords-platform/pull/239) `--no-deps` |
| 00:0x | Cloudflare 등록 | `truewords-admin.woosung.dev → HTTP admin:3000`(Path 비움). DNS 자동 생성, `/login` 200(옛 통합 admin) |
| 00:27 | Cloudflare 전환 | `app.woosung.dev` Service `admin:3000 → web:3000`. 즉시 `/`·`/login`·`/history`·`/about` 200, `/dashboard` 307 → truewords-admin, `/api/backend/health` 200, SSE chunk 14·sources·done. 10분 관찰 10/10 OK. 컨테이너 재시작 없음 |
| 00:38 | `make deploy-admin` **41a9ef2** | guarded, `--no-deps`: admin 만 Recreate(backend·web `Created` 불변). `truewords-admin.woosung.dev` `/login`·`/dashboard`·`/access-denied` 200, `/` 307 → `/dashboard`, `/history` 307 → app, `/admin/auth/me` 401(미인증) |
| 00:39 | `ops-check` | **7건 OK — containers 6개 정상(5 healthy + cloudflared up)**. `deploy.log` 3줄(backend·web·admin guarded) |

롤백 자산: `truewords-admin:30ca81f`(통합 admin, `preserve-images.txt`), `truewords-backend:446a4bf`, VM `*.pre-split-20260906` 백업, Cloudflare 3행을 `admin:3000` 으로 되돌리기. 최소 2주 보존. 관리자는 새 hostname 에서 재로그인(host 별 쿠키, `domain=` 없음).

## 실패 기준과 복구

로그인 반복, 타 사용자 기록 노출, 권한 누락, API/SSE 404·중단, 정적 자산 누락, OOM/healthcheck 실패가 발생하면 신규 유입을 이전 구성으로 되돌린다. 단일 VM Compose 교체는 무중단 배포를 보장하지 않는다.

| 상황 | 복구 대상 |
|---|---|
| 분리 후 앱 업데이트 실패 | `make rollback-web TAG=<검증된 이전 태그>`, 대응 admin/backend rollback. 실제 이미지 존재를 먼저 확인 |
| **최초 분리 전환** 실패 | 아직 이전 web 이미지가 없으므로 이전 통합 admin 이미지·Compose·Cloudflare `app → admin:3000` 라우팅을 함께 복구 |
| 빌드 origin 오류 | 올바른 build-arg로 이미지 재빌드. 컨테이너 런타임 env만 바꿔 해결됐다고 판정하지 않음 |
| 쿠키/권한 문제 | 이전 cookie 범위·로그인 동작 복구. 임의로 Domain을 넓히거나 CSRF를 해제하지 않음 |
| 데이터 문제 | 구조 전환은 schema 변경이 없으므로 DB downgrade/drop을 자동 실행하지 않음. 별도 데이터 복구 승인 필요 |

`prune-images.sh`는 `truewords-web`·`truewords-admin`·`truewords-backend` 모두에서 실행 중 이미지와 지정 보존 태그가 삭제되지 않는지 dry-run으로 확인한다. 최신 N개 보존만으로 최초 전환 전의 통합 admin rollback 태그가 계속 남는다고 가정하지 않는다.

### 이전 통합 admin 이미지의 지속 보존

보존 태그는 한 번의 셸 환경변수뿐 아니라 **VM의 지속 파일**에 기록한다. `prune-images.sh`의 `PRESERVE_IMAGES_FILE` 기본값은 `${TW_DIR:-${HOME}/truewords}/preserve-images.txt`다. 보통 `/home/ubuntu/truewords/preserve-images.txt`이며 다른 사용자/설치 경로로 실행한다면 `TW_DIR` 또는 `PRESERVE_IMAGES_FILE`을 명시한다.

존재하는 보존 파일을 권한·I/O 오류로 읽지 못하면 GC는 삭제 전에 종료 코드 1로 중단한다. 빈 목록으로 계속 진행하지 않는다.

1. [preserve-images.example](../../infra/oracle-vm/preserve-images.example)을 VM의 해당 파일로 준비한다. **예제는 주석뿐이므로 복사만 해서는 보호되는 태그가 없다.**
2. 전환 직전 확인한 `truewords-admin:<실제 통합앱 태그>`를 주석 없이 한 줄에 하나씩 기록한다. 필요한 backend/web rollback 태그도 같은 형식으로 넣는다.
3. 실제 이미지가 존재하는지 확인한 뒤 `DRY_RUN=1 bash ~/truewords/prune-images.sh`로 지정 태그가 삭제 예정에 포함되지 않는지 확인한다. 실행 중 이미지·최신 보존 개수와 별도로 검사한다.
4. 원복 가능 기간이 끝나기 전까지 파일의 전환 전 태그를 제거하지 않는다. 이후 제거는 명시적인 보존 정책 결정으로 처리한다.

배포 후 자동 GC와 주간 cron은 모두 같은 파일을 읽으므로 일회성 `PRESERVE_IMAGES`가 없는 다음 실행에도 보호가 유지된다. 파일은 비밀 `.env`를 source하지 않으며 이미지 참조만 저장한다. 태그 목록만으로 이미 지워진 이미지를 복구할 수는 없으므로 최초 기록 시 존재 확인이 필수다.

## 이번 범위 밖

M5의 identity·manifest·service worker·알림과 Flutter는 미구현이다. 따라서 iPhone Web Push·스토어·서비스워커 업데이트의 성공을 이번 구조 이전 테스트로 주장하지 않는다. 미래 service worker가 설치된 뒤에는 이전 이미지만으로 worker가 제거되지 않으므로 버전 갱신·해제·개인 캐시 정리 복구 절차를 추가한다.
