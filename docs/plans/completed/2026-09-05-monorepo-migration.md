# 모노레포 전환 실행 계획

- 계획 ID: `PLAN-MONO-001`
- 상태: **M1~M4 구현·로컬 검증 완료 — PR 심사 진행** (2026-09-05)
- 기준 commit: `59e3a59`, 2026-09-05
- 설계: [ARCH-MONO-001](../../architecture/2026-09-05-pwa-flutter-monorepo.md)
- 사용자 방향: web/PWA·admin·FastAPI 분리, Flutter는 추후 독립 추가

> 후속 결정: 2026-09-05 사용자 2안 승인으로 아래 M2의 `ui-web` 선택은 [APP-UI-001 앱별 UI 소유권](../active/2026-09-05-app-owned-ui.md)으로 대체한다. 본문의 단계·검증 결과는 최초 M1~M4 실행 기록으로 보존하며 후속 변경의 검증 성공을 의미하지 않는다.

## 1. 진행 순서와 완료 기준

| 단계 | 변경 결과 | 통과해야 하는 검증 |
|---|---|---|
| M1 저장소 기반 | pnpm/Turbo, `apps/admin`, `apps/api`; 이때 admin 안에 기존 채팅 유지 | 이전 전후 동일 테스트·빌드, API schema 동등, 기존 이미지 기동 |
| M2 앱 분리 | `apps/web`, 최소 `ui-web`, web/admin 독립 실행·이미지 | 채팅·관리 화면·로그인·쿠키·리다이렉트·SSE E2E |
| M3 계약·API 내부 | OpenAPI→TS SDK, `app/core/modules` 목표 구조 | 재생성 일치·호환성·REST/SSE fixture·타입·전체 회귀 |
| M4 문서·배포 전환 준비 | 새 docs 분류, CI 범위·운영 전환·rollback runbook | 링크·경로 검사, ARM 이미지·Compose 검증, 이전 URL 호환 |
| M5 PWA 제품 확장 | 승인 PRD 기반 identity·설치/SW·알림 | 기능별 단위·통합 + 실제 iPhone/Android 검증 |

사용자가 2026-09-05 **M1~M4 구현부터 PR까지** 승인했다. M5는 일반 사용자 로그인 방식 등 제품 결정을 입력으로 하는 별도 기능 작업이며 이번 PR에 포함하지 않는다. Flutter는 도입 결정 이후 추가한다. 운영 배포·계정/데이터 이전은 이번 승인에 포함하지 않는다. 단계마다 코드와 관련 문서를 같은 변경에서 갱신한다.

`[가정]` 구현 작업량은 M1~M4 합계 개발자 5~10일, 에이전트 실행·검증 누적 1~3일로 잡는다. 현 테스트의 외부 의존성·Docker 빌드 상황을 아직 실행 검증하지 않아 범위가 넓다. 사용자 검토·운영 변경·실기기 QA 대기 시간은 별도다. M5는 로그인·알림 상세 요구 확정 후 추정한다.

## 2. 작업 단위

### M1 — 폴더 이동과 실행 기반

| 작업 | 수정 대상 | 검증 |
|---|---|---|
| `T-MONO-001` 기준선 확보 | 테스트 실행 기록·현재 라우트/schema·이미지 기동 기록 | 기존 실패를 기록해 새 회귀와 구분; 테스트 수치를 과거 문서에서 복사하지 않음 |
| `T-MONO-002` 앱 루트 이동 | `admin/`→`apps/admin/`, `backend/`→`apps/api/`, 루트 pnpm/Turbo/ignore | API는 `main:app`, `src.*`를 유지한 상태에서 install·test·build 통과 |
| `T-MONO-003` 경로 소비자 수정 | Makefile·CI 2개·Docker·Playwright·pyright·scripts·환경 예제·AGENTS | active 코드/config의 옛 경로 잔존 검사, `.env` 값 노출·복제 없음 |

기존 pnpm 8.15.9를 출발점으로 루트 lockfile을 생성하고 기존 의존성 해석 변화가 있는지 검토한다. Node 22·Next 16.2.2·React 19.2.4를 전환 중 함께 업그레이드하지 않는다. uv.lock은 `apps/api/`에 유지하고 Python 환경은 uv로 설치한다. `.venv`·node_modules·빌드 캐시는 소스와 함께 이동하지 않고 필요 시 재생성한다.

`T-MONO-002`에는 로컬 Compose 리소스 보존도 포함한다. 기존 Compose project·Postgres/Qdrant 볼륨의 실제 이름을 조회하고 이전 후 동일 리소스와 데이터에 연결되는지 검증한다. project 이름을 새로 추측하거나 기존 볼륨을 삭제하지 않는다. 기존 개발 환경과 테스트 worktree는 project·포트를 구분한다.

`T-MONO-003`에서 루트 lockfile·workspace·공통 설정 변경 감지를 바로 연결한다. 루트 lockfile을 사용하는 시점에 기존 admin Docker 빌드의 context·COPY도 함께 갱신한다. M1 자체가 새 위치에서 빌드 가능한 상태로 끝나야 한다.

### M2 — web/admin 추출

| 현재 파일/책임 | 목표 소유자 | 주의점 |
|---|---|---|
| `src/app/(chat)`, `about`, 채팅 전용 컴포넌트·상태 | `apps/web` | `/`, `/history`, `/about`, 출처 보기·피드백·스트림 중단 보존 |
| `(dashboard)`, 관리용 `features`, 데이터 업로드 | `apps/admin` | `/dashboard`, `/chatbots`, `/data-sources`, `/analytics`, `/settings`, 감사·피드백 화면 보존 |
| 로그인·AuthGuard | 앱별 인증 UX | 추출 단계에는 기존 데모 인증 호환, 일반 사용자 인증으로 오인 금지 |
| 양쪽 사용 기본 UI | `packages/ui-web` | 앱 import 없음, Tailwind/테마/portal 검증 |
| 테스트·static assets·폰트·design-system | 실제 소비 앱 또는 공유 UI | 무조건 복제하지 않고 사용처 기준으로 배치 |

`T-MONO-004`: web 3000, admin 3001, API 8000의 로컬 주소를 제안한다. 로컬 쿠키는 포트별로 분리되지 않으므로 이름 충돌과 별도 hostname 기반 E2E도 고려한다. 운영 origin은 별도 확정한다.

`T-MONO-005`: 각 앱의 루트 진입·로그인 후 목적지·권한 거부 목적지·사용자 화면 링크를 명시한다. admin의 비관리자 거부가 다시 같은 `/`로 돌아가 반복되지 않아야 한다. 앱 간 이동에만 명시적인 web/admin origin을 사용하고 복귀 URL은 허용된 경로로 제한한다.

`T-MONO-006`: Next standalone 이미지 2개를 root context로 빌드한다. 공유 패키지·정적 자산·폰트 포함과 실제 entrypoint를 검사한다. 기존 rewrite의 내부 backend 주소가 build 시 고정된다는 점을 환경 명세에 남긴다.

M2의 같은 PR에서 web/ui-web의 경로 감지·검사 job과 `tests/e2e`의 두 앱+API 실행 설정을 연결한다. web 단독 변경, 공유 UI 단독 변경이 필요한 검사를 실제로 실행하는지 확인한다.

### M3 — 계약과 API 내부 구조

| 작업 | 변경 | 검증 |
|---|---|---|
| `T-MONO-007` 계약 export | 무외부접속 export, OpenAPI 원본 및 fixture, 생성기 버전 고정 | 같은 입력으로 2회 생성 결과 동일, 중복 operationId 없음 |
| `T-MONO-008` 소비자 전환 | TS 생성 DTO/SDK + transport, 앱별 로그인/오류 UX | REST·multipart·401/403·204·422·500·비JSON·취소 소비자 테스트 |
| `T-MONO-009` 스트림 계약 | 실제 SSE 이벤트 모델·fixture·어댑터 | UTF-8/CRLF·조각·완료·오류·중단, 프록시를 거친 점진 수신 |
| `T-MONO-010` API 내부 경로 | main→app/main, src 도메인→app/modules, 공용 기반→app/core | URL/schema 동등, Alembic import·이력 head·script 데이터 경로, 전체 pytest |

SDK 전환을 기능별로 수행하되 최종 완료 시 사용하는 API DTO의 중복 수기 정의를 제거한다. 화면 전용 모델은 남길 수 있다. 아직 명세화되지 않은 응답은 `any`로 통과시키지 않고 해당 서버 스키마를 먼저 보완한다. 호환 alias는 구버전 소비자가 없어졌다는 증거가 있을 때 제거한다.

`T-MONO-008`은 기존 `credentials: include`와 POST/PUT/PATCH/DELETE의 `X-Requested-With: XMLHttpRequest`를 보존한다. SDK로 관리자 생성·수정·삭제가 성공하고 헤더 누락은 기존대로 403인지 검증한다. multipart에서는 JSON Content-Type을 강제하지 않는다.

M3에서 계약/SDK/codegen 변경 감지와 재생성·호환성·소비자 검사를 즉시 CI에 추가한다. API schema만 바뀐 PR, SDK만 바뀐 PR, 생성기 설정만 바뀐 PR 각각의 검사 실행을 확인한다.

### M4 — 문서·CI·운영 준비

`T-MONO-011`: 문서별 이전 manifest를 만들고 기존 문서 전부를 새 분류 또는 명시적 보존 경로에 대응한다. 안정 ID·그림·첨부·HTML 내부 링크·AGENTS 참조를 검증한다. 최신 경로를 가리키는 개발 가이드와 과거 실행을 설명하는 기록을 구분한다. 완료된 계획은 검증 기록을 첨부한 뒤 `plans/completed`로 옮긴다. 현재 docs/README의 기존 누락 링크 3개(03-vector-db-comparison, 04-gemini-file-search-analysis, 10-vibe-coding-and-pinecone-vs-qdrant)는 원본 확인 후 이전 manifest에서 처리하며, 이번 초안에서는 변경하지 않았다.

`T-MONO-012`: M1~M3에서 추가한 검사를 최종 CI 구조로 정리한다. ci.yml이 PR마다 실행되고 web/admin/API/계약 reusable workflow를 필요한 경우 호출하게 한다. 공통 lockfile·설정·tooling·CI 변경도 감지한다. 필수 검사 실패·취소·합법적 skip 각각을 최종 집계 job에서 검증한다. 루트 package scripts의 기본 웹 개발이 uv/Flutter 설치를 요구하지 않도록 필터를 둔다.

`T-MONO-013`: web 이미지·WEB_TAG·deploy-web/rollback-web, API/admin 기존 운영 명령의 새 경로, web 헬스체크·메모리, Cloudflare 변경 및 복구 표를 작성한다. `.github/workflows/cache-cleanup.yml`의 working-directory와 운영 스크립트도 갱신한다. 기존 `backend` 서비스 DNS·이미지 태그 방식은 유지한다.

특히 `infra/oracle-vm/ops-check.sh`의 서비스 목록·정상 개수와 `prune-images.sh`의 `REPOS`에 web을 반영한다. 검증 환경에서 web 중단 시 운영 점검이 실패하는지, web 이미지 GC dry-run이 실행 중·보존 대상 롤백 태그를 남기는지 확인한다. 실제 이미지 삭제는 구조 설계 검토의 검증 명령으로 실행하지 않는다.

### M5 — 승인 PRD 기반 기능 작업

| 작업 | 선행 조건 | 완료 증거 |
|---|---|---|
| `T-MONO-014` identity | 로그인 방식·계정/기록 이전 정책 확정 | 사용자/관리자 권한 격리, 세션 철회·다른 사용자 데이터 접근 거부 |
| `T-MONO-015` PWA 셸 | 확정 web origin·브랜드/아이콘·기능 범위 | manifest·SW 업데이트·개인 API 캐시 제외·오프라인 안내 |
| `T-MONO-016` 알림 | 대상·동의·읽음·발송 주기 정책 | 영속 알림함·다중 구독·로그아웃·만료·재시도·중복·클릭 권한 재검증 |
| `T-MONO-017` 실기기 | HTTPS 테스트 환경·iPhone/Android 기기·push 설정 | 설치→권한→백그라운드 수신→클릭→로그인 복귀 기록, 거부/해제·업데이트 기록 |

## 3. 검증 지도

`기존` 표시는 해당 테스트 파일을 확인했다는 뜻이며 이번 세션의 실행 통과를 뜻하지 않는다. `추가`는 구현 단계에서 필요한 검증이다.

```text
소스 이전
 ├─ [기존] backend/tests 전체 → Python import·업무 규칙 회귀
 ├─ [기존] admin/src/test → UI·auth-guard·sse·원문 모달
 └─ [추가] 같은 API schema + 3개 이미지 smoke + Alembic/JSON 경로

사용자 web → 같은 origin 프록시 → FastAPI
 ├─ [기존+추가 E2E] 로그인 → 채팅 → 출처 → 내 기록 → 로그아웃
 ├─ [추가 E2E] 다른 사용자의 기록·관리자 API 접근 거부
 └─ [추가 E2E] SSE 점진 수신 → 네트워크 중단/취소 → 부분 답변 처리

관리자 admin → 같은 origin 프록시 → FastAPI
 ├─ [기존+추가 E2E] 관리자 로그인 → 데이터/챗봇 관리 → 로그아웃
 └─ [추가 E2E] 비관리자·구쿠키·세션 만료·복귀 URL

API 모델 → OpenAPI → 생성 SDK → web/admin
 ├─ [추가] 재생성 일치 + PR base 대비 호환성
 └─ [추가] null/누락·enum·오류·업로드·REST/SSE fixture

PWA/알림 (M5)
 ├─ [추가 실기기] 설치·권한·백그라운드 push·클릭·로그인 복귀
 └─ [추가 통합] 거부/해제·로그아웃·계정 변경·만료·재시도·SW 업데이트
```

분리 전 기준선 명령은 현재 루트 Makefile 및 CI와 맞춘다: `make ci`, `make admin-type`, `make admin-lint`, `make admin-e2e`. `make ci`는 전체 pytest를 실행하지만 `make backend-test`는 일부 테스트를 제외하므로 전체 검증의 대체 명령으로 쓰지 않는다. E2E의 live DB/외부 API 의존성을 먼저 확인하고 격리된 테스트 설정에서 실행한다.

### 주요 실패 모드

| 실패 | 사용자에게 보이는 결과 | 검증·처리 계획 |
|---|---|---|
| 프록시 경로·쿠키 범위 오류 | 로그인 반복, 기록 누락, 404 | 양 origin 로그인/로그아웃·기록 E2E, alias/Set-Cookie 검사 |
| 공유 패키지·정적 파일 이미지 누락 | 실행 시 import 오류, CSS/아이콘 404 | standalone 실제 이미지 smoke, 화면·정적 자산 확인 |
| OpenAPI만 생성하고 SSE 누락 | 답변이 끝까지 나오지 않거나 완료 오인 | raw SSE fixture + 프록시 통합 + 중도 종료 UX |
| SW 구버전·개인 응답 캐시 | 새 버전 미반영, 계정 변경 후 이전 데이터 노출 | 버전 전환·다중 탭·cache storage·로그아웃 검증 |
| 발송 실행기 재시작·만료 구독 | 누락·중복 알림 | 영속 작업 claim·idempotency·TTL·404/410 비활성화, 서버 알림함 |

## 4. 브랜치·배포·복구 순서

승인한 설계를 `dev/monorepo-pwa-flutter` 통합 브랜치의 기준선으로 기록하고, 별도 `tw-monorepo-pwa-flutter` worktree에서 구현한다. sub-task PR의 base는 통합 브랜치, 최종 main PR은 수동 검증한다. PR까지 진행하는 데 필요한 커밋·푸시는 이번 사용자 요청에 포함되지만 main merge·운영 배포는 별도 승인 대상이다.

| 작업 | 의존성 | 실행 방식 |
|---|---|---|
| M1 | 기준선 | 경로 변경이 전역에 영향을 주므로 순차 |
| M2, M3 | M1 | M2 후 M3 기본 순차. SDK·CI 공유 경로 때문에 동시 대량 편집을 피함 |
| M4 | M2, M3 | 최종 코드 경로가 확정된 뒤 문서 manifest/링크 및 운영 검증 |
| M5 | 제품 결정 + M2~M4 | identity→구독/알림, PWA 셸은 인증과의 연결 경계를 고정한 뒤 독립 작업 가능 |

운영 전환은 다음 순서로 실행한다.

1. 이전 이미지 태그·Compose·터널 라우팅·쿠키 설정을 기록하고 새 이미지들을 별도 태그로 준비한다.
2. web/admin을 전환 전 검증용 origin에서 점검한다. DB를 재생성하거나 기존 볼륨을 삭제하지 않는다.
3. 기존 app origin은 web으로, 관리자 hostname은 admin으로 연결한다. 기존 관리 URL redirect를 확인한다(Vercel legacy redirect는 2026-09-05 프로젝트 삭제 결정으로 제외).
4. 로그인·채팅 스트림·기록·업로드·알림/SW를 해당 배포 범위에 맞춰 검증한다.
5. 실패하면 이전 라우팅·Compose·이미지를 복구한다. 이미 설치된 SW는 이전 이미지 롤백만으로 제거되지 않으므로 별도 갱신/해제 절차를 적용한다.

위 명령 실행은 이 문서 작성에 포함되지 않는다. 폴더 이전으로 DB migration을 추가하지 않으며, identity/notifications의 스키마 변경은 별도 검토·적용·rollback 정책을 가진다. 단일 VM의 Compose 교체를 무중단으로 보장하지 않는다.

## 5. 현재 완료 증거

| 항목 | 상태 |
|---|---|
| 앱·API·인증·SSE·CI·Makefile·Oracle 구성의 정적 조사 | 완료, 기준 `59e3a59` |
| 별도 S1 PRD 상태 확인 | 완료, `3123cfe`, 사용자 검토 대기 |
| 공식 Next.js/Turbo/FastAPI/WebKit/Dart/Flutter 자료 확인 | 완료, 출처는 설계 문서 각 절에 기재 |
| 수정 문서의 새 링크·공백·코드펜스 검사 | 통과, 기존 색인 누락 링크 3건은 기준선으로 구분 |
| 사용자 M1~M4 구현·검증·PR 범위 승인 | 완료, 2026-09-05. M5·Flutter·운영 배포 제외 |
| 문서별 이전 manifest | 승인 문서 포함 210개 중 200개 이동·10개 유지. 완료 계획의 이동 포함. 이전 SHA-256·분류 이유·누락 원본 3건 명시 |
| 분리 전 기준선 | 실제 전체 pytest 964 passed / 4 skipped / 1 xfailed, Vitest 113 passed, 기존 Next 빌드·typecheck 통과. 기존 lint 오류와 E2E selector 문제는 이전 회귀와 분리해 확인 |
| 최종 API 회귀 | `GEMINI_API_KEY=test-placeholder EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest -q`: **971 passed / 4 skipped / 1 xfailed**, 35.04초. dummy 키와 짧은 테스트 배치 대기 사용; 실제 LLM 품질 평가는 아님 |
| 최종 JS/TS 회귀 | admin **76**, web **63**, SDK **13**: Vitest **152 passed**. 앱·공유 UI·SDK typecheck 통과. lint 오류 0, 기존 web hook 경고 1은 `QUALITY-MONO-001` 추적 |
| 전체 브라우저 E2E | 격리 Postgres/Qdrant + 외부 LLM 대신 지연 SSE fixture: **34/34 passed**, retries=0, 48.3초. 관리자 23 + web 6 + split 5. 로그인·CRUD·별도 hostname 쿠키·기록 소유권·점진 스트림·취소·done 누락 UX 검증 |
| 계약·소비자 | OpenAPI/SDK 재생성 byte 일치. oasdiff v1.30.0 고정 이미지로 기준 API 대비 breaking 0. 최초 기준 문서의 SSE MIME 오기만 정규화하는 예외를 runbook에 기록. enum 응답을 불필요하게 좁히지 않음 |
| ARM 이미지·실제 기동 | web/admin/API 모두 `linux/arm64` 빌드·비루트 기동 통과. 양 웹 `/login`·CSS·canonical/legacy API·Set-Cookie·CSRF 403/허용 후 body 422·로그아웃 확인. API `/health` 200, 런타임 말씀 JSON 20개 로드 |
| 프록시 스트리밍 | gzip 요청에서 done까지 버퍼링 재현 → SSE `no-cache, no-transform`으로 수정. 최종 이미지 smoke 도착 **13/264/516/768ms**, 사용자 취소 `AbortError`. 일반 페이지 압축 유지 |
| DB·운영 설정 | 격리 tmpfs DB에서 기존 Alembic 24개 적용, head `a1c9e7d0b2f3` 유지. 새 migration 없음. 기존 로컬 Compose project `backend`·볼륨 이름 유지. 운영 Compose는 예제 env + `--no-env-resolution --quiet` 정적 검증, 실제 운영 env·볼륨 접근 없음 |
| CI·문서·경계 | tooling **13/13**(필수 검사 실패/취소/skip, import 경계, web health, GC 보존/읽기 실패 포함), 신규 workflow actionlint, docs 링크·공백 검사 통과. CI 원격 결과는 PR checks에서 최종 확인 |
| 원격 GitHub CI | `ef22e0e`의 [run 33951365380](https://github.com/woosung-dev/truewords-platform/actions/runs/33951365380) **8개 job 전부 success**(2026-09-05). API·양 앱·계약·E2E·저장소·변경 감지·CI Required 포함. Vercel 외부 preview는 별도 실패이며 `DEC-MONO-005`로 추적. 후속 commit 상태는 PR Checks가 기준 |
| 독립 구현 리뷰 | 계획 완료·테스트 범위, API/보안, 프론트 성능/유지보수, red-team 검토. 확인한 캐시 입력·API 테스트 캐시·GC 보존/읽기 실패·legacy Vercel fallback은 수정 후 회귀 검증. 기존 쓰기 소유권 결함은 `SEC-MONO-001`로 분리 |
| 운영 배포·계정/데이터 이전·PWA 실기기 푸시 | 미실행 |

M1~M4의 T-MONO-001~013 구현·로컬 검증을 완료했다. PR 생성·CI·최종 main 리뷰는 GitHub에서 추적하며 main merge와 운영 배포는 하지 않는다. 문서 이전은 [manifest](../../architecture/2026-09-05-document-migration-manifest.json), 운영 준비는 [runbook](../../runbooks/monorepo-migration-and-rollback.md)으로 추적한다. 실기기·운영 성공으로 확대 해석하지 않는다.

검증 중 발견한 환경 실패도 보존한다. 초기 E2E는 테스트 API 프로세스 종료·Next 개발 origin 허용 누락으로 중단됐고 설정 후 통과했다. 이미지 빌드와 동시 실행한 전체 E2E는 Chromium context 종료로 33/34였으며, 빌드 종료 후 같은 소스·재시도 0으로 전체 34/34를 확인했다. 삭제 시나리오의 기존 숨겨진 key selector는 실제 표시 셀로 수정했다. 이 기록을 운영 브라우저 장애나 새 업무 규칙 변경으로 해석하지 않는다.

## GSTACK REVIEW REPORT

| Review | Runs | Status | Findings |
|---|---|---|---|
| plan-eng-review 기준 정적 검토 | 1 | 초안 검토, 사용자 결정 대기 | 기존 코드 재사용·인증/계약·검증 지도·배포/메모리 검토 |
| 독립 에이전트 검토 | 1 | 4건 확인, 초안 보완 | Compose 볼륨 식별, 단계별 CI, CSRF 헤더, web 운영 점검·이미지 보존 |
| 실행 검증 | 0 | 미실행 | 코드 이전·테스트·실기기·운영 성공 판정 아님 |

독립 검토의 4건은 현재 코드에서 재확인하여 제안 계획을 구체화했다. 현재 코드 자체를 수정한 것이 아니며, 대화형 단계별 사용자 승인이나 다른 모델의 교차 검토를 완료한 것으로 표시하지 않는다.

위 리뷰 표는 **사용자 승인 전 정적 설계 검토 기록**이다. `DEC-MONO-001`은 2026-09-05 M1~M4 구현·검증·PR 요청으로 해소되었으며 실행 검증은 §5에 별도 누적한다.

VERDICT: VERIFIED — M1~M4 구현·로컬 검증 완료. PR 심사·main 병합·운영 전환은 별도 상태.

**UNRESOLVED DECISIONS:**
- `DEC-MONO-002` 운영 origin과 기존 링크 전환
- `DEC-MONO-003` 일반 사용자 로그인·기존 계정/기록 이전 정책
- `DEC-MONO-004` Flutter 착수 시점
- ~~`DEC-MONO-005`~~ [구현 PR #221](https://github.com/woosung-dev/truewords-platform/pull/221)의 Vercel 외부 Root Directory `admin` 전환 — 당시 preview 실패를 확인하고 보류했던 항목. 2026-09-05 main 머지 후 Production 배포 실패를 확인해 **Vercel 프로젝트 삭제**로 종결(`docs/TODO.md`).
