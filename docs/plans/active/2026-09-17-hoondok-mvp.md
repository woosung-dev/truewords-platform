# PLAN-HD-001 — 훈독 MVP Phase 1~4 실행 계획

- 상태: 2026-09-16 사용자 승인. 착수 전 결정 12개는 **전부 추천 기본값**으로 확정했다(§1). 구현은 Phase 1 부터 통합 브랜치 `dev/hoondok-mvp` 에서 sub-PR 로 진행한다.
- 기준: main `1c41e0f`(PR #270). 입력은 [PRD v2 `PRD-FFWPU-PWA-001`](../../prd/17-ffwpu-pwa-prd.md), [디자인 시스템 `DES-PWA-003`](../../specs/web/hoondok-design-system.md), [프로토타입 `hoondok-ds`](../../prd/prototypes/hoondok-ds/README.md)(값의 원본), [모노레포 설계 `ARCH-MONO-001`](../../architecture/2026-09-05-pwa-flutter-monorepo.md).
- 목표: "아침 3분 훈독 완료" 루프 하나를 `apps/web` + `apps/api` 위에 세운다. 되돌리기 어려운 값(URL·스코프·계정 방식·시간대·플래그)은 이 문서 한 장으로 고정한다.
- 원칙: 코드가 곧 스펙. 스크린샷·비교 문서·중간 산출물은 커밋하지 않는다. 결정은 이 문서 §8 과 각 스펙의 결정 표에 1~2줄로만 남긴다.
- 표기: 라벨 없는 문장은 확인된 사실·확정 결정이다. `[가정]`은 검증이 필요한 추론, `[확인 필요]`는 사용자·외부 결정이 필요한 항목이다.

## 1. 확정값 12개

| # | 결정 | 확정값 | 근거·영향 |
|---|---|---|---|
| 1 | PRD v2·DES-PWA-003 승인 | **현 문서 그대로 승인.** 모순은 2026-09-16 정정 주석으로 개정(§1.1) | PRD·DES 상태 줄, `docs/TODO.md` |
| 2 | URL·설치 범위 | **`/hoondok/*`**, manifest `start_url`·`scope` = `/hoondok/` (Phase 3) → **2026-09-19 정정 `/hoondok`**(슬래시 없음, §10) | 시연 챗 `/`·`/login` healthcheck·E2E 불변 |
| 3 | 레이아웃 격리 | **단일 루트 + `[data-app="hoondok"]` 스코프 래퍼.** 폰트·React Query Provider 는 루트 layout 공유 | `globals.css`·`:root`·`/design-system` 무변경 |
| 4 | 일반 사용자 로그인(`DEC-MONO-003`) | **이메일 + 비밀번호.** 비밀번호 재설정은 베타 기간 운영자 수동. 메일 제공자는 Phase 2 전 별도 결정 `[확인 필요]` | `users` 테이블, 쿠키 `hoondok_token`, JWT `aud="hoondok"` |
| 5 | 오늘 말씀 편성(AC-016-05) | **운영자 1명이 N일분 수기 입력.** 없으면 AC-016-04 상태 표시(대체 생성 없음). 출처 미확인 항목은 `review_status=unverified` 로 허용 | `daily_readings`, `GET /hoondok/today` |
| 6 | `featured_malssum.json` 20건 | **로컬·E2E 시드 한정.** 운영 편성 데이터로 승격 금지 | `scripts/seed_daily_readings.py`, LICENSE 미결 |
| 7 | 아이콘·폰트 | **Phosphor → lucide-react 치환**, Pretendard self-host 는 Phase 3 SW 전 | `apps/web` 의존성 추가 없음 |
| 8 | S4 범위 축소 | **3테이블 · 5 API · 화면 4개**(§2) | 원래 S4 도메인 5종(정성·챌린지·관계·설교)은 비범위 |
| 9 | 기준 시간대 | **KST 고정**(`Asia/Seoul`). `users.timezone` 컬럼만 예약 | 연속일·"오늘" 판정을 서버가 계산 |
| 10 | 기능 플래그 | **`NEXT_PUBLIC_HOONDOK_ENABLED`**, OFF(기본) 시 `/hoondok/*` 404. 운영 이미지 기본 OFF | `turbo.json`·Dockerfile·Makefile·Playwright 배선 |
| 11 | 약관·처리방침·법적 주체(`DEC-PWA-001`) | 기본값 없음 **`[확인 필요]`**. Phase 2 계정 수집 전 필수 | `users.consent_version` 예약 |
| 12 | 히어로 사진(`DES-PWA-003-Q2`) | **베타는 텍스트 카드.** 사진 소스 확정 전 사진 히어로 없음 | SCR-PWA-002 |

### 1.1 문서 모순 정정 (2026-09-16 개정 주석)

| 문서 | 위치 | 정정 |
|---|---|---|
| PRD | §2.1 AI 질문 행, F2 화면 흐름·초원 대비 | 3탭 + FAB → 묻기 홈("물음 한 장") + 앱바 "기록" 분리 (`DES-PWA-003` §8 2026-09-16) |
| PRD | §12 `DEC-PWA-017` 오타, §13 상태 줄 | 오타 정정, "검토 대기" → 승인 |
| DES | §2.8 반응형, §4 표·§4.1·§5 대응표 1280px 열 | 좌측 레일 기본 → **상단 헤더 4(검색 중심)** 기본, 레일은 `?nav=rail` 비기본 |
| DES | §5 005 행, §4.4 예외 2 | FAB·3탭 → 묻기 홈 |
| ARCH-MONO-001 | §1 "기존 PWA 기획과의 관계", §8 `[제안]` hostname | main 병합 PRD v2·DES 링크로 교체, `app.woosung.dev` 는 폐지 확정 |
| TODO | 세션 1'·2' 승인 항목, S4 항목 | 승인 체크, S4 산출물 = 이 문서 |

## 2. 범위

### 2.1 테이블 3 · API 5 · 화면 4

| 종류 | ID | 항목 | Phase |
|---|---|---|---|
| 테이블 | `ENT-HD-002` | `daily_readings` 오늘 말씀 편성 | 1 |
| 테이블 | `ENT-HD-001` | `users` 일반 사용자 | 2 |
| 테이블 | `ENT-HD-003` | `mission_logs` 미션 완료 기록 | 2 |
| API | `API-HD-001` | `GET /hoondok/today` | 1 |
| API | `API-HD-002` | `POST /hoondok/auth/signup` | 2 |
| API | `API-HD-003` | `POST /hoondok/auth/login` (+ `logout`, `GET /hoondok/auth/me`) | 2 |
| API | `API-HD-004` | `GET /hoondok/me/summary` | 2 |
| API | `API-HD-005` | `POST /hoondok/missions/{kind}/complete` | 2 |
| 화면 | `SCR-PWA-002` | 오늘 훈독(홈) — 비로그인 읽기 | 1 |
| 화면 | `SCR-PWA-003` | 훈독하기 — 비로그인 읽기 | 1 |
| 화면 | `SCR-PWA-001` | 온보딩 최소형(베타 고지·가입·로그인, 교회 선택 제외) | 2 |
| 화면 | `SCR-PWA-015` | 설치 안내(알림 부분 제외) | 3 |

상세는 [도메인 명세](../../specs/domain/hoondok-entities.md)와 [API 명세](../../specs/api/hoondok-api.md).

### 2.2 컴포넌트 6종 (Phase 1)

미션 카드 · 말씀 카드 · 권위 층 배지 · 앱 셸(헤더 + 탭바) · 요일 스트립 · 버튼. 규격은 `DES-PWA-003` §2, 값은 `hoondok.css`. 탭 정의는 단일 목록 하나에서 하단 탭바(<1024px)와 상단 헤더 4(≥1024px) 두 형태로 렌더한다. 홈의 미션 3장은 모두 렌더하되 Phase 1 에서 동작하는 것은 훈독하기 하나이며, 기도·읽기는 "준비 중" 라벨 + 비활성이다.

### 2.3 비범위 (이번 MVP 8주)

- 16화면·컴포넌트 23종 일괄 포팅. 프로토타입 `app.html` 이 정본이며 화면은 루프에 필요한 만큼만 옮긴다.
- `hoondok.css` 토큰을 `:root` 에 싣기, `globals.css`·`/design-system` 수정(`DES-PWA-003` §7.2, `UI-WEB-001`).
- 훈독 `/` 승격, `(chat)` AuthGuard·`/login` healthcheck 변경.
- AdminUser·`admin_token`·`get_optional_user_id` 를 훈독 로그인에 재사용. 데모 관리자 계정의 일반 사용자 전환.
- 권리 원장·Qdrant payload 확장·417,579 포인트 백필·읽기 코퍼스 재적재.
- F2 AI 질문을 시연 챗 재사용으로 넣기(무기억 모드·근거 게이트·`search_events` 원문 분기·Gemini 한도 선행 필요). F3~F6 동일.
- SW `/` scope 등록, `/api/backend/*` 캐시, 킬스위치 없는 SW 배포. 알림·SW 는 Phase 3 이후.
- 푸시 스케줄러의 GHA cron 배치(청구 차단 이력). REQ-PWA-015 이벤트 12종 파이프라인·외부 분석 도구.
- 쉬어가기·아동 계정·소속 교회 선택·판본 나란히·TTS·용어 칩. Flutter·`apps/mobile`.
- `contracts/openapi.json`·생성 SDK 직접 편집. 기존 `/chat/stream` SSE 스키마 변경.

## 3. additive-only 마이그레이션 규칙

`rollback-backend` 는 이미지만 되돌리고 스키마는 되돌리지 않는다. 따라서 훈독 마이그레이션은 모두 다음을 지킨다.

1. 신규 테이블·신규 nullable 컬럼·신규 인덱스 **추가만** 한다. 기존 컬럼의 타입 변경·삭제·NOT NULL 승격·rename 금지.
2. 새 컬럼에 NOT NULL 이 필요하면 `server_default` 를 함께 둔다.
3. Postgres ENUM 타입을 만들지 않는다. 상태값은 `varchar` + 앱 검증(enum 마이그레이션 함정 회피).
4. 배포 전 체크: 새 스키마가 적용된 DB 위에서 **직전 main 백엔드 이미지가 기동**하는지 1회 확인하고 결과를 §7 에 기록한다.
5. 시드 스크립트는 운영에서 실행하지 않는다(결정 6).

## 4. Phase 1 — 경계 고정 + 홈/훈독하기 비로그인 읽기 (9/16~9/30)

통합 브랜치 `dev/hoondok-mvp`(worktree `../tw-hoondok-mvp/`, [runbook](../../runbooks/integration-branch-workflow.md)). 이 계획 문서는 docs-only PR 로 main 에 먼저 넣는다.

| sub-PR | 내용 | 완료 기준 |
|---|---|---|
| 1 `feat/hoondok-web-skeleton` | `src/app/(hoondok)/hoondok/{layout,page,read/page}.tsx`(AuthGuard 미적용, 플래그 OFF 404, noindex 메타 + `X-Robots-Tag`), `src/app/hoondok.css` 토큰을 `[data-app="hoondok"]` 스코프로 이식(`.dark` 아래서도 라이트 재선언), 컴포넌트 6종, 플래그 배선 5곳, `apps/web/AGENTS.md` 라우트 추가 | `tooling/checks/hoondok-css.mjs`(`:root` 0 · 브레이크포인트 ⊆ {768,1024,1224} · `#d4562e` 0 · 하드코딩 hex 0) 통과, Playwright `hoondok-chromium`(390/1280 가로 넘침 0 · 콘솔 오류 0 · `/design-system` `--accent` 불변 · noindex) 통과, 기존 `web-chromium` 유지 |
| 2 `fix/chat-session-ownership` | `SEC-MONO-001`: `session.py` 재사용 경로에서 `existing.user_id != ctx.user_id` 면 **403 거부**. 익명↔익명 재사용 허용, 미존재 id 는 기존대로 새 세션 | 회귀 테스트 4건(타 사용자·로그인→익명·익명→익명 허용·소유자 허용) + 라우터 403 1건, pytest 기준선 유지 |
| 3 `feat/hoondok-today-api` (sub-PR 1 tip 에서 스택) | `apps/api/app/modules/hoondok/`(`daily_readings` 모델·alembic·`GET /hoondok/today`), `core/common/clock.py today_kst()`, 시드 스크립트(`make e2e` 시드 단계), `pnpm contracts:generate` 산출물, web `features/hoondok/api.ts` + 홈·훈독하기 결합 | 시드 후 `/hoondok/read` 에 출처 줄(메타 6항목)·권위 배지 표시, 없으면 AC-016-04 상태. pytest(repository·KST 경계·라우터 3상태), Vitest 3상태, E2E 1건 |

Phase 1 완료 기준: `/hoondok`·`/hoondok/read` 가 오늘 말씀을 표시하고 없으면 AC-016-04 상태. `make ci` 통과, 기존 E2E 와 `/`→`/login` 단언 유지, 플래그 OFF 시 404. 60대 사용자 3명 200% 확대 실사용 확인(`DES-PWA-003` §7.3)은 결과를 §7 에 기록한다 `[가정: 섭외는 사용자 담당]`.

## 5. Phase 2 — identity + 완료 기록·연속일 (10/1~10/14)

통합 브랜치 `dev/hoondok-phase2`(worktree `../tw-hoondok-phase2/`, main `9940b82` 에서 분기). Phase 1 의 `dev/hoondok-mvp` 는 PR #276 으로 main 에 머지됐고 재사용하지 않는다. sub-PR 은 A→B→C→D 순으로 **스택**한다(B 는 A 의 `get_current_user`, C 는 B 의 생성 SDK 타입에 의존). 선행 PR 이 squash 머지되면 다음 브랜치를 `git rebase --onto dev/hoondok-phase2 <선행 tip>` 으로 옮긴 뒤 ready 로 전환해 3-way 충돌을 피한다. 열린 sub-PR 은 항상 1개다.

`[확인 필요]` 3건(메일 제공자·약관 문구와 법적 주체·편성자)은 착수 시점에 미정이라 기본값으로 진행한다: 비밀번호 재설정은 베타 기간 운영자 수동, 약관·동의는 수집하지 않고 베타 고지만 표시(`consented_at`·`consent_version` 은 NULL 예약), 편성은 시드·CSV. 세 항목은 `docs/TODO.md` Questions 에 그대로 남긴다.

| sub-PR | 내용 | 완료 기준 |
|---|---|---|
| 0 `docs/hoondok-phase2-plan` | 이 §5 표 + §10 결정 4건 | docs-only, `node tooling/checks/docs-links.mjs` |
| A `feat/hoondok-identity` | `apps/api/app/modules/identity/`(`users` ENT-HD-001 alembic additive-only, `POST /hoondok/auth/signup`·`login`·`logout`·`GET me`, 쿠키 `hoondok_token`, JWT `aud="hoondok"` 7일, `get_current_user`/`get_optional_user`, 자체 `verify_csrf`). `admin/auth.py` 의 bcrypt·JWT 유틸에 `expires_minutes`·`audience` 선택 인자만 추가(기본값 불변). `chat/dependencies.py`·`admin_token` 미사용. `pnpm contracts:generate` 산출물, API-HD-002/003·ENT-HD-001 `[가정]` 확정 | pytest: 소문자 정규화·중복 409·불일치/삭제 계정 401·`aud` 없는(admin 형식) 토큰 → 401·훈독 토큰 → `get_current_admin` 401·signup→me→logout→me 쿠키 흐름·CSRF 403. `contracts:check` 하위 호환 |
| B `feat/hoondok-missions` (A 스택) | `mission_logs` ENT-HD-003(unique user·date·kind) + `POST /hoondok/missions/{kind}/complete`(201/409/422/401) + `GET /hoondok/me/summary`(오늘 3종·연속일·최대·누적·이번 주 7칸, `today_kst` 기준, 저장 안 함). 연속일·`week.done` 은 `read` 완료 기준. 서버가 날짜를 정하므로 소급은 당일만. API-HD-004/005·ENT-HD-003 확정 | pytest: 연속일 순수 함수(빈·오늘만·어제까지·끊김·최대·주 경계)·unique·쿠키 없음 401·**`admin_token` 만 가진 요청 401**·중복 409·kind 422·연속일 1 |
| C `feat/hoondok-web-identity` (B 스택) | `features/identity/`(별도 API client — `lib/api.ts` 의 `/login` 이동 미사용, `useCurrentUser`, 게이트 401 → `/hoondok/onboarding?returnTo=`(`/hoondok/` 접두만 허용)), SCR-PWA-001 최소형 `/hoondok/onboarding`(베타 고지·가입·로그인·로그아웃, 교회 선택·동의 체크 없음), 홈 미션·요일 스트립에 summary 결합, 훈독하기 완료 → API 기록, 비로그인 체크는 localStorage 에 KST 날짜 키로 두고 로그인 후 당일분만 소급 POST. `hoondok.css` 에 입력·온보딩 클래스 이식(토큰만) | Vitest: 하루 1회(409 → 완료)·자정(어제 키 폐기)·오류/빈/오프라인·401 → returnTo·외부 returnTo 거부·me 401 → null / 5xx → error. `pnpm hoondok:check`·typecheck·lint·build |
| D `feat/hoondok-phase2-e2e` (C 스택) | `scripts/seed_hoondok_user.py` + `make e2e`·`ci-e2e.yml` 시드 배선, `tests/e2e/hoondok.spec.ts` "비로그인 완료 → 가입 → 소급 → 연속 1일" + "시드 사용자 로그인 → 완료 1회 → 로그아웃 → 완료 API 401", additive-only 리허설(§3-4), §9·§10·TODO·README 정합 | `make ci` + `make e2e` 통과, 리허설 결과 §9 기록 |

Phase 2 완료 기준: `make e2e` 로 루프 재현. `admin_token` 만 가진 브라우저는 완료 API 에서 401. pytest 기준선 + 신규 green. 계정 삭제·비밀번호 재설정 API 는 비범위(`deleted_at` 컬럼만 예약).

## 6. Phase 3 — 설치 가능한 PWA 셸 + 편성 운영 + 운영 배포 + 제한 베타 (착수 2026-09-19, 계획 10/15~10/28 대비 앞당김)

통합 브랜치 `dev/hoondok-phase3`(worktree `../tw-hoondok-phase3/`, main `b70b6c8` 에서 분기. #283 docs 머지 후 `git rebase origin/main` 1회). Phase 2 의 `dev/hoondok-phase2` 는 #282 로 머지·삭제됐고 재사용하지 않는다. 운영에는 Phase 1·2 코드가 `HOONDOK_ENABLED=0` 으로 올라가 있어(§9) 이 Phase 의 배포는 backend(A·F·H) → admin(B) → web **`HOONDOK_ENABLED=1`**(C~E) 순이며 각 단계 별도 승인이다. sub-PR 은 두 트랙이다 — **편성 트랙 A→B** 는 비개발자 편성자가 베타 전 N일분을 미리 입력해야 하므로 먼저, **PWA 트랙 C→D→E→F** 는 그 뒤. 트랙 안에서만 스택하고(`rebase --onto` 절차는 §5 와 같다) 트랙 간에는 독립이라 동시에 열 수 있다. G 는 두 트랙 뒤, H 는 조건부다.

2026-09-19 답변 반영: **편성자는 비개발자** → `apps/admin` 편성 화면 + `/admin/hoondok/daily-readings` API 로 확정하고 CSV 스크립트 안은 폐기한다(`seed_daily_readings.py` 는 로컬·E2E 시드로만 유지). **약관·법적 주체는 미정** → 베타 고지만 유지(§5 와 같음), 초대 규모 `[가정]` 10~20명 유지. 제한 베타의 실제 제한 수단은 F 의 초대 코드다(`[확인 필요]` — 불필요하면 F 를 생략하고 noindex·비링크 상태로 연다).

조사로 확인한 전제(2026-09-19): `apps/web/public/` 에 PWA 자산 0건(`chat-mockups.html` 만)이고 Dockerfile 이 `public/` 을 그대로 복사하므로 새 정적 파일은 Dockerfile 변경 없이 실린다. 루트 `layout.tsx` 는 시연 챗과 공유되고 `X-Robots-Tag` 헤더는 `/hoondok` 경로 한정이므로 manifest·SW·폰트는 전부 `/hoondok/` 아래에 둔다(§10). `DailyReadingRepository` 는 `get_by_date`·`create` 만 있다. smoke 타깃·클라이언트 오류 관측·Cloudflare 캐시 규칙 문서는 0건이며 G 에서 신설한다. `ops-check.sh` 의 `containers` 는 compose 서비스 목록을 읽고, 이 Phase 는 컨테이너를 늘리지 않는다.

| sub-PR | 내용 | 완료 기준 |
|---|---|---|
| 0 `docs/hoondok-phase3-plan` | 이 §6 표 + §10 결정 5건 | docs-only, `node tooling/checks/docs-links.mjs` 새 오류 0 |
| A `feat/hoondok-curation-api` | `apps/api/app/modules/hoondok/admin_router.py` prefix `/admin/hoondok/daily-readings`(`main.py` 에 `_ADMIN_GATE` 로 등록, 라우터 레벨 `verify_csrf`): `GET`(기간 `from`·`to`, 기본 오늘~+14일, 날짜순) · `GET /{id}` · `POST`(201, 같은 `reading_date` 409) · `PUT /{id}`(본문·출처·`review_status` 포함 — `withdrawn` 이 철회 수단, DELETE 없음). 스키마 `DailyReadingAdminCreate/Update/Response`(`AuthorityGrade`·`ReviewStatus` Literal 검증, PG ENUM 금지 §3). 리포지토리 `list_range`·`get_by_id`·`update` 추가. chatbot admin 라우터처럼 `admin_service.log_audit` 기록. 테이블 변경 없음 | pytest: 경로 의존성에 `verify_csrf`·`require_admin_gate` 포함 단언(`test_admin_user_status.py:161-177` 패턴) · 201/409/404/422 · `admin_token` 없는 요청 401 · `PUT withdrawn` 후 `GET /hoondok/today` 가 `status="withdrawn"` · `pnpm contracts:generate` + `contracts:check` 하위 호환(추가만) |
| B `feat/hoondok-curation-admin` (A 스택) | `apps/admin/src/features/hoondok/{api.ts,types.ts,components/daily-reading-form.tsx}`(생성 DTO 타입 + `fetchAPI`, 기존 chatbot 패턴), 페이지 `(dashboard)/hoondok/page.tsx`(오늘~+14일 표, 빈 날은 "미편성" 행) · `hoondok/new` · `hoondok/[id]/edit`, `NAV_ITEMS` 에 "훈독 편성". 폼 필드 = ENT-HD-002 전부(`reading_date` 는 `<Input type="date">`, `body` 는 raw textarea — admin UI 에 textarea·date picker 컴포넌트 없음, `authority_grade`·`review_status` 는 select). 새 디자인 없음(`docs/specs/admin/ui-ux.md` 기존 토큰) | Vitest: 폼 검증(필수·날짜·분 정수)·제출 페이로드 · admin E2E(신규 spec): 로그인 → 오늘 편성 제목 수정 → web `/hoondok` 에 새 제목 표시(편성→노출 루프) · `pnpm --filter @truewords/admin test·lint·build·typecheck` |
| C `feat/hoondok-pwa-manifest` | `public/hoondok/manifest.webmanifest`(`name`·`short_name` "훈독", `id`·`start_url`·`scope` `/hoondok`(슬래시 없음, §10 2026-09-19 정정), `display: standalone`, `background_color`·`theme_color` `#fbfaf8`(`--paper`), `lang: ko`, 베타 고지형 `description` — REQ-PWA-001 공식 로고·소속 표기 금지) + 아이콘 `public/hoondok/icons/`(192·512·maskable 512·apple-touch 180; "훈" 글자 기반 단색 도형, 브랜드 로고 아님 — 아이콘 파일이 곧 시안, PR 에서 승인, DES-PWA-003 에 "앱 아이콘" 1절 추가) + hoondok layout 에만 `metadata.manifest`·`appleWebApp` + `viewport.themeColor`(루트 layout 무변경) + Pretendard self-host: `public/hoondok/fonts/` woff2(**2026-09-19 확정: variable 1종 `PretendardVariable-1.3.9.woff2` 1.96MB** — 정적 4종은 2.98MB 로 초과 → 미채택, `OFL.txt` 동봉) + `hoondok.css` `@font-face`(패밀리명 `"Pretendard Hoondok"`, 루트 CDN `<link>` 는 시연 챗용으로 유지) + `next.config.ts headers()` `/hoondok/fonts/:path*` 1년 immutable | `hoondok:check` 통과 · Vitest: 플래그 ON 시 manifest 링크 존재, OFF 시 없음 · E2E `hoondok.spec.ts`: `/hoondok/manifest.webmanifest` 200·필수 키·`scope` 값, 아이콘 4개 200, `/`·`/login` 응답에 manifest 링크 없음 · `next build` 라우트 불변 |
| D `feat/hoondok-pwa-sw` (C 스택) | `public/hoondok/sw.js`(scope **`/hoondok`** — C-3 파급(§10 2026-09-19): 기본 scope `/hoondok/` 은 홈 `/hoondok` 을 덮지 못하므로 `sw.js` 응답에 `Service-Worker-Allowed: /hoondok` 헤더 + `register("/hoondok/sw.js", { scope: "/hoondok" })`, `SW_VERSION` 상수, precache = `/hoondok/offline` HTML **+ 그 HTML 이 참조하는 `/_next/static` 청크**(2026-09-19 결정 — SSR HTML 만 캐시하면 오프라인에서 비스타일 렌더) + 아이콘·manifest, `fetch` 는 navigation 실패 시 `/hoondok/offline` 로 **302** 후 그 URL 에서만 캐시 HTML(다른 URL 에 그대로 내면 `usePathname` 앱 셸이 hydration 불일치 — E2E 1차에서 실측) + precache 자산의 네트워크 실패 시 캐시 대체만(런타임 `cache.put` 없음), **`/api/backend/*`·`/hoondok/onboarding`·인증 응답 캐시 금지**, `activate` 에서 구버전 캐시 삭제) + 킬스위치(같은 파일의 `SW_KILL` 분기: `registration.unregister()` + `caches.keys()` 전삭제) + `src/app/(hoondok)/hoondok/offline/page.tsx`(정적 안내 1장) + 등록 클라이언트 컴포넌트(hoondok layout, 플래그 ON 에서만, `navigator.serviceWorker` 미지원 시 no-op, 등록 실패는 H 로 보고) + `next.config.ts headers()` 에 `/hoondok/sw.js`·`/hoondok/manifest.webmanifest` `Cache-Control: no-cache, must-revalidate`(Cloudflare 엣지는 origin no-cache 를 따른다) + `apps/web/AGENTS.md` 의 "PWA 서비스워커는 M5 승인 후" 문구를 PLAN-HD-001 Phase 3 승인으로 갱신 | E2E(Chromium): `navigator.serviceWorker.ready` 등록·scope `/hoondok` · offline 모드에서 `/hoondok/read` 이동 시 `/hoondok/offline` 렌더 · `/api/backend/hoondok/today` 응답이 CacheStorage 에 없음 · `sw.js` 응답 헤더 `no-cache` · 시연 챗 `/login` 에서 `navigator.serviceWorker.controller === null`(`getRegistrations()` 는 origin 전체를 돌려주므로 0건 단언이 불가능 — 2026-09-19 정정) · Vitest: install precache 목록·fetch 미관여 경로·offline 폴백·activate 정리·킬스위치 분기 + 등록 컴포넌트 ON/OFF |
| E `feat/hoondok-install-guide` (D 스택) | SCR-PWA-015 의 설치 안내 부분만(알림 설정은 Phase 4. PRD 에 AC-015 없음 → 이 행이 인수 조건): `features/hoondok/install/` — `storage.ts`(localStorage 3키 `hoondok:install:eligible`·`hidden-until`(나중에 30일)·`installed` + 변경 이벤트 `hoondok:install-change`) · `prompt-store.ts`(`beforeinstallprompt` `preventDefault` 후 보관, `appinstalled` → installed) · `platform.ts`(`display-mode: standalone`·`navigator.standalone`, iPhone/iPad·iPadOS Macintosh+터치) · `use-install-card.ts`(변형 `hidden`·`ios`·`prompt`·`manual` 순수 판정 + `useSyncExternalStore`, 서버 스냅샷 hidden) + `<HoondokInstallPromptListener/>` 를 hoondok layout 에(이벤트는 `/read` 에서도 발사되므로 카드보다 먼저 잡는다) + `<InstallCard/>` 를 `/hoondok` 홈 `HomeMissions` 뒤에 조건 렌더 — 조건 = `useCompleteMission` 의 mutation variables `"user"`(`markDone`) 로 `recorded` 가 처음 나온 뒤(소급 `"sync"` useEffect 경로 제외), standalone 이면 숨김. **2026-09-19 결정(§10)**: prompt 도 iOS 도 아닌 환경(헤드리스·Firefox·삼성 인터넷·인앱 브라우저)은 `manual` 일반 안내("Chrome·Safari 에서 열고 브라우저 메뉴의 홈 화면에 추가"), 프로토타입 015 의 알림 헤드라인·`.st-install`(CSS 0건)은 쓰지 않고 `hoondok.css` `.install__*`(토큰만) 신설 | Vitest `hoondok-install` 14: 저장소 3키·깨진 값·던지는 저장소 / standalone(matchMedia·`navigator.standalone`)→hidden / iPhone·iPadOS UA→ios / `beforeinstallprompt` 모킹→prompt·`preventDefault`·"지금 추가"→`prompt()`·수락→installed·거절→manual / 나중에 30일·만료 재노출 / 소급(sync) 201→자격 없음·직접(user) 201→자격·409→자격 없음 · E2E: **신규 가입 사용자**(2026-09-19 정정 — 시드 사용자는 재실행 시 이미 완료라 홈 체크가 disabled) 직접 완료 → 홈 카드(manual) 노출 → reload 유지 → 나중에 → 숨김 + 첫 시나리오의 소급 뒤 카드 부재 단언(prompt·iOS 는 헤드리스 미검증 — 실기기 증거로 대체) |
| F `feat/hoondok-beta-gate` (E 스택) | 제한 베타 게이트(`[확인 필요]` → 2026-09-19 구현으로 확정, 운영 ON/OFF 는 VM `.env` 값이 결정): `HOONDOK_INVITE_CODE`(`SecretStr \| None`, `.env.example` 주석 처리 + VM `.env`) 가 설정되면 `POST /hoondok/auth/signup` 이 `invite_code`(선택 필드 1~64자, 앞뒤 공백 무시)를 요구하고 누락·불일치 **403 `INVITE_REQUIRED`** — `identity/exceptions.py` `InviteRequiredError` → `core/common/exception_handlers.py` 핸들러(`ErrorResponse`, 코드 원문 로그 금지) → `main.py` 등록(SEC-MONO-001 선례). 게이트는 `IdentityService.signup` 맨 앞(중복 409 보다 먼저 → 이메일 존재 여부 비노출), `secrets.compare_digest` 바이트 비교. 미설정·빈 값(`HOONDOK_INVITE_CODE=` 는 `SecretStr("")`)이면 기존 동작이고 `tests/conftest.py` autouse 가 OFF 로 고정(개발자 로컬 `.env` 유입 차단). 온보딩 폼 가입 모드에 "초대 코드" 1칸(비우면 페이로드에서 생략, 403 은 `error.errorCode` 로 CSRF 와 구분). 로그인·기존 계정 무영향. OpenAPI 403 response 데코는 추가하지 않음 | pytest: 설정 시 누락·불일치·공백만 403 `INVITE_REQUIRED`(request_id 포함, 쿠키 없음)·일치 201·기존 이메일+틀린 코드 403(409 아님)·로그인 무영향 / 미설정·`""`·공백 3종 parametrize 시 필드 무시 201·65자 422 · web Vitest: 가입 모드에만 칸, 공백 다듬어 `invite_code` 전송, 빈 값 생략(기존 정확 일치 단언 유지), 403 `INVITE_REQUIRED` 안내 · `pnpm contracts:generate` + `contracts:check` 하위 호환(선택 필드 추가만) |
| G `chore/hoondok-ops` | `infra/oracle-vm/smoke.sh` + `make smoke-web`(공개 URL: `/login` 200 · `/api/backend/health`·`/api/backend/hoondok/today` 200 · `HOONDOK_ENABLED=1` 이면 `/hoondok` 200·manifest 200·`sw.js` `no-cache` 헤더·아이콘 200, `0` 이면 `/hoondok` 404 — 기대값은 인자) + `ops-check.sh` 에 `hoondok-today` 검사(오늘·내일 편성 없음 → WARN, `record` 패턴) + runbook `docs/runbooks/hoondok-pwa-rollout.md`(플래그 ON 배포 순서·`smoke-web`·킬스위치 배포 절차·`rollback-web` 만으로는 SW 가 안 지워진다는 사실·Cloudflare 캐시 확인·web 512m 메모리 재측정·실기기 증거 양식) + `docs/architecture/2026-09-05-pwa-flutter-monorepo.md` §7 에 구현 경로 주석 | `bash -n`(make ci) · `make smoke-web HOONDOK_ENABLED=0` 을 현재 운영에 실행해 통과 · `ops-check` 실행 시 `hoondok-today` 행 출력 · docs-links 새 오류 0 |
| H `feat/hoondok-client-errors` (조건부, 마지막) | 최소 클라이언트 오류 수집: `client_error_events` 테이블(additive-only: id·occurred_at·kind Literal `sw_register`·`install_prompt`·`unhandled`·`api_5xx`·message 200자 절단·path·ua 200자·user_id nullable) + `POST /hoondok/client-errors`(익명 허용, 기존 rate limiter, 본문 검증) + web 전역 핸들러(`window.onerror`·`unhandledrejection`·SW 등록 실패, hoondok 스코프에서만). REQ-PWA-015: 질문·메모·검색어 원문 수집 금지. 조회는 psql 로만(admin 화면 없음) | pytest: 검증·절단·rate limit · Vitest: 핸들러가 hoondok 밖에서 미등록 · additive-only 리허설(§3) · 착수 조건 = G 머지 후 사용자 승인 |

Phase 3 완료 기준: 운영 `truewords.woosung.dev/hoondok` 을 Android·iOS 16.4+ 실기기에서 설치 → 가입(초대 코드) → 훈독 → 완료. 편성자가 admin 에서 7일분 이상 입력. 시연 챗·admin E2E·`smoke-web` green. `mission_logs` 7일 적재 시작. 배포 순서 = A·F(·H) 머지 후 `make deploy-backend` → B 후 `make deploy-admin` → C~E·G 후 `make deploy-web HOONDOK_ENABLED=1` → `make smoke-web HOONDOK_ENABLED=1` → 실기기 증거 → 초대. 각 단계 별도 승인. 실기기 증거는 `docs/plans/completed` 이동 시 첨부한다.

## 7. Phase 4 — 훈독 알림 1종 + 베타 판정 (조건부, 10/29~11/11)

Phase 3 데이터(7일 중 5일 완료 비율, D7 재방문)를 본 뒤 착수한다. 알림 4종 중 훈독 알림만.

- 베타 1차 판정 쿼리 2개(별도 이벤트 수집기 없이).
- `notifications` 모듈: VAPID 3종(`SecretStr`, `.env.example`·`turbo.json`·Makefile build-arg 동기화), `push_subscriptions`, `POST/DELETE /hoondok/me/push`.
- 발송기: VM cron `docker compose exec backend python scripts/send_hoondok_push.py`, 404/410 정리, ops-check 항목. **GHA cron 금지.**
- `sw.js` `push`/`notificationclick`, `PushManager.subscribe`, SCR-PWA-015 알림 부분.
- 완료 기준: 실기기에 설정 시각 알림 도착·탭 시 `/hoondok`. ops-check 가 "0건 발송"을 잡는다. 다음 우선순위(F2 AI 질문 2차 조건) ADR 이 베타 수치를 근거로 작성된다.

## 8. 검증 명령

```bash
# 문서
node tooling/checks/docs-links.mjs
# 훈독 CSS 스코프 (sub-PR 1 이후)
node tooling/checks/hoondok-css.mjs
# 전체 (API pytest · contracts · tooling · docs · boundaries · web/admin test/lint/build/typecheck)
make ci
# 통합 E2E (격리 compose + 시드). 훈독 프로젝트만:
pnpm test:e2e --project hoondok-chromium
make e2e
```

## 9. 완료 증거

Phase 별 실행 결과를 여기에 기록한다. 이전 기준선(pytest 964 passed / 4 skipped / 1 xfailed, Vitest 113, Playwright 23)은 참고값이며 현재 결과로 복사하지 않는다.

아래 Phase 1 결과는 2026-09-16 로컬 worktree `../tw-hoondok-mvp/`(`dev/hoondok-mvp`)에서 실행했고, 같은 날 sub-PR #272(SEC)·#273(web)·#274(API)가 각각 GitHub CI(API·web·admin·contracts·E2E·repository) 전부 통과 후 dev 에 squash 머지됐다. docs PR 은 #271.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 1 | `node tooling/checks/docs-links.mjs` (docs 브랜치, 깨끗한 체크아웃) | 문서 186 · 링크 290 · 새 오류 0 | 2026-09-16 |
| 1 | API pytest (`sub-PR 2 + 3` 누적) | 979 passed / 4 skipped / 1 xfailed (기준선 972 + SEC 6 + 훈독 7) | 2026-09-16 |
| 1 | `pnpm contracts:generate` + `contracts:check` (oasdiff, base `1c41e0f`) | 드리프트 0 · 하위 호환 통과 (`/hoondok/today` 추가만) | 2026-09-16 |
| 1 | web Vitest · typecheck · lint · Biome | 72 passed (기존 62 + 훈독 10) · 오류 0 · lint 경고 10건은 전부 기존 파일 | 2026-09-16 |
| 1 | `node tooling/checks/hoondok-css.mjs` + `node --test tooling/checks` | 통과 · 21 pass | 2026-09-16 |
| 1 | `next build` (플래그 ON) | `/hoondok`·`/hoondok/read` 동적(ƒ), 나머지 라우트 불변 | 2026-09-16 |
| 1 | Playwright 전체 (격리 compose + 시드 + `seed_daily_readings`) | **44 passed** = 기존 38 + `hoondok-chromium` 6 (390/1280 넘침 0·콘솔 0·noindex·`:root --accent` 불변·홈→읽기→완료) | 2026-09-16 |
| 1 | additive-only 리허설 (§3-4): `h0d01a2b3c4d` 적용 DB 위에 main `1c41e0f` 백엔드 기동 | `/health` 200 · `/chatbots` 200 · traceback 0 · `/hoondok/today` 404(예상) | 2026-09-16 |
| 1 | 플래그 OFF 404 | Vitest(`notFound` 호출) 로 확인. 운영 `b70b6c8`(`HOONDOK_ENABLED=0`)에서 `/hoondok`·`/hoondok/read`·`/hoondok/onboarding` 404 + `x-robots-tag: noindex, nofollow` 실측 | 2026-09-16 · 2026-09-18 |
| 1 | 60대 사용자 3명 200% 확대 확인 | 미수행 `[가정: 사용자 섭외 후]` | — |

아래 Phase 2 결과는 2026-09-16 로컬 worktree `../tw-hoondok-phase2/`(`dev/hoondok-phase2`, main `9940b82` 분기)에서 sub-PR A→B→C→D 스택 tip 에 대해 실행했다. sub-PR: #277 docs · #278 identity · #279 mission_logs · #280 web · D E2E. main 머지는 2026-09-18 PR #282(`b70b6c8`), 운영 배포는 같은 날 **플래그 OFF** 로 backend → web 순 실행했다(표 마지막 3행). 플래그 ON 배포는 Phase 3(§6)에서 한다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 2 | API pytest (`sub-PR A + B` 누적) | 1005 passed / 4 skipped / 1 xfailed (Phase 1 기준 979 + identity 14 + missions 10 + admin 회귀 2) | 2026-09-16 |
| 2 | `pnpm contracts:generate` + `contracts:check` (base `9940b82`) | 드리프트 0 · 하위 호환 통과 (`/hoondok/auth/*`·`/hoondok/missions/{kind}/complete`·`/hoondok/me/summary` 추가만) | 2026-09-16 |
| 2 | `alembic heads` | `j3f4a5b6c7d8` 단일 head (`h0d01a2b3c4d` → `i1e2f3a4b5c6` users → `j3f4a5b6c7d8` mission_logs) | 2026-09-16 |
| 2 | web Vitest · typecheck · lint · Biome | 87 passed (Phase 1 72 + identity·missions 15) · 오류 0 · lint 경고 10건 전부 기존 파일 · Biome 신규 파일 포맷 적용(남은 1건은 Phase 1 `malssum-card` 기존) | 2026-09-16 |
| 2 | `pnpm hoondok:check` + `node tooling/checks/docs-links.mjs` | 통과 · 문서 186 · 링크 291 · 새 오류 0 | 2026-09-16 |
| 2 | `next build` (플래그 ON) | `/hoondok`·`/hoondok/read`·`/hoondok/onboarding` 동적(ƒ), 나머지 라우트 불변 | 2026-09-16 |
| 2 | `make e2e` (격리 compose + 시드 + `seed_hoondok_user`) | **45 passed** = 기존 38 + `hoondok-chromium` 7 (스모크 5 + "비로그인 완료 → 가입 → 당일 소급 → 연속 1일 → 재요청 409" + "시드 사용자 로그인 → 완료 1회 → 로그아웃 → 완료·요약 API 401") | 2026-09-16 |
| 2 | additive-only 리허설 (§3-4): `j3f4a5b6c7d8` 적용 DB 위에 main `9940b82` 백엔드 기동 | `/health` 200 · `/chatbots` 200 · `/hoondok/today` 200 · `/hoondok/auth/me` 404(구 이미지, 예상) · traceback 0 | 2026-09-16 |
| 2 | `make ci` + `make e2e` (통합 브랜치 `f8bcf11`, sub-PR 5개 머지 후) | `make ci` exit 0 (pytest 1005 passed / 4 skipped / 1 xfailed · contracts · tooling · docs · boundaries · hoondok:check · web/admin test·lint·build·typecheck) · `make e2e` 45 passed | 2026-09-16 |
| 2 | main 머지 PR #282 (squash, 사용자 수동) | main `b70b6c8` · CI Required 8/8 · 머지 후 `dev/hoondok-phase2` worktree·브랜치 정리 | 2026-09-18 |
| 2 | `make deploy-backend` `b70b6c8` (guarded · 사전 ops-check 7건 OK · 백업 2시간 전 dump) | 기동 시 alembic `a1c9e7d0b2f3 → h0d01a2b3c4d → i1e2f3a4b5c6 → j3f4a5b6c7d8` 3단계 적용 · `daily_readings`·`users`·`mission_logs` 생성 · traceback 0 · `/api/backend/hoondok/auth/me` 404 → 401 · `/hoondok/today` 200 `status=none` · `/chat/stream` SSE chunk → done 정상 · web/admin 재생성 없음 | 2026-09-18 |
| 2 | `make deploy-web` `b70b6c8` `HOONDOK_ENABLED=0` (guarded · `--no-deps`) | web 만 Recreate · `/`·`/login`·`/about` 200 · `/hoondok*` 3라우트 404 + noindex · admin `/login` 200 · 사후 ops-check 7건 OK(containers 6개 정상) | 2026-09-18 |

아래 Phase 3 결과는 2026-09-19 로컬 worktree `../tw-hoondok-phase3/`(`dev/hoondok-phase3`, main `b30aebd` 위로 rebase, #284 docs · #285 A 머지 후)에서 sub-PR B `feat/hoondok-curation-admin` tip 에 대해 실행했다. 편성 트랙(A·B)의 결과이며, PWA 트랙 C 의 결과는 그 아래 표에 이어 기록한다. D~F·G·H 는 미착수다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 3 B | admin Vitest | **104 passed / 17 files** (기존 76 + 신규 28: `hoondok-dates` 5 · `hoondok-form` 8 · `hoondok-api` 5 · `daily-reading-form` 8 · `hoondok-page` 2) | 2026-09-19 |
| 3 B | `pnpm --filter @truewords/admin typecheck` · `lint` · `build` | typecheck 통과 · lint 경고 3건 전부 기존 파일(`analytics/queries`·`lib/api`) · `next build` 라우트 `/hoondok` ○ · `/hoondok/new` ○ · `/hoondok/[id]/edit` ƒ, 나머지 불변, Suspense 경계 오류 0 | 2026-09-19 |
| 3 B | `pnpm format:check` · `boundaries.mjs` · `docs-links.mjs` | Biome 220 files 통과(신규 파일 lint 경고 4건은 `chatbot-form` 과 같은 패턴 — `noConfusingVoidType` 1·테스트 `noNonNullAssertion` 3) · 앱 간 import 경계 통과 · 문서 186 · 링크 291 · 새 오류 0 | 2026-09-19 |
| 3 B | `make e2e` (격리 compose + 시드) | **48 passed** = 기존 45 + `hoondok-curation` 3 (사이드바→15행·시드 R/미검수 배지 / 오늘 제목 수정→web `/hoondok` `article.malssum h2` 노출→원복 / `?date` 프리필·필수 미입력 인라인 오류·POST 0건), 1.5m | 2026-09-19 |
| 3 A·B | main 머지 PR #287 (`dev/hoondok-phase3` → main, squash, 사용자 승인) | main `87db69a` · CI Required 8/8 · dev↔main `merge-tree` 충돌 0 · 머지 후 main `make ci`: pytest 1014 / 4 / 1 · contracts · tooling 21 · boundaries · hoondok:check · web 87 · admin 104 · lint·build·typecheck 통과(docs-links 만 gitignore 된 로컬 `docs/guides/*.html` 11건으로 실패 — 레포 외 파일, GitHub CI 는 통과) · 사전 ops-check 7건 OK. GitHub 가 머지 시 head 를 자동 삭제해 `dev/hoondok-phase3` 는 main `87db69a` 로 재생성(C~H 스택용) | 2026-09-19 |
| 3 A | `make deploy-backend` `87db69a` (guarded) | alembic 신규 업그레이드 없음 · backend Recreate → healthy · traceback 0 · `/api/backend/health` 200 · `/admin/hoondok/daily-readings` 401(쿠키 없음, 두 origin 동일) · `/hoondok/today` 200 `status=none` · `/chat/stream` SSE chunk 13 → sources → done · web/admin 재생성 없음 · 사후 ops-check 7건 OK | 2026-09-19 |
| 3 B | `make deploy-admin` `87db69a` (guarded · `--no-deps` · `DEMO_ADMIN_EMAIL` 은 VM `.env` 값) | admin 만 Recreate → healthy(Next 16.3.4, 이전 `8980e0c` 12일 만에 교체, pnpm 12 Dockerfile 운영 최초 통과) · `/login`·`/hoondok`·`/hoondok/new`·`/dashboard` 200 · backend 미재생성 · 이미지 GC 정상 · 사후 ops-check 7건 OK · web 은 `b70b6c8`·`HOONDOK_ENABLED=0` 유지(`/hoondok` 404). 운영 편성 데이터는 아직 0건 — 편성자 로그인 후 15행 화면 확인·입력은 `[확인 필요]` | 2026-09-19 |

아래 Phase 3 C 결과는 2026-09-19 같은 worktree 에서 sub-PR C `feat/hoondok-pwa-manifest`(`dev/hoondok-phase3` = main `8da6d31` 위) tip 에 대해 실행했다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 3 C | Pretendard 용량 실측(jsdelivr npm `pretendard@1.3.9` 파일 목록) | 정적 4종 합계 2,98MB(초과) · **variable 1종 2,057,688 B = 1.96MB(채택)** · 동적 서브셋 92청크 2.82MB(미채택). `OFL.txt` 4,419 B 동봉 | 2026-09-19 |
| 3 C | 아이콘 생성 | Pretendard-Bold.otf → fontTools `SVGPathPen` 로 "훈" path 추출 → SVG 2종 → `rsvg-convert` PNG 4장 × A/B 2세트 → 비교 시트(iOS 라운딩·Android 원형·any, 밝은/어두운 홈)로 **A 감귤 배경 확정**, B 삭제. IHDR 폭·높이 = 192/512/512/180 확인, maskable 글자 대각 반지름 170px ≤ 205px | 2026-09-19 |
| 3 C | `pnpm hoondok:check` + `pnpm tooling:test` | 통과(`:root` 0 · 토큰 밖 hex 0 — `@font-face` 는 hex 없음) · 21 pass | 2026-09-19 |
| 3 C | web Vitest · typecheck · lint · Biome | **91 passed / 14 files**(Phase 2 87 + `hoondok-pwa` 4) · typecheck 통과 · lint 경고 10건 전부 기존 파일 · `pnpm format:check` 227 files 통과 | 2026-09-19 |
| 3 C | `next build` 플래그 ON / OFF | 두 빌드 모두 라우트 목록 Phase 2 와 동일(`/hoondok`·`/hoondok/read`·`/hoondok/onboarding` ƒ, 나머지 ○) — manifest·아이콘·폰트는 라우트가 아닌 public 자산 | 2026-09-19 |
| 3 C | `next start`(ON 빌드, :3010) 실측 — C-3·C-5 `[가정]` 검증 | `/hoondok/manifest.webmanifest` 200 `application/manifest+json` scope `/hoondok` · **`/hoondok/fonts/*.woff2` `Cache-Control: public, max-age=31536000, immutable`**(public 기본 `max-age=0` 을 headers() 가 덮음 — 가정 확인) · 아이콘 4개 200 `image/png` · `/hoondok/` → **308 `/hoondok`**(슬래시 정정 근거) · `/hoondok` head 에 manifest·apple-touch·theme-color·`mobile-web-app-capable`·`apple-mobile-web-app-title` 존재, `/login` 0건 · 브라우저 `document.fonts` 에 `"Pretendard Hoondok"` loaded, CDN `Pretendard Variable` 청크 다운로드 0건 | 2026-09-19 |
| 3 C | `node tooling/checks/docs-links.mjs` | 문서 186 · 링크 291 · 새 오류 0 | 2026-09-19 |
| 3 C | `make e2e` (격리 compose + 시드, 플래그 ON dev 서버) | **50 passed** = Phase 3 B 48 + `hoondok-chromium` 2 ("PWA 정적 자산: manifest·아이콘 4개·폰트 200·scope `/hoondok`·폰트 immutable" / "설치 메타 `/hoondok` 한정 + `document.fonts` 에 `Pretendard Hoondok` loaded + `/`·`/login` 0건"), 1.5m | 2026-09-19 |

아래 Phase 3 D 결과는 2026-09-19 같은 worktree 에서 sub-PR D `feat/hoondok-pwa-sw`(C 머지 후 `dev/hoondok-phase3` = `d167494` 위) tip 에 대해 실행했다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 3 D | `pnpm hoondok:check` · `pnpm format:check` | 통과(CSS 무변경) · Biome 229 files 통과 | 2026-09-19 |
| 3 D | web Vitest · typecheck · lint | **98 passed / 15 files**(C 91 + `hoondok-sw` 5: install precache 목록·fetch 미관여 6경로·offline 폴백·activate 정리·킬스위치 + 등록 컴포넌트 ON/OFF 2) · typecheck 통과 · lint 경고 10건 전부 기존 파일 | 2026-09-19 |
| 3 D | `next build` 플래그 ON | 라우트 `/hoondok/offline` ƒ 1개 추가, 나머지 Phase 2 와 동일 | 2026-09-19 |
| 3 D | `make e2e` 1차 | 52 passed 였으나 서버 로그에 **Hydration failed** 1건 — 오프라인 navigation 에 `/hoondok/read` URL 로 안내 HTML 을 그대로 내자 앱 셸 `usePathname` 제목이 불일치. C 실행 로그에는 0건이라 D 신규 결함으로 확정 → SW 폴백을 `/hoondok/offline` 302 로 변경 | 2026-09-19 |
| 3 D | `make e2e` 2차 (격리 compose + 시드, 플래그 ON dev 서버) | **52 passed** = C 50 + `hoondok-chromium` 2 ("SW scope `/hoondok` 등록 · `sw.js` no-cache + `Service-Worker-Allowed` · manifest no-cache · `/login` controller null" / "오프라인 `/hoondok/read` → `/hoondok/offline` 302 폴백 렌더 · hydration 오류 0 · `hoondok-*` 캐시 1개 · API·온보딩·auth 응답 캐시 0건"), Hydration 로그 0건, 1.4m | 2026-09-19 |

아래 Phase 3 E 결과는 2026-09-19 같은 worktree 에서 sub-PR E `feat/hoondok-install-guide`(D 머지 후 `dev/hoondok-phase3` = `5058168` 위) tip 에 대해 실행했다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 3 E | `pnpm hoondok:check` · `pnpm format:check` · `pnpm boundaries:check` · `pnpm tooling:test` | 통과(`.install__*` 신설, `:root` 0 · 토큰 밖 hex 0) · Biome 236 files 통과(layout import 순서 1건 `pnpm format` 으로 정리) · import 경계 통과 · 21 pass | 2026-09-19 |
| 3 E | web Vitest · typecheck · lint | **112 passed / 16 files**(D 98 + `hoondok-install` 14: 저장소 3키·깨진 값·던지는 저장소 2 / standalone·iOS·prompt 판정 4 / 카드 자격 전 빈 렌더·prompt 수락·거절·iOS·나중에 5 / 소급 sync 자격 없음·직접 user 자격·409 자격 없음 3) · typecheck 통과 · lint 경고 10건 전부 기존 파일(`(chat)`·`truewords/*`·`lib/api.ts`) | 2026-09-19 |
| 3 E | `next build` 플래그 ON | 라우트 목록 D 와 동일(`/hoondok`·`/hoondok/offline`·`/hoondok/onboarding`·`/hoondok/read` ƒ, 나머지 ○) — 카드·리스너는 기존 라우트의 클라이언트 컴포넌트 | 2026-09-19 |
| 3 E | `node tooling/checks/docs-links.mjs` | 문서 186 · 링크 291 · 새 오류 0 | 2026-09-19 |
| 3 E | `make e2e` 1차 | 52 passed + 신규 1 실패 — 마지막 `expect(errors).toEqual([])` 에 "Failed to load resource: 401" 1건. 비로그인 온보딩 첫 로드의 `/auth/me` 401 리소스 로그(정상)이고 카드 오류가 아님 → 401 로그를 제외하고 카드 오류만 0 으로 단언하도록 정정 | 2026-09-19 |
| 3 E | `make e2e` 2차 (격리 compose + 시드, 플래그 ON dev 서버) | **53 passed** = D 52 + `hoondok-chromium` 1("설치 안내: 신규 가입 → 홈 체크 직접 완료 → 카드(manual 변형·'지금 추가' 없음·`eligible`=1) → reload 유지 → 나중에 → `hidden-until` 29.9~30일 → reload 숨김") + 첫 시나리오에 소급 뒤 카드 부재 단언 추가, 1.4m. prompt()·iOS 분기는 헤드리스 미검증 — 실기기 증거로 대체(§6 E 행) | 2026-09-19 |

아래 Phase 3 F 결과는 2026-09-19 같은 worktree 에서 sub-PR F `feat/hoondok-beta-gate`(E `e56a919` 위 스택; E 는 PR #291 로 `dev/hoondok-phase3` = `1f4e83e` 에 squash 머지 — CI Required 8/8, 트리 동일하여 rebase 뒤 결과 불변) tip 에 대해 실행했다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 3 F | pytest 전체 (`GEMINI_API_KEY=test-key-for-ci EMBED_BATCH_SLEEP=0.001 uv run --frozen pytest -q`) | **1018 passed / 4 skipped / 1 xfailed**(A·B 1014 + `test_identity_auth` 4: 설정 시 누락·불일치·공백 403 `INVITE_REQUIRED`·일치 201·기존 이메일+틀린 코드 403·로그인 무영향 1 + 미설정/`""`/공백 parametrize 3 — 필드 무시 201·65자 422). autouse `_hoondok_invite_gate_off` 로 로컬 `.env` 유입 차단 | 2026-09-19 |
| 3 F | `pnpm contracts:generate` → `pnpm contracts:check` | 계약 diff = `SignupRequest.invite_code`(`anyOf string maxLength 64 \| null`) + description 만 · SDK `types.gen.ts` 1파일 재생성 · oasdiff **breaking 0**("specs are different" 만) · 하위 호환 통과 기준 `origin/main` `8da6d31` | 2026-09-19 |
| 3 F | web Vitest · typecheck · lint · Biome | **114 passed / 16 files**(E 112 + `hoondok-identity` 2: 가입 모드에만 칸·공백 다듬은 `invite_code` 전송 / 403 `INVITE_REQUIRED` 안내) · 기존 정확 일치 단언(빈 값 생략) 유지 · typecheck 통과 · lint 경고 10건 기존 파일 · `format:check` 236 files 통과 | 2026-09-19 |
| 3 F | `node tooling/checks/docs-links.mjs` | 문서 186 · 링크 291 · 새 오류 0 | 2026-09-19 |
| 3 F | `make ci` (F tip, E 포함) | 전부 통과 — pytest 1018/4/1 · `contracts:check` 하위 호환 · tooling 21 · docs-links · boundaries · hoondok:check · `bash -n` · api-client 13 · web **114** · admin 104 · lint 경고 web 10·admin 3 전부 기존 파일 · web·admin `next build` 라우트 불변 · typecheck 3 앱 | 2026-09-19 |
| 3 F | `make e2e` (격리 compose + 시드, 플래그 ON dev 서버, `HOONDOK_INVITE_CODE` 미설정) | **53 passed** = E 53 그대로 — 가입 시나리오 2건(소급·설치 안내)이 초대 코드 없이 201, 시드 사용자 로그인 무영향, 1.4m. 게이트 ON 의 E2E 는 없다(pytest 가 담당, 운영 확인은 G smoke 뒤 실기기 가입) | 2026-09-19 |

## 10. 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 결정 1~12 전부 추천 기본값으로 승인. 11(약관·법적 주체)만 `[확인 필요]` 유지 | 확정 |
| 2026-09-16 | `SEC-MONO-001` 위반 시 403 거부. 익명↔익명 재사용 허용, 미존재 id 는 새 세션 | 확정 · Phase 1 sub-PR 2 |
| 2026-09-16 | 계획·스펙·모순 정정은 docs-only PR 로 main 직행. 코드 sub-PR 은 `dev/hoondok-mvp` 통합 브랜치 | 확정 |
| 2026-09-16 | 홈 미션 3장 렌더, 기도·읽기는 "준비 중" 비활성 | 확정 · Phase 1 |
| 2026-09-16 | `daily_readings.chunk_id` 는 Qdrant point id 문자열이며 DB FK 가 아니다. `review_status` 는 varchar | 확정 · §3 |
| 2026-09-16 | Phase 2 통합 브랜치는 `dev/hoondok-phase2`. sub-PR A→B→C→D 스택, 선행 머지 후 `rebase --onto` | 확정 · §5 |
| 2026-09-16 | `[확인 필요]` 3건(메일·약관·편성자) 미정 → 운영자 수동·베타 고지만·시드 로 진행. TODO Questions 유지 | 확정 · §5 |
| 2026-09-16 | `hoondok_token` JWT 만료 7일(`HOONDOK_JWT_EXPIRE_MINUTES`). admin 24h 와 분리 | 확정 · Phase 2 A |
| 2026-09-16 | 연속일·이번 주 `done` 은 `read`(훈독하기) 완료 기준. 기도·읽기 규칙은 Phase 3+ 재검토 | 확정 · Phase 2 B |
| 2026-09-16 | Phase 2 코드 완료(sub-PR A~D). 계정 삭제·비밀번호 재설정 API 는 비범위 유지, `deleted_at` 예약만 | 확정 · §5 |
| 2026-09-19 | Phase 2 main 머지(#282 `b70b6c8`)·운영 배포(플래그 OFF) 완료(§9). Phase 3 통합 브랜치 `dev/hoondok-phase3`, 두 트랙(편성 A→B · PWA C→D→E→F) + G·H(조건부) | 확정 · §6 |
| 2026-09-19 | 편성자 = 비개발자 확정 → `apps/admin` 편성 화면 + `/admin/hoondok/daily-readings` API. CSV 안 폐기, `seed_daily_readings.py` 는 로컬·E2E 한정 | 확정 · Phase 3 A·B |
| 2026-09-19 | Phase 3 E 설치 안내: 완료 출처는 mutation variables `"user"`·`"sync"`(소급 제외, 훅 `onSuccess` 는 언마운트 무관), 카드 변형 `hidden·ios·prompt·manual`(prompt 미발사 환경도 일반 안내), localStorage 3키(`eligible`·`hidden-until` 30일·`installed`), `beforeinstallprompt` 는 layout 리스너가 캡처. E2E 는 시드 사용자 대신 신규 가입(재실행 결정론). `[확인 필요]` 첫날 비로그인→가입→소급 경로에서는 카드가 2일차 직접 완료 때 처음 뜬다(의도면 유지, 아니면 `source === "user"` 조건 제거) | 확정(기본값) · Phase 3 E |
| 2026-09-19 | Phase 3 F 초대 코드 게이트 구현으로 `[확인 필요]` 를 닫는다 — 운영에서 게이트를 켤지는 VM `.env` 의 `HOONDOK_INVITE_CODE` 유무로 결정(코드 변경 없음). 403 은 `INVITE_REQUIRED` ErrorResponse(중앙 핸들러), 게이트가 409 보다 먼저, 필드는 선택(하위 호환) | 확정 · Phase 3 F |
| 2026-09-19 | 약관·법적 주체 미정 유지 → 베타 고지만, 초대 `[가정]` 10~20명. 제한 수단은 초대 코드 게이트(F) `[확인 필요]` | 확정(기본값) · Phase 3 F |
| 2026-09-19 | manifest·SW·폰트는 `/hoondok/` 스코프 한정(`public/hoondok/`, hoondok layout `metadata`, `hoondok.css @font-face`). 초안의 `src/app/manifest.ts` 는 루트 layout·시연 챗에 붙고 noindex 헤더 범위 밖이라 폐기 | 확정 · Phase 3 C·D |
| 2026-09-19 | 오류 이벤트 수집(H)은 조건부·마지막. 알림 설정 UI 는 Phase 4. 계정 삭제·비밀번호 재설정은 계속 비범위 | 확정 · §6 |
| 2026-09-19 | 편성 화면(B)은 오늘~+14일 고정 표(빈 날 "미편성" + `편성하기 ?date=`), 기간 이동·삭제 없음. 철회는 `review_status` select. PUT 은 폼 전체 필드 전송(감사 로그 `changes` 에 전 필드 기록). admin 플래그 게이트 없음 — backend A 배포 전엔 목록이 오류 카드 | 확정 · Phase 3 B |
| 2026-09-19 | manifest `id`·`start_url`·`scope` = **`/hoondok`(슬래시 없음)**. 결정 2·`DEC-PWA-022` 의 `/hoondok/` 정정 — Next `trailingSlash` 기본 false 로 `/hoondok/`→308→`/hoondok` 이고 manifest scope 는 경로 접두 비교라 `/hoondok/` 이면 홈이 범위 밖(standalone 에서 브라우저 UI 노출). D 의 SW 도 `Service-Worker-Allowed: /hoondok` + scope `/hoondok` 으로 등록 | 확정 · Phase 3 C |
| 2026-09-19 | Pretendard self-host = 가변 1종 `PretendardVariable-1.3.9.woff2` 1.96MB(≤2MB) + `OFL.txt`. 정적 4종 2.98MB·동적 서브셋 92청크 미채택. 패밀리명 `"Pretendard Hoondok"` 으로 루트 CDN `Pretendard Variable` 과 분리(로드 순서 무관). `/hoondok/fonts/*` 는 `Cache-Control: public, max-age=31536000, immutable`(파일명 버전 고정, public 기본 `max-age=0` 대체) | 확정 · Phase 3 C |
| 2026-09-19 | 앱 아이콘 = "훈" 글자(Pretendard Bold 외곽선) 단색 도형 4종, **감귤 배경 + 종이색 글자 확정**(A/B 비교 시트로 같은 날 택일, 종이색 배경 B 안 삭제). 설치 메타(`manifest`·`appleWebApp`·`icons`·`themeColor`)는 hoondok layout `generateMetadata`·`generateViewport` 에만, 플래그 OFF 면 미부착 | 확정 · Phase 3 C · DES-PWA-003 §1.7 |
| 2026-09-19 | 오프라인 안내는 Next 라우트 `/hoondok/offline`(앱 셸 안, `.empty` 카드) 로 두고 SW 가 install 시 그 HTML 을 받아 참조 `/_next/static` CSS·JS 청크까지 precache 한다(정적 `offline.html` 안·HTML 만 precache 안 미채택). 청크 하나 실패는 설치를 막지 않는다(`allSettled`), 필수는 안내 HTML 하나. 오프라인 navigation 은 안내 HTML 을 요청 URL 에 그대로 내지 않고 `/hoondok/offline` 로 302 한다 — 1차 E2E 에서 `/hoondok/read` URL 에 안내 HTML 을 내자 앱 셸(`usePathname` 제목·활성 탭)이 hydration 오류를 냈다 | 확정 · Phase 3 D |
| 2026-09-19 | SW = `public/hoondok/sw.js`, scope **`/hoondok`**(`Service-Worker-Allowed: /hoondok` 헤더 + `register(..., {scope})`), `sw.js`·manifest `Cache-Control: no-cache, must-revalidate`. fetch 는 GET·same-origin 만, `/api/backend/*`·`/hoondok/onboarding`·`/hoondok/auth*`·다른 origin·비 `/hoondok` navigation 은 미관여. 런타임 `cache.put` 없음 → 인증·API 응답은 구조적으로 캐시 불가. 킬스위치 `SW_KILL=true` = 캐시 전삭제 + `unregister`, 등록 실패 보고는 H | 확정 · Phase 3 D |
| 2026-09-19 | 시연 챗 미제어 단언은 `/login` 에서 `serviceWorker.controller === null`. `getRegistrations()` 는 origin 전체라 계획 초안의 "0건" 은 성립하지 않는다 | 확정(정정) · Phase 3 D |
