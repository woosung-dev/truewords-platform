# 사용자 웹 — Next.js

- `/`, `/history`, `/about`, `/design-system`, `/login`, `/hoondok/*`을 소유한다. 관리자 화면은 `apps/admin`이다.
- `/hoondok/*`(훈독)은 `NEXT_PUBLIC_HOONDOK_ENABLED=1` 일 때만 존재하고 AuthGuard 를 쓰지 않는다. 토큰·컴포넌트는 `src/app/hoondok.css`(`[data-app="hoondok"]` 스코프)·`src/components/hoondok`·`src/features/hoondok` 이 소유하고, 계정(쿠키 `hoondok_token`, `/hoondok/onboarding?returnTo=`)은 `src/features/identity` 가 소유한다(`features/auth`·`lib/api.ts` 의 `/login` 이동과 분리). 비로그인 완료 체크는 localStorage 에 KST 날짜 키로 두고 로그인 후 당일분만 소급한다. PWA 정적 자산(manifest·아이콘·self-host 폰트)은 `public/hoondok/` 에 두고 hoondok layout 의 `generateMetadata`·`generateViewport` 로만 연결한다(루트 layout 무변경). 설치 안내 카드(PLAN-HD-001 Phase 3 E)는 `src/features/hoondok/install/` 이 소유한다 — localStorage 3키 `hoondok:install:eligible`·`hidden-until`·`installed`, `beforeinstallprompt` 는 hoondok layout 의 리스너가 잡고, 카드는 홈에서 직접 완료가 처음 기록된 뒤에만 조건 렌더한다(소급 제외). `globals.css`·`:root`·`/design-system` 을 바꾸지 않는다. 검사는 `pnpm hoondok:check`, 계획은 [PLAN-HD-001](../../docs/plans/active/2026-09-17-hoondok-mvp.md)·[PLAN-HD-002](../../docs/plans/active/2026-09-19-hoondok-screens.md).
  - 라우트는 두 종류다. **실데이터**: `/hoondok` · `/read` · `/ask`·`/ask/log`·`/ask/{id}` · `/garden` · `/settings` · `/onboarding` · `/offline` · `/library` · `/search` · `/words/{volume}`. 말씀 3화면은 권리 허용 데이터만 보여주고 `chunk_id` 쿼리로 근거가 있는 구간을 연다.
  - **프리뷰 셸**: `/worship` · `/worship/challenge/{id}` · `/worship/sermons` · `/worship/request` · `/family` — 5개는 fixture·네트워크 요청 0·상단 미리보기 안내를 유지한다. `NEXT_PUBLIC_HOONDOK_PREVIEW=1`이 이 5라우트와 가정예배 탭만 켠다. 말씀 탭·검색은 프리뷰 플래그와 무관하다. 운영 Dockerfile·Makefile에는 프리뷰 플래그를 넣지 않는다.
  - 정성은 공개 SSR 뒤 로그인 클라이언트가 오늘 정성 추출 말씀으로 교체하며 홈/read가 동일 쿼리를 소비한다. 달력 기준 7·21·40일 기간은 유지한다. 홈 훈독하기는 즉시 완료, 말씀 읽기는 서고 진입 뒤 원문 하단 읽음 버튼으로 `study` 완료, 기도하기는 비활성이다.
  - 오류 수집은 hoondok layout에만 설치하며 안전한 kind·정규화 경로만 보낸다. 질문·검색어·예외 원문·토큰을 수집하거나 보고 실패를 다시 보고하지 않는다.
  - AI 질문은 신규 엔드포인트 없이 시연 챗과 같은 `POST /chat/stream` 을 재사용한다(`features/hoondok/ask/ask-stream.ts`, 봇 슬러그 상수 `HOONDOK_ASK_CHATBOT_ID`). 다른 점은 `session_id` 미전송(무기억)과 `sources` 0건이면 답을 보이지 않는 근거 게이트뿐이고, 질문·답은 서버에 저장하지 않고 localStorage 한 키 `hoondok:ask:items`(최대 50건)에만 둔다.
  - 화면별 앱바 제목·뒤로 링크·탭 귀속·본문 폭(`app__main--home|read|app`)은 `features/hoondok/screens.ts` 레지스트리 한 곳이 소유하고(값은 프로토타입 `TITLES`·`TAB_OF`) 앱 셸이 `screenFor(pathname)` 으로 읽는다. 새 화면은 여기에 한 줄 추가하고 `tabs.ts`·`app-shell.tsx` 는 건드리지 않는다.
  - 공용 컴포넌트는 배럴 `src/components/hoondok/index.ts` 로만 가져온다(`HoondokAppShell`·`HoondokButton`·`MalssumCard`·`MissionCard`·`WeekStrip`·`MonthCalendar`·`monthLabel`·`AuthorityBadge`). 화면 그룹 CSS 는 `src/app/_hoondok/{garden,settings,sheet,note,ask,library,worship,family}.css` 8개에 두고 hoondok layout 이 `hoondok.css` 뒤에 고정 순서로 import 한다. 토큰(hex)은 `hoondok.css` 첫 블록에만 있고 보조 파일은 `[data-app="hoondok"]` 스코프 + `var()` 만 쓴다 — `pnpm hoondok:check` 가 전 파일을 검사한다. 진행 상태 쿼리 키는 `features/hoondok/query-keys.ts`(`PROGRESS_KEYS` 로 완료 시 일괄 무효화).
- 시연 챗은 기존 시연 계정 인증, 훈독은 `features/identity` 일반 사용자 인증(Phase 2)이다. 훈독 서비스워커는 `public/hoondok/sw.js`(scope `/hoondok`·`Service-Worker-Allowed`, 오프라인 안내 폴백만, `/api/backend/*`·온보딩·인증 응답 캐시 금지, `SW_KILL` 킬스위치, PLAN-HD-001 Phase 3 D)이고 hoondok layout 에서만 등록한다 — 시연 챗 `/` 는 SW 미제어. 알림(PLAN-HD-006)은 `src/features/hoondok/notifications/` 가 소유한다 — 실제로 켜고 끄는 것은 "훈독하기" 1종뿐이고(`/hoondok/settings`), 서버 `GET /hoondok/push/config` 가 꺼져 있으면 나머지 3종과 같은 "준비 중" 이며, sw.js 의 `push`·`notificationclick` 이 알림 하나(태그 `hoondok-read`)를 띄우고 열린 `/hoondok` 창을 재사용한다.
- 앱 간 이동은 `NEXT_PUBLIC_ADMIN_URL`, API는 같은 origin의 `/api/backend` 프록시를 사용한다. 계정 쿠키를 다른 hostname으로 복사하지 않는다.
- 제품 업무·권한은 FastAPI에 둔다. 생성 DTO/SDK는 `@truewords/api-client-ts`, 공통 검사 설정은 `@truewords/eslint-config`·`@truewords/typescript-config`를 사용한다.
- UI·테마·표시 유틸은 이 앱의 `src/components/ui`, `src/app/globals.css`, `src/lib/utils.ts`가 소유한다. `@/components/ui/*`, `@/lib/utils`를 사용하며 관리자 앱의 UI·CSS를 import하지 않는다.
- [사용자 웹 UI/UX 명세](../../docs/specs/web/ui-ux.md)를 따른다. 현재 화면 보존과 신규 PWA 디자인 승인을 구분하며 `/design-system`을 양 앱 공통 디자인 기준으로 취급하지 않는다.
- 앱별 React Query Provider를 유지한다. 서버 모듈 전역에 사용자·세션 상태를 두지 않는다.
- 루트에서 `pnpm --filter @truewords/web test`, `typecheck`, `lint`, `build`로 검증한다. 통합 검증은 `pnpm test:e2e`다.
- 개발 서버는 `pnpm --filter @truewords/web dev`로 실행한다(Makefile·E2E도 동일 경로). Next 16.3.4의 `NEXT_TRACE_SPAN_THRESHOLD_MS`를 큰 값으로 지정해 요청 쿼리가 개발 `.next/dev/trace`에 기록되지 않도록 한다. 공식 trace OFF 옵션은 아니며 직접 `next dev` 실행은 이 보호를 우회한다. 과거 trace는 자동 삭제하지 않는다. Next 업데이트 시 upstream 미기동 검색 sentinel을 API·UI에 보내 stdout/stderr와 디스크 trace를 함께 확인한다.
- 설치된 Next.js의 `node_modules/next/dist/docs/` 관련 문서를 먼저 확인한다. 빌드/프록시 설정은 Next.js 16.3.4 기준이다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
