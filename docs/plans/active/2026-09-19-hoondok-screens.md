# PLAN-HD-002 — 훈독 남은 화면 13종 웨이브 실행 계획

- 상태: 2026-09-19 사용자 승인. 방식 3건(웨이브형·로컬 통합·디자인 스킬)은 확정이고(§9), 나머지 기본값은 `[가정]`·`[확인 필요]` 로 표기해 착수한다. 구현은 태스크마다 격리 worktree 서브에이전트가 만들고 오케스트레이터가 브랜치 `claude/hundok-webapp-ui-implementation-e71e67` 에 로컬 `--no-ff` 머지한다. main PR 은 W4 뒤 **1개**, 사용자 승인 시 push 한다(§3).
- 기준: main `aba5240`(PR #298, PLAN-HD-001 Phase 1~3 C~G 머지). 이 문서 작성 시 브랜치 HEAD 는 그 위 `40c8563`(#299 SW 킬스위치 fix)이다. 입력은 [PRD v2 `PRD-FFWPU-PWA-001`](../../prd/17-ffwpu-pwa-prd.md)(`SCR-PWA-001~016`·`DEC-PWA-0xx`), [디자인 시스템 `DES-PWA-003`](../../specs/web/hoondok-design-system.md)(근거), [프로토타입 `hoondok-ds`](../../prd/prototypes/hoondok-ds/README.md)(`app.html` + `hoondok.css`, 값의 원본), [PLAN-HD-001](./2026-09-17-hoondok-mvp.md)(선행 계획·additive-only 규칙 §3), [훈독 API](../../specs/api/hoondok-api.md)·[훈독 도메인](../../specs/domain/hoondok-entities.md).
- 출발점(확인된 사실): 16화면 중 `SCR-PWA-001` 최소형·`002` 홈·`003` 훈독하기 + 오프라인 안내(`/hoondok/offline`) + 설치 카드만 구현돼 있다. `tabs.ts` 의 `ask`·`library`·`worship`·`garden` 은 `isDisabled` 자리표시다. 운영 web 은 `HOONDOK_ENABLED=0`(`/hoondok/*` 404).
- 목표: 남은 화면 13종(`SCR-PWA-004~016`)을 웨이브 4개(W1 실데이터 → W2 AI 질문 → W3 정적 프리뷰 셸 → W4 마무리, W0 는 준비)로 옮기되 **운영 노출은 0** 이다 — 플래그 2개(`NEXT_PUBLIC_HOONDOK_ENABLED`·신규 `NEXT_PUBLIC_HOONDOK_PREVIEW`) 모두 운영 이미지 기본 OFF(§2).
- 원칙: 코드가 곧 스펙. 스크린샷·시각 대조 캡처·비교 산출물·기각 시안은 커밋하지 않는다. 결정은 이 문서 §9 와 각 스펙의 결정 표에 1~2줄로만 남긴다.
- 표기: 라벨 없는 문장은 확인된 사실·확정 결정이다. `[가정]`은 검증이 필요한 추론, `[확인 필요]`는 사용자·외부 결정이 필요한 항목이다.

## 1. 범위와 비범위

### 1.1 이 문서가 개정하는 선행 결정

PLAN-HD-001 §2.3 첫 항목 "16화면·컴포넌트 23종 일괄 포팅 비범위"는 **이 문서로 개정**한다 — 일괄이 아니라 웨이브 4개로 나눠 옮기고, 실데이터가 없는 화면은 프리뷰 플래그 뒤 정적 셸로만 둔다. 같은 §2.3 의 "F2 AI 질문을 시연 챗 재사용으로 넣기" 항목도 W2 범위로 개정한다(무기억·근거 게이트 포함. `search_events` 원문 분기·Gemini 한도 선행은 계속 비범위 → §9 `[확인 필요]`). PLAN-HD-001 §5 "계정 삭제 비범위" 는 W0-B `DELETE /hoondok/auth/me` 로 개정한다(§9 `[가정]`).

### 1.2 범위 — 화면 13종 + 기존 화면 보강 2건

| 화면 | 웨이브 | 라우트 | 데이터 |
|---|---|---|---|
| `SCR-PWA-004` 정성 기간 만들기(시트) | W1-J | `/hoondok?sheet=jeongseong` | 실데이터 `jeongseong_periods`(W0-B) |
| `SCR-PWA-002` 홈 정성 카드(보강) | W1-J | `/hoondok` | 같음 |
| `SCR-PWA-003` 오늘의 한 줄(보강) | W1-N | `/hoondok/read` | 기기 전용 localStorage |
| `SCR-PWA-014` 나의 정원 | W1-G | `/hoondok/garden` | `summary`·`history`(W0-B)·`jeongseong` |
| `SCR-PWA-015` 알림·설치 설정 | W1-S | `/hoondok/settings` | 설치 카드 + `DELETE /hoondok/auth/me`(W0-B). 알림은 disabled |
| `SCR-PWA-005` AI 질문(물음 한 장) + 기록 | W2 | `/hoondok/ask`·`/hoondok/ask/log` | 기존 `POST /chat/stream` SSE, 기록은 localStorage |
| `SCR-PWA-006` 질문·답변 상세 | W2 | `/hoondok/ask/[id]` | 같음 |
| `SCR-PWA-007` 말씀 서고 | W3-L | `/hoondok/library` | 프리뷰 fixture |
| `SCR-PWA-008` 말씀 검색 | W3-L | `/hoondok/search` | 프리뷰 fixture |
| `SCR-PWA-009` 원문 뷰 | W3-L | `/hoondok/words/[id]` | 프리뷰 fixture |
| `SCR-PWA-010` 가정예배 홈 | W3-W | `/hoondok/worship` | 프리뷰 fixture |
| `SCR-PWA-011` 챌린지 상세 | W3-W | `/hoondok/worship/challenge/[id]` | 프리뷰 fixture |
| `SCR-PWA-012` 5분 설교·전체 설교 | W3-W | `/hoondok/worship/sermons` | 프리뷰 fixture |
| `SCR-PWA-013` 설교 섭외·신청 폼 | W3-W | `/hoondok/worship/request` | 프리뷰 fixture, 제출 시 "준비 중" |
| `SCR-PWA-016` 가족·친구 관계 | W3-F | `/hoondok/family` | 프리뷰 fixture |

### 1.3 비범위 (유지)

- 용어 칩·TTS·판본 나란히·형광펜/노트 서버 저장(009 는 프리뷰 셸만).
- 아동 계정·소속 교회 선택·가족 초대 실동작(016 은 프리뷰 셸만).
- 푸시 알림 발송·구독(PLAN-HD-001 §7 Phase 4). 015 의 알림 4종은 disabled "준비 중".
- 권리 원장·Qdrant payload 확장·417,579 포인트 백필·읽기 코퍼스 재적재(007~009 의 실데이터 전제).
- 기존 `POST /chat/stream` SSE 스키마·프롬프트·봇 변경. `contracts/openapi.json`·생성 SDK 직접 편집.
- 배포. PLAN-HD-001 §6 잔여(VM `.env` `HOONDOK_INVITE_CODE` → `deploy-backend`, `deploy-web HOONDOK_ENABLED=1`, 실기기 증거)는 그 계획과 [롤아웃 runbook](../../runbooks/hoondok-pwa-rollout.md)이 소유한다. 이 문서의 코드는 그 배포에 실려도 플래그 2개 기본 OFF 라 화면이 늘지 않는다.
- `hoondok.css` 토큰을 `:root` 에 싣기, `globals.css`·`/design-system`·시연 챗 변경(`UI-WEB-001`). 다크 팔레트.

## 2. 플래그 2개

| 플래그 | 범위 | 기본 | 배선 | 운영 |
|---|---|---|---|---|
| `NEXT_PUBLIC_HOONDOK_ENABLED` (기존, PLAN-HD-001 결정 10) | `/hoondok/*` 라우트 전체. OFF 면 hoondok layout 이 `notFound()` | 0 | 기존 5곳 — `apps/web/.env.example`·`turbo.json` `env`·`apps/web/Dockerfile` `ARG`·`Makefile` `HOONDOK_ENABLED`·`tests/e2e/playwright.config.ts` `webServer.env` | `make deploy-web HOONDOK_ENABLED=1` 로만 ON |
| **`NEXT_PUBLIC_HOONDOK_PREVIEW`** (신규, W0-W) | W3 프리뷰 셸 라우트(`/hoondok/library`·`/search`·`/words/*`·`/worship*`·`/family`) + `TAB_STAGE` 가 `preview` 인 탭(`library`·`worship`) 활성. OFF 면 프리뷰 라우트는 `notFound()`, 탭은 `soon` 자리표시로 강등 | 0 | **3곳만** — `apps/web/.env.example`(`=0` + 주석)·`turbo.json` `env`·`tests/e2e/playwright.config.ts` `webServer.env` `"1"`. **Dockerfile·Makefile 에는 넣지 않는다** | 운영 이미지는 빌드 인자가 없어 항상 OFF(`NEXT_PUBLIC_*` 는 빌드 시 인라인). 켜려면 별도 승인 + Dockerfile·Makefile 배선 PR 이 필요하다 |

- `isHoondokPreviewEnabled()` 는 `flag.ts` 에 두고 `isHoondokEnabled() && process.env.NEXT_PUBLIC_HOONDOK_PREVIEW === "1"` 로 정의한다 — `ENABLED=0` 이면 `PREVIEW` 값과 무관하게 전부 404.
- 로컬·E2E 는 두 플래그 모두 ON 으로 돈다(playwright `webServer.env`). 플래그 OFF 경로는 Vitest(`notFound` 호출)로 단언한다(PLAN-HD-001 §9 Phase 1 선례).

## 3. 오케스트레이션 규약

1. **태스크 1건 = 격리 worktree 서브에이전트 1개.** 모델은 **기본 `opus`**(2026-09-20 사용자 결정, W1 부터 적용). 세션 모델(Fable)은 설계 판단이 큰 태스크·최종 통합 리뷰처럼 꼭 필요한 항목에만 쓴다. 브리프는 자립형(이 문서의 해당 행 + 파일 소유 규칙 + 제약 5줄 + 완료 기준 명령)이어야 하고, 에이전트는 자기 worktree 안에서만 작업하며 **push 금지**다.
2. 에이전트는 자기 브랜치에 커밋 1~N 개를 남기고 브랜치명·HEAD·변경 파일·검증 결과를 보고한다. 오케스트레이터가 diff 리뷰 → `git merge --no-ff <branch>` 로 통합 브랜치에 머지 → **머지 트리에서** 완료 기준 명령 재실행 → 이 문서 §7 진행표 체크.
3. 같은 웨이브 안의 병렬 태스크는 파일 소유가 겹치지 않아야 한다(아래 표). 겹치면 스택(선행 머지 후 `rebase --onto`)으로 바꾼다.
4. 웨이브 끝마다 통합 브랜치에서 `make ci` · `make e2e` · 시각 대조(§6)를 1회 돌리고 결과를 §8 에 문장으로 기록한다.
5. main PR 은 W4 뒤 1개. push·PR 생성은 사용자 승인 뒤(Git Safety Protocol).

### 3.1 파일 소유 규칙

| 파일 | 편집 주체 |
|---|---|
| `apps/web/src/features/hoondok/tabs.ts`, `apps/web/src/components/hoondok/app-shell.tsx`, `apps/web/src/app/hoondok.css`, `apps/web/src/app/(hoondok)/hoondok/layout.tsx`, `apps/web/src/features/hoondok/use-missions.ts`, `apps/web/src/components/hoondok/index.ts`, `tests/e2e/hoondok.spec.ts` | **W0-W 만**. 예외 2건은 오케스트레이터가 직접 1줄 커밋한다 — W2 머지 시 `TAB_STAGE.ask` `soon → live`, W4 의 `index.ts` export 정리 |
| `apps/web/src/app/_hoondok/<name>.css`(W0 가 8개 빈 파일을 만들고 layout 에서 import) | 해당 화면 에이전트만 자기 파일 1개 |
| 자기 라우트 `apps/web/src/app/(hoondok)/hoondok/<segment>/**`, 자기 feature 폴더 `apps/web/src/features/hoondok/<name>/**`, 자기 Vitest `apps/web/src/test/hoondok-<name>.test.tsx`, 자기 E2E `tests/e2e/hoondok-<name>.spec.ts` | 해당 에이전트 |
| `apps/api/**`, `contracts/openapi.json`·생성 SDK(`pnpm contracts:generate` 산출물), alembic | **W0-B 만** |
| `docs/**`(이 문서·README·TODO·스펙 결정 표) | W0-D 와 W4 |

### 3.2 UI 태스크 브리프 공통

UI 를 만드는 태스크(W1-G/S/J/N·W2·W3-L/W/F)는 스킬 `taste-skill:soft-skill` 과 `ui-ux-pro-max:ui-ux-pro-max` 를 호출해 폴리시하되, **토큰·레이아웃은 프로토타입이 우선**이다. 브리프 끝에 제약 5줄을 그대로 넣는다.

1. 값은 `docs/prd/prototypes/hoondok-ds/app.html?screen=<id>` + `hoondok.css` 가 원본이다. 스킬 제안이 프로토타입과 다르면 프로토타입을 따른다.
2. 새 폰트·색·그림자·모서리 반경을 만들지 않는다. `hoondok.css` 토큰만 쓴다(`tooling/checks/hoondok-css.mjs` 가 `:root` 0 · 토큰 밖 hex 0 · 브레이크포인트 ⊆ {768, 1024, 1224} 를 검사).
3. 모션은 4종만 — 시트 220ms · 체크 150ms · 프레스 120ms · 토글 150ms. `prefers-reduced-motion` 에서 0.
4. 아이콘은 `lucide-react`, 크기는 14·20·22·24·26·28 중 하나.
5. 라이트 단일 테마. 다크 팔레트·`.dark` 분기 금지(`DES-PWA-003` 상태 줄).

## 4. 웨이브

### W0 — 준비 (문서 · 웹 셸 · 백엔드, 병렬 3)

| 태스크 | 화면 | 내용 | 완료 기준 |
|---|---|---|---|
| W0-D 문서 | — | 이 문서 + `docs/README.md` 색인 1행 + `docs/TODO.md`(헤더·Phase 3 배포 준비 문구·PLAN-HD-002 섹션·Questions 2건) | docs-only 커밋 1개, `node tooling/checks/docs-links.mjs` 새 오류 0 |
| W0-W 웹 셸 | 공통 | `features/hoondok/flag.ts` 에 `isHoondokPreviewEnabled()` · `features/hoondok/screens.ts`(경로 → 제목·뒤로 링크·소속 탭 레지스트리, `/hoondok/read`·`/offline`·`/onboarding` 기존 3건 포함) · `tabs.ts` 에 `TAB_STAGE = { today: "live", garden: "live", ask: "soon", library: "preview", worship: "preview" }` 와 `isDisabled` 파생(`soon` 항상, `preview` 는 플래그 OFF 시) · `app-shell.tsx` 를 레지스트리 기반으로(제목·뒤로·활성 탭을 pathname 하드코딩 대신 `screens.ts` 조회) · `layout.tsx` 에 `src/app/_hoondok/{garden,settings,sheet,note,ask,library,worship,family}.css` 8개 import(W0 는 주석 1줄 빈 파일 생성) · `hoondok.css` 토큰 `--scrim`(시트 배경막) 추가 · `garden`·`settings` 자리표시 페이지(`.empty` 카드, W1 이 본문 교체) · `features/hoondok/query-keys.ts`(`SUMMARY`·`HISTORY(month)`·`JEONGSEONG`) + `use-missions.ts` 완료 성공 시 3키 invalidate · `tooling/checks/hoondok-css.mjs` 가 `apps/web/src/app/_hoondok/*.css` 도 같은 규칙으로 검사 · `apps/web/.env.example`·`turbo.json`·`tests/e2e/playwright.config.ts` 에 `NEXT_PUBLIC_HOONDOK_PREVIEW` 배선(§2) | `pnpm hoondok:check`·`pnpm tooling:test`(검사 테스트 추가) · Vitest: `TAB_STAGE` 3상태 × 플래그 ON/OFF, `screens.ts` 조회(미등록 경로 폴백), 프리뷰 플래그 OFF 시 `notFound` · 기존 `hoondok.test.tsx`·E2E `hoondok.spec.ts` green(탭 라벨·활성 탭 단언 유지) · typecheck·lint·build 라우트에 `/hoondok/garden`·`/hoondok/settings` ƒ 추가만 |
| W0-B 백엔드 | — | `ENT-HD-004 jeongseong_periods`(id·user_id FK·`duration_days` 7/21/40 앱 검증(Literal)·`topic` varchar·`started_on` date·`reminder_time` time nullable(표시용)·`status` varchar `active/completed/abandoned`·`created_at`·`ended_at` nullable; **사용자당 active 1건 부분 unique** `(user_id) WHERE status='active'`) alembic `k5a6b7c8d9e0`(`j3f4a5b6c7d8` 다음, PLAN-HD-001 §3 additive-only) · `API-HD-009` `GET /hoondok/me/jeongseong`(active 1건 + 진행 = 기간 내 `read` 완료 일수·밀린 날 수, `today_kst` 기준 계산·미저장, 종료일 경과 시 `completed` 자동 전환) · `POST`(201, active 존재 409, `duration_days`·`started_on`(오늘~+30) 422) · `DELETE`(active → `abandoned`, 204; 없으면 404) · `API-HD-010` `GET /hoondok/me/history?month=YYYY-MM`(`month` 생략 시 오늘 KST 의 월, `WeekDay[]` 재사용 · `read` 완료 기준 · 형식 오류·연도 2020~올해+1 밖 422) · `API-HD-011` `DELETE /hoondok/auth/me`(`deleted_at` 기록 + 이메일 `deleted:{id}` 익명화 + 본인 `mission_logs`·`jeongseong_periods` 삭제 + 쿠키 삭제, 204, `verify_csrf`) · `hoondok-api.md`·`hoondok-entities.md` 에 항목 추가 · `pnpm contracts:generate` | pytest: 부분 unique(active 2건 409, abandoned 후 재생성 201)·진행 계산 순수 함수(빈·오늘 완료·밀림·기간 종료 자동 completed·오늘은 밀린 날 아님)·history 월 경계(KST 1일 00:00·말일 23:59)·`month` 형식 422·삭제 후 `me` 401·같은 이메일 재가입 201·`admin_token` 만 가진 요청 401(PLAN-HD-001 Phase 2 B 선례) · `contracts:check` 하위 호환(추가만) · additive-only 리허설(`k5a6b7c8d9e0` 적용 DB 위에 main `aba5240` 백엔드 기동, PLAN-HD-001 §3-4) |

### W1 — 실데이터 화면 (데이터 계층 1 → 병렬 4)

| 태스크 | 화면 | 내용 | 완료 기준 |
|---|---|---|---|
| W1-D 데이터 계층 | — | `features/hoondok/jeongseong-api.ts`·`use-jeongseong.ts`(query + create·cancel mutation, 401 → `null`) · `features/hoondok/history-api.ts`·`use-history.ts(month)` · `features/identity/api.ts` 에 `deleteMe()` + `useCurrentUser` 무효화. 전부 생성 SDK 타입 사용, `query-keys.ts` 키 재사용 | Vitest `hoondok-data.test.tsx`: 401 → null·5xx → error·빈 응답·409 매핑·삭제 후 `me` 캐시 null · typecheck |
| W1-G 014 나의 정원 | `SCR-PWA-014` | `/hoondok/garden`(로그인 게이트 401 → `/hoondok/onboarding?returnTo=`): 프로필(이름·가입일, 대표 말씀은 오늘 말씀 제목 재사용 `[가정]`) · `.stats` 3(연속일·최대·누적, `summary`) · 월 달력 `features/hoondok/garden/month-calendar.tsx`(`history`, 이전/다음 달, 완료일 체크 원, 오늘 테두리, 형태로 구분 §3.3) · 진행 중인 정성 카드(`jeongseong`, 없으면 "정성 시작하기" → `?sheet=jeongseong` 홈으로) · 가족·친구 섹션은 **W3-F 프리뷰 링크만** · CSS 는 `_hoondok/garden.css` | Vitest `hoondok-garden.test.tsx`: 달력 월 경계·완료/미완료/오늘 셀·비로그인 게이트·정성 없음 상태 · E2E `hoondok-garden.spec.ts`: 시드 사용자 로그인 → 정원 진입 → stats·이번 달 달력에 완료 표시 → 390/1280 넘침 0·콘솔 0 |
| W1-S 015 알림·설치 설정 | `SCR-PWA-015` | `/hoondok/settings`(로그인 게이트): 설치 카드 **상시 렌더**(`use-install-card` 재사용, standalone 이면 "설치됨" 행) · 알림 4종 토글 **disabled + "준비 중"** 라벨(Phase 4) · 잠금 화면 문구 수준 표시(disabled) · 조용한 시간 disabled · 로그아웃 · **내 데이터 삭제 2단계**(1단계 행 → 2단계 확인 시트 `.sheet` 에 삭제 범위 문장 + "삭제" 버튼 → `deleteMe()` → `/hoondok` 이동, 실패 인라인 오류) · CSS `_hoondok/settings.css` | Vitest `hoondok-settings.test.tsx`: disabled 토글 클릭 무동작·삭제 1단계만으로 API 미호출·2단계 확인 후 호출·실패 오류 표시·standalone 설치됨 · E2E `hoondok-settings.spec.ts`: **신규 가입 사용자**(시드 사용자 삭제 금지) → 설정 → 삭제 2단계 → `/hoondok/auth/me` 401 → 같은 이메일 재가입 201 |
| W1-J 004 정성 시트 + 002 홈 카드 | `SCR-PWA-004`·`002` | `features/hoondok/jeongseong/jeongseong-sheet.tsx`: `<dialog class="sheet">` + URL `?sheet=jeongseong`(프로토타입과 같은 쿼리, 뒤로가기로 닫힘, `--scrim` 배경막, 220ms) · 기간 세그먼트 7/21/40 · 주제 칩(프로토타입 목록) · 시작일(오늘 기본, 과거 금지) · 알림 시각(표시·저장만, 발송 없음 안내) · 가족 챌린지 토글 **생략** · 홈 `/hoondok` 정성 카드: active 있으면 `n/N 일`·밀린 날, 없으면 "정성 시작하기" → 시트, 비로그인은 시트 열기 전 온보딩 게이트 · CSS `_hoondok/sheet.css` | Vitest `hoondok-jeongseong.test.tsx`: 시트 열기/닫기(URL)·검증(과거 시작일)·409 → 기존 정성 안내·생성 후 홈 카드 갱신 · E2E `hoondok-jeongseong.spec.ts`: 로그인 → 홈 카드 → 시트 21일 → 생성 → 홈 `1/21`(오늘 완료 시) → 정원에도 표시 → 390/1280 넘침 0 |
| W1-N 003 오늘의 한 줄 | `SCR-PWA-003` | `/hoondok/read` 하단 `features/hoondok/note/today-note.tsx`: textarea 200자(카운터), localStorage `hoondok:note:<KST YYYY-MM-DD>` **기기 전용**(서버 미전송, 안내 문구 1줄), 날짜 바뀌면 빈 칸, 깨진 값·던지는 저장소 무시 · CSS `_hoondok/note.css` | Vitest `hoondok-note.test.tsx`: 200자 절단·KST 날짜 키·자정 전환·저장소 예외 · 기존 E2E `hoondok.spec.ts` 완료 흐름 유지(spec 편집 없이) |

W1 완료 기준: 통합 브랜치에서 `make ci` · `make e2e`(`hoondok-chromium` 에 spec 3개 추가) 통과 · 시각 대조(§6) 014·015·004·002·003 을 390·1280 에서 프로토타입과 나란히 보고 차이를 §8 에 문장으로 기록.

### W2 — AI 질문 3화면

| 태스크 | 화면 | 내용 | 완료 기준 |
|---|---|---|---|
| W2 AI 질문 | `SCR-PWA-005`·`006` | `/hoondok/ask` 물음 한 장(오늘 말씀 한 줄 + 라벨 있는 입력 + 시작 문장 3개가 입력을 채움, FAB 없음 — `DES-PWA-003` §8 2026-09-16) · `/hoondok/ask/log` 기록(localStorage 나열·삭제) · `/hoondok/ask/[id]` 상세(AI 설명·근거 말씀·이어지는 질문 = 새 질문) · `read` 화면에 "이 말씀에 질문하기" → `/hoondok/ask?ref=<reading id>` 프리필 · **어댑터** `features/hoondok/ask/stream.ts`: 기존 `POST /api/backend/chat/stream` SSE(`chunk → sources → done`) 소비, **`session_id` 미전송 = 무기억**, `chatbot_id` 는 기존 기본 봇 슬러그 `[확인 필요]` · **근거 게이트**: `sources` 0건이면 답 미표시 + "근거 말씀을 찾지 못했어요" 상태 · 질문·답·근거는 localStorage `hoondok:ask:<id>` 만(서버 저장 없음, `search_events` 등 기존 서버 기록은 시연 챗과 동일) · `_hoondok/ask.css` | Vitest `hoondok-ask.test.tsx`: SSE 파서(분할 청크·순서)·근거 0건 게이트·`session_id` 미포함 단언·localStorage 기록/삭제·`ref` 프리필 · E2E `hoondok-ask.spec.ts`: `page.route` 로 SSE 스텁(실 LLM 호출 0 — CI 비용 원칙) → 질문 → 상세 → 기록 → 근거 0건 스텁 → 답 미표시 · 머지 시 오케스트레이터 1줄 `TAB_STAGE.ask: "live"` · `make ci`·`make e2e` |

`[확인 필요]` 훈독 전용 봇·시스템 프롬프트. 기본값은 **기존 기본 봇 재사용**(프롬프트·`/chat/stream` 스키마 변경 없음). `[가정]` 베타 10~20명 규모에서 기존 Gemini 한도 안이다. `[가정]` `hoondok_token` 쿠키는 `/chat/stream` 에서 익명 요청으로 취급된다(`get_optional_user_id` 는 `admin_token` 만 읽음) — 세션 소유 403(`SEC-MONO-001`)은 `session_id` 를 보내지 않으므로 발생하지 않는다.

### W3 — 정적 프리뷰 셸 (`NEXT_PUBLIC_HOONDOK_PREVIEW=1` 뒤, 병렬 3)

공통: 상단 `.notice` "미리보기 예시 데이터입니다" · fixture 는 `features/hoondok/preview/fixtures/<name>.ts`(프로토타입 예시 문장 그대로, 실명·실교회 금지) · 플래그 OFF 면 각 페이지가 `notFound()` · 입력·제출은 "준비 중" 인라인(네트워크 0) · noindex 는 기존 `/hoondok/*` `X-Robots-Tag`·layout 메타로 이미 충족.

| 태스크 | 화면 | 내용 | 완료 기준 |
|---|---|---|---|
| W3-L 말씀 | `SCR-PWA-007`·`008`·`009` | `/hoondok/library`(저작물·권·최근 읽기) · `/hoondok/search`(검색 필드 마크업, 결과 fixture, 0건 안내) · `/hoondok/words/[id]`(원문·AI 설명·노트 세그먼트, ≥1224px 2-pane `DES-PWA-003` §4.3, 형광펜·북마크는 표시만) · `_hoondok/library.css` | Vitest `hoondok-library.test.tsx`: 플래그 OFF `notFound`·0건 상태·미존재 id · E2E 는 아래 공통 |
| W3-W 가정예배 | `SCR-PWA-010`~`013` | `/hoondok/worship`(이번 주 순서지·챌린지 목록) · `/hoondok/worship/challenge/[id]`(진행률·참여 인원만 — `DEC-PWA-019` 랭킹 없음) · `/hoondok/worship/sermons`(교회장 행·이번 주·인기) · `/hoondok/worship/request`(폼, 제출 시 "준비 중") · `_hoondok/worship.css` | Vitest `hoondok-worship.test.tsx`: 폼 제출 네트워크 0·"준비 중"·플래그 OFF |
| W3-F 가족·친구 | `SCR-PWA-016` | `/hoondok/family`(가족 초대·관계·친구 목록·공개 범위 — 전부 표시만) + 정원의 가족·친구 섹션 링크 대상 · `_hoondok/family.css` | Vitest `hoondok-family.test.tsx`: 플래그 OFF·초대 버튼 네트워크 0 |

W3 완료 기준: E2E `tests/e2e/hoondok-preview.spec.ts` — 세 에이전트가 같은 spec 을 건드리지 않도록 **오케스트레이터가 W3 머지 후 라우트 9개를 한 spec 에 등록**한다 — 라우트 × 390/1280 가로 넘침 0 · 콘솔 오류 0 · `x-robots-tag: noindex` · `.notice` 존재 · `make ci`·`make e2e` · 시각 대조 §8.

`[확인 필요]` `DEC-PWA-020`(가정예배 정식 명칭·순서지 편성 주체)·`DEC-PWA-021`(설교 섭외 운영 주체) 미결 → 010~013 은 셸만. 실데이터·API 는 결정 뒤 별도 계획.

### W4 — 마무리

| 태스크 | 화면 | 내용 | 완료 기준 |
|---|---|---|---|
| W4 마무리·PR | — | `components/hoondok/index.ts` export 정리(새 공용 컴포넌트만) · `DES-PWA-003` §8 결정 행(`--scrim`·`_hoondok/*.css` 배치·프리뷰 플래그) · `apps/web/AGENTS.md` 라우트·소유 문단 갱신 · `docs/TODO.md` · 이 문서 §7 전부 체크 + §8 완료 증거 · 스펙 결정 표(API·ENT) | `make ci` · `make e2e` · `node tooling/checks/docs-links.mjs` 새 오류 0 · 사용자 승인 후 push · main PR 1개(제목에 PLAN-HD-002) |

## 5. 소요 추정

| 웨이브 | 에이전트 작업 | 비고 |
|---|---|---|
| W0 | 0.5일 | D·W·B 병렬 |
| W1 | 1.5일 | D 뒤 G·S·J·N 병렬 |
| W2 | 1일 | 단일 |
| W3 | 1.5일 | L·W·F 병렬 |
| W4 | 0.5일 | 오케스트레이터 |
| 합계 | **~5일** | 병렬 벽시계 **~3일** `[가정: 리뷰·머지 대기 제외]` |

## 6. 검증 명령

```bash
# 문서
node tooling/checks/docs-links.mjs
# 훈독 CSS 스코프 (W0-W 이후 _hoondok/*.css 포함) + 검사 도구 자체 테스트
pnpm hoondok:check
pnpm tooling:test
# web 단독
pnpm --filter @truewords/web test
pnpm --filter @truewords/web typecheck
pnpm --filter @truewords/web lint
pnpm --filter @truewords/web build
# 전체 (API pytest · contracts · tooling · docs · boundaries · web/admin test/lint/build/typecheck)
make ci
# 통합 E2E (격리 compose + 시드, 플래그 2개 ON dev 서버). 훈독 프로젝트만:
pnpm test:e2e --project hoondok-chromium
make e2e
```

시각 대조 절차(웨이브 끝 1회, 결과는 §8 에 **문장으로만**, 캡처 미커밋):

1. 프로토타입 서버 — `cd docs/prd/prototypes/hoondok-ds && python3 -m http.server 4173`, 화면은 `http://localhost:4173/app.html?screen=<id>`(`sheet=jeongseong` 은 홈 위에 열림).
2. dev 서버 — `apps/web` 에서 `NEXT_PUBLIC_HOONDOK_ENABLED=1 NEXT_PUBLIC_HOONDOK_PREVIEW=1 pnpm dev`(백엔드는 `make e2e` 의 격리 compose 또는 로컬 :8001).
3. 폭 390·1280 두 가지로 같은 화면을 나란히 보고 간격·타이포·색·아이콘 크기·모션 차이를 확인한다. 차이는 프로토타입 쪽이 정답이며, 프로토타입의 결함이면 `DES-PWA-003` §8 에 결정 1줄 뒤 프로토타입을 고친다.

## 7. 진행표

- [x] W0-D 계획 문서(이 문서·README·TODO) — 2026-09-19, 이 PR
- [x] W0-W 웹 셸 — 2026-09-19 머지 `1f51339`, Vitest 120·tooling 24·hoondok:check 9파일 (`flag.ts`·`screens.ts`·`TAB_STAGE`·`app-shell` 레지스트리·`_hoondok/*.css` 8개·`--scrim`·자리표시 2·`query-keys.ts`·`hoondok-css.mjs`·프리뷰 플래그 배선 3곳)
- [x] W0-B 백엔드 — 2026-09-19 머지 `2e08806`, pytest 1037/4/1 · alembic head `k5a6b7c8d9e0` · oasdiff breaking 0 · additive-only 리허설은 W1 끝에 (`ENT-HD-004`·`k5a6b7c8d9e0`·`API-HD-009/010/011`·SDK 재생성·additive-only 리허설)
- [x] W1-D 데이터 계층 — 2026-09-20 머지 `1ba5a26`, Vitest 137 (jeongseong/history/kst/use-delete-me)
- [x] W1-G 014 나의 정원 — 2026-09-20 머지 (MonthCalendar·통계 3·진행 중인 정성; `.stats/.progress` 는 garden.css 에 위치 → W4 공통 승격 검토)
- [x] W1-S 015 알림·설치 설정 + 내 데이터 삭제 — 2026-09-20 머지 (InstallCard isAlwaysVisible·알림 4종 disabled·삭제 2단계; 560px 중앙은 앱 셸 720 유지 `[가정]`)
- [x] W1-J 004 정성 시트 + 002 홈 정성 카드 — 2026-09-20 머지 (dialog `?sheet=jeongseong`, ≥1024 모달 520px 실측, 비로그인은 안내+로그인 링크)
- [x] W1-N 003 오늘의 한 줄 — 2026-09-20 머지, Vitest 143 (note storage·TodayNote)
- [x] W1 웨이브 끝 `make ci`·`make e2e`·시각 대조 — `make ci` 2차 통과(`f1eeb8c`) · `make e2e` 64 passed(`1cb2157`, W2 포함 재실행) · 시각 대조 §8
- [x] W2 AI 질문 3화면 + `read` 질문 버튼 + `TAB_STAGE.ask: live` — 2026-09-20 머지 `b2772d4`, Vitest 183 (어댑터 `ask/ask-stream.ts` 무기억·근거 게이트 · 저장 `hoondok:ask:items` 단일 배열 50건 · 프리필은 `?q=` — §4 표의 `?ref`·키별 저장에서 정정 · 챗봇 슬러그 `all` §9 · `.toggle` 공용 승격 `3438a32`)
- [x] W2 웨이브 끝 — `make e2e` 64 passed(`1cb2157`) · 시각 대조 §8 완료. `make ci` 는 W3 머지 뒤 한 번에 돌린다(웹 단독 변경이라 백엔드·계약 재검증이 중복)
- [x] W3-L 007·008·009 말씀 프리뷰 — 2026-09-20 머지, 라우트 `/hoondok/library`·`/search`·`/words/[id]`. 원문은 `PREVIEW_WORD_ID = "cheonseonggyeong-1-3"` 한 편만(`screens.ts` 제목 고정 때문 — §7 아래 미결 참고). 검색 입력은 앱바가 아니라 본문 첫 줄 `[가정]`
- [x] W3-W 010~013 가정예배 프리뷰 — 2026-09-20 머지, 라우트 `/hoondok/worship`·`/challenge/[id]`·`/sermons`·`/request`. 챌린지 fixture `family-21`·`church-40`·`youth-reading`. 프로토타입 011 에 순위 요소가 원래 없어 DEC-PWA-019 는 삭제 0건(회귀 단언만 추가). 외부 사진(picsum) 은 글자 카드·이니셜로 대체 `[가정]`
- [x] W3-F 016 가족·친구 프리뷰 — 2026-09-20 머지, 라우트 `/hoondok/family` + 정원 진입 섹션(프리뷰 ON·로그인 시만). **공개 범위는 라디오 4가 아니라 토글 2 + 고정 1** — 프로토타입 `.fm-scope` 가 그렇고 4단계 문구는 어느 문서에도 없다 `[확인 필요]`
- [ ] W3 `hoondok-preview.spec.ts` **라우트 8개**(§4 의 9개에서 정정 — library·search·words·worship·challenge·sermons·request·family) + CSS 공통 승격 정리 + 웨이브 끝 `make ci`·`make e2e`·시각 대조
- [ ] W4 `index.ts`·DES §8·AGENTS.md·TODO·§8 완료 증거
- [ ] 사용자 승인 → push → main PR 1개

## 8. 완료 증거

웨이브별 실행 결과를 여기에 기록한다. PLAN-HD-001 §9 마지막 기준선(pytest 1018 passed / 4 skipped / 1 xfailed, web Vitest 114, E2E 53)은 참고값이며 현재 결과로 복사하지 않는다.

| Phase | 검증 | 결과 | 날짜 |
|---|---|---|---|
| W0-D | `node tooling/checks/docs-links.mjs` (격리 worktree, `40c8563` 위) | 문서 188 · 링크 305 · 새 오류 0 | 2026-09-19 |
| W0-W | web Vitest · typecheck · `pnpm hoondok:check` · `pnpm tooling:test` (머지 `1f51339`) | 120 passed(+6) · 통과 · 9파일 통과 · 24 pass. `next build` 라우트 ON/OFF 동일(런타임 `notFound` 게이트) | 2026-09-19 |
| W0-B | pytest 전체 · `alembic heads` · `pnpm contracts:check` (머지 `2e08806`) | 1037 passed / 4 skipped / 1 xfailed(+19) · `k5a6b7c8d9e0` 단일 · oasdiff breaking 0(path 5·스키마 5 추가만) | 2026-09-19 |
| W0-B 리뷰 | 읽기 전용 코드 리뷰(Fable) → P2 5건 보강(opus, 머지 `774140d`) | P0·P1 없음. 신규 pytest 2건(409 폴백·삭제 원자성 — 변이 테스트로 반증 가능성 실증) → 1039 passed | 2026-09-20 |
| W1-D | web Vitest (머지 `1ba5a26`) | 137 passed(+17): jeongseong/history API·훅, `kstMonthKey`·`monthGrid`, `useDeleteMe` | 2026-09-20 |
| W1-N·S·G·J | web Vitest · typecheck · lint · `hoondok:check` · `format:check` (4 머지 누적) | **168 passed**(+31) · 통과 · 경고 10건 전부 기존 파일 · 9파일 통과 · 273 files 통과 | 2026-09-20 |
| W1 CSS 정리 | `.stats·.progress` 공통 승격 + 검사기 `@media` 한정 (머지 `9b70751`) | Vitest 168 유지 · tooling 26 pass · 정원 `.stats` 여백이 sheet 값(14)에 덮이던 캐스케이드 해소 | 2026-09-20 |
| W1 E2E | `hoondok-chromium` 외부 서버 모드(dev 서버 + 격리 DB 시드) → `make e2e` 전체 | 외부 모드 17+3 passed(셀렉터 충돌 2건 수정: `role=status` 중복·"알림" 헤딩 exact). `make e2e` **60 passed / 1 failed** — 실패 1건은 설정 spec 의 "준비 중" 카운트가 프리뷰 플래그 OFF 의 탭 내비 문구까지 센 취약 단언 → `main` 스코프로 정정(`f1eeb8c`), 재실행은 W2 웨이브 끝에 함께 | 2026-09-20 |
| W1 시각 대조 | 프로토타입 :4173 ↔ dev :3000, 390·1280 | 홈·훈독하기(오늘의 한 줄)·설정·정원·정성 시트(390 하단 시트 / 1280 중앙 모달 520px 실측) 구조·문구·순서 일치. 프로토타입 정본에 달력·시트 라디오 CSS 가 없어(`.gd-*`·`.st-*` 0건) 구현은 DES-PWA-003 §2.6·§2.7 값으로 보완 — 스크린샷은 미커밋 | 2026-09-20 |
| W1 `make ci` 1차 | 전체 | admin `next build` 가 Google Fonts(`noto_serif_kr`) fetch 실패로 중단 — 네트워크 일시 오류(단독 재빌드 통과). 2차 실행 결과는 아래 행 | 2026-09-20 |
| W1 `make ci` 2차 | 전체 (HEAD `f1eeb8c`) | **통과** — pytest 1039/4/1 · contracts 하위 호환 · tooling 26 · docs-links · boundaries · hoondok:check 9파일 · web Vitest 168 · admin 104 · lint 경고 web 10·admin 3 전부 기존 파일 · web·admin `next build` 성공 · typecheck | 2026-09-20 |
| W2 E2E | `make e2e` 전체 (머지 `b2772d4` + `.toggle` 승격 `3438a32`) | 1차 **62 passed / 2 failed** — 둘 다 spec 취약 단언: ① `hoondok-ask` 요청 건수 1 단언이 dev StrictMode 이중 마운트(첫 요청 abort)로 2 → 모든 요청의 무기억(`session_id` 없음)·`chatbot_id: all` 로 정정 ② `admin-flow` 목록 제목 `getByText` 가 Next route announcer 와 중복 매치 → heading 역할. 정정 `1cb2157` → 2차 **64 passed**(1.7m) | 2026-09-20 |
| W2 시각 대조 | 프로토타입 :4173 `?screen=ask|ask-log|ask-detail` ↔ dev :3000, 390·1280 | 묻기 홈(라벨·textarea·도움말·시작 문장 3·기록 링크·notice)·기록(pill 세그먼트 3 + 준비 중 문구·목록·notice)·상세(질문·배지·AI 설명 점 패턴 박스·근거 카드 번호·이어 묻기·저장 토글·공유) 구조·순서 일치. 1280 `col--read` 640px 실측, 가로 넘침 0. 프로토타입 정본에 `.qs-*`·`.ql-*`·`.ask-*` CSS 가 없어(`.ai-note` 만 존재) 구현은 DES §2.2·§2.10·§2.11 값으로 보완, 질문 제목은 `text-wrap: balance` `[가정]`. 연관 말씀·권위 배지는 `/chat/stream` 미제공으로 미렌더(§9). `make ci` 는 W3 머지 뒤 한 번에 | 2026-09-20 |

## 9. 결정 기록

| 날짜 | 결정 | 상태 |
|---|---|---|
| 2026-09-19 | **웨이브형 채택** — 실데이터 화면(W1) → AI 질문(W2) → 정적 프리뷰 셸(W3) 순. 일괄 포팅·화면 번호순 포팅 안 미채택. PLAN-HD-001 §2.3 첫 항목 개정 | 확정 · 사용자 |
| 2026-09-19 | **로컬 통합** — 태스크 = 격리 worktree 서브에이전트, 브랜치 `claude/hundok-webapp-ui-implementation-e71e67` 에 `--no-ff` 로컬 머지, main PR 1개는 승인 시. 통합 브랜치 `dev/*` + sub-PR 흐름(PLAN-HD-001 §5~§6)은 이번엔 쓰지 않는다 | 확정 · 사용자 |
| 2026-09-19 | **디자인 스킬** — UI 태스크는 `taste-skill:soft-skill` + `ui-ux-pro-max` 호출, 단 토큰·레이아웃은 프로토타입 우선(§3.2 제약 5줄) | 확정 · 사용자 |
| 2026-09-19 | **계정 삭제** = `users.deleted_at` 기록 + 이메일 `deleted:{id}` 익명화(같은 이메일 재가입 허용) + 본인 `mission_logs`·`jeongseong_periods` 물리 삭제 + 쿠키 삭제. `users` 행은 남긴다(감사·unique 충돌 회피). PLAN-HD-001 §5·§10 "계정 삭제 비범위" 개정 | `[가정]` · W0-B · TODO Questions |
| 2026-09-19 | **정성** = 사용자당 active 1건(부분 unique). 진행은 기간 내 `read` 완료 일수로 조회 시 계산·미저장(`mission_logs` 가 원본). **오늘은 밀린 날이 아니다**(자정 전까지 완료 가능). 종료일 경과 시 조회 때 `completed` 자동 전환. 그만하기는 `abandoned`(행은 남김). `percent` 는 half-up 정수 반올림, 끝난 active 는 GET·POST·DELETE 어느 경로든 읽는 시점에 `completed` 로 정리 | `[가정]` · W0-B |
| 2026-09-19 | **오늘의 한 줄** = 기기 전용 localStorage `hoondok:note:<KST>` 200자, 서버 미전송. 계정 간 동기화는 비범위 | `[가정]` · W1-N |
| 2026-09-19 | **알림 4종 disabled** "준비 중" — 발송·구독은 PLAN-HD-001 §7 Phase 4. 015 는 설치 카드·데이터 삭제·로그아웃만 동작 | 확정 · W1-S |
| 2026-09-19 | **AI 질문 봇** — 훈독 전용 봇·시스템 프롬프트 여부 미정. 기본값 = 기존 기본 봇 재사용 — 구현값 `HOONDOK_ASK_CHATBOT_ID = "all"`(시연 챗 운영 기본값. 시드 `malssum_priority` 는 티어 임계 0.75 가 RRF 점수 범위 0~0.5 위라 근거 0건 상시화 위험), 무기억(`session_id` 미전송), 근거 게이트(`sources` 0건 → 답 미표시), 기록은 localStorage | `[확인 필요]` · W2 · TODO Questions |
| 2026-09-19 | **가정예배·설교는 셸만**(`DEC-PWA-020/021` 미결). 007~009 도 권리 원장·백필 전이라 셸만. 전부 `NEXT_PUBLIC_HOONDOK_PREVIEW` 뒤, 운영 이미지 미배선 | `[확인 필요]` · W3 |
| 2026-09-19 | **CSS 배치** = `hoondok.css`(토큰·셸·공용 컴포넌트) + `apps/web/src/app/_hoondok/<name>.css`(화면별, 언더스코어 private 폴더 — `app/hoondok/` 은 라우트 세그먼트와 충돌하므로 불가). 8개 파일은 W0 가 만들고 hoondok layout 이 import, 검사는 `hoondok-css.mjs` 가 같은 규칙으로 | 확정 · W0-W |
| 2026-09-19 | **공유 파일 소유** — `tabs.ts`·`app-shell.tsx`·`hoondok.css`·`layout.tsx`·`use-missions.ts`·`index.ts`·`hoondok.spec.ts` 는 W0/W4 만. 예외는 오케스트레이터 1줄 커밋 2건(W2 `ask: live`, W4 export) | 확정 · §3.1 |
