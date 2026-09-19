# 사용자 웹 — Next.js

- `/`, `/history`, `/about`, `/design-system`, `/login`, `/hoondok/*`을 소유한다. 관리자 화면은 `apps/admin`이다.
- `/hoondok/*`(훈독)은 `NEXT_PUBLIC_HOONDOK_ENABLED=1` 일 때만 존재하고 AuthGuard 를 쓰지 않는다. 토큰·컴포넌트는 `src/app/hoondok.css`(`[data-app="hoondok"]` 스코프)·`src/components/hoondok`·`src/features/hoondok` 이 소유하고, 계정(쿠키 `hoondok_token`, `/hoondok/onboarding?returnTo=`)은 `src/features/identity` 가 소유한다(`features/auth`·`lib/api.ts` 의 `/login` 이동과 분리). 비로그인 완료 체크는 localStorage 에 KST 날짜 키로 두고 로그인 후 당일분만 소급한다. PWA 정적 자산(manifest·아이콘·self-host 폰트)은 `public/hoondok/` 에 두고 hoondok layout 의 `generateMetadata`·`generateViewport` 로만 연결한다(루트 layout 무변경). `globals.css`·`:root`·`/design-system` 을 바꾸지 않는다. 검사는 `pnpm hoondok:check`, 계획은 [PLAN-HD-001](../../docs/plans/active/2026-09-17-hoondok-mvp.md).
- 현재는 기존 시연 계정 인증이다. 신규 일반 사용자 인증·PWA 서비스워커·알림은 M5 승인 후 별도 구현한다.
- 앱 간 이동은 `NEXT_PUBLIC_ADMIN_URL`, API는 같은 origin의 `/api/backend` 프록시를 사용한다. 계정 쿠키를 다른 hostname으로 복사하지 않는다.
- 제품 업무·권한은 FastAPI에 둔다. 생성 DTO/SDK는 `@truewords/api-client-ts`, 공통 검사 설정은 `@truewords/eslint-config`·`@truewords/typescript-config`를 사용한다.
- UI·테마·표시 유틸은 이 앱의 `src/components/ui`, `src/app/globals.css`, `src/lib/utils.ts`가 소유한다. `@/components/ui/*`, `@/lib/utils`를 사용하며 관리자 앱의 UI·CSS를 import하지 않는다.
- [사용자 웹 UI/UX 명세](../../docs/specs/web/ui-ux.md)를 따른다. 현재 화면 보존과 신규 PWA 디자인 승인을 구분하며 `/design-system`을 양 앱 공통 디자인 기준으로 취급하지 않는다.
- 앱별 React Query Provider를 유지한다. 서버 모듈 전역에 사용자·세션 상태를 두지 않는다.
- 루트에서 `pnpm --filter @truewords/web test`, `typecheck`, `lint`, `build`로 검증한다. 통합 검증은 `pnpm test:e2e`다.
- 설치된 Next.js의 `node_modules/next/dist/docs/` 관련 문서를 먼저 확인한다. 빌드/프록시 설정은 Next.js 16.3.4 기준이다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
