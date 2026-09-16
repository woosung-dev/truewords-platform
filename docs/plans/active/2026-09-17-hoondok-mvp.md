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
| 2 | URL·설치 범위 | **`/hoondok/*`**, manifest `start_url`·`scope` = `/hoondok/` (Phase 3) | 시연 챗 `/`·`/login` healthcheck·E2E 불변 |
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
| 3 `feat/hoondok-today-api` | `apps/api/app/modules/hoondok/`(`daily_readings` 모델·alembic·`GET /hoondok/today`), `core/common/clock.py today_kst()`, 시드 스크립트(`make e2e` 시드 단계), `pnpm contracts:generate` 산출물, web `features/hoondok/api.ts` + 홈·훈독하기 결합 | 시드 후 `/hoondok/read` 에 출처 줄(메타 6항목)·권위 배지 표시, 없으면 AC-016-04 상태. pytest(repository·KST 경계·라우터 3상태), Vitest 3상태, E2E 1건 |

Phase 1 완료 기준: `/hoondok`·`/hoondok/read` 가 오늘 말씀을 표시하고 없으면 AC-016-04 상태. `make ci` 통과, 기존 E2E 와 `/`→`/login` 단언 유지, 플래그 OFF 시 404. 60대 사용자 3명 200% 확대 실사용 확인(`DES-PWA-003` §7.3)은 결과를 §7 에 기록한다 `[가정: 섭외는 사용자 담당]`.

## 5. Phase 2 — identity + 완료 기록·연속일 (10/1~10/14)

- `apps/api/app/modules/identity/`: `users`(ENT-HD-001), signup/login/logout/me/삭제, 쿠키 `hoondok_token`, JWT `aud="hoondok"`, `get_current_user`/`get_optional_user`. `admin/auth.py` 의 bcrypt·JWT 유틸만 재사용하고 `chat/dependencies.py` 는 재사용하지 않는다.
- 약관·처리방침 문구(결정 11 `[확인 필요]`) 반영한 SCR-PWA-001 최소형 + `features/identity/` 게이트, 401 → `/hoondok/onboarding?returnTo=`.
- `mission_logs`(ENT-HD-003) + API-HD-004·005. 비로그인 체크는 로그인 후 소급 기록(AC-016-02).
- E2E 시드(사용자 1·오늘 말씀 1) + "가입→훈독→완료→연속일 1" 시나리오. additive-only 리허설(§3-4).
- 완료 기준: `make e2e` 로 루프 재현. `admin_token` 만 가진 브라우저는 완료 API 에서 401. pytest 기준선 + 신규 green.

## 6. Phase 3 — 설치 가능한 PWA 셸 + 운영 배포 + 제한 베타 (10/15~10/28)

- `src/app/manifest.ts`(scope `/hoondok/`, standalone, `#fbfaf8`) + 아이콘 192/512/maskable/apple-touch(공식 로고 금지).
- `public/hoondok/sw.js`: 셸·아이콘만 precache, `/api/backend/*` 캐시 금지, 버전 + unregister 킬스위치. `next.config.ts headers()` 로 sw no-cache. Pretendard self-host.
- SCR-PWA-015 설치 안내(`beforeinstallprompt`·iOS 분기, 첫 훈독 완료 뒤).
- 편성 운영 수단: `POST /admin/hoondok/daily-readings`(AdminRole) 또는 CSV 스크립트. 편성자가 비개발자면 `apps/admin` 최소 화면 1개 `[확인 필요]`.
- 운영 준비: smoke-images 에 manifest·`/hoondok` 200, Cloudflare 캐시 규칙·SW 롤백 runbook, web 메모리 재측정, 오류 이벤트 최소 수집.
- `make deploy-backend` → `make deploy-web` 단계별 승인. 실기기(Android·iOS 16.4+) 설치·완료 증거를 `docs/plans/completed` 로 이동 시 첨부. 초대 `[가정]` 10~20명.
- 완료 기준: 운영 `truewords.woosung.dev/hoondok` 실기기 설치 후 가입→훈독→완료. 시연 챗·admin E2E·smoke green. `mission_logs` 7일 적재 시작.

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

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| 1 | docs-links | (docs PR 에서 기록) | — |

## 10. 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-16 | 결정 1~12 전부 추천 기본값으로 승인. 11(약관·법적 주체)만 `[확인 필요]` 유지 | 확정 |
| 2026-09-16 | `SEC-MONO-001` 위반 시 403 거부. 익명↔익명 재사용 허용, 미존재 id 는 새 세션 | 확정 · Phase 1 sub-PR 2 |
| 2026-09-16 | 계획·스펙·모순 정정은 docs-only PR 로 main 직행. 코드 sub-PR 은 `dev/hoondok-mvp` 통합 브랜치 | 확정 |
| 2026-09-16 | 홈 미션 3장 렌더, 기도·읽기는 "준비 중" 비활성 | 확정 · Phase 1 |
| 2026-09-16 | `daily_readings.chunk_id` 는 Qdrant point id 문자열이며 DB FK 가 아니다. `review_status` 는 varchar | 확정 · §3 |
