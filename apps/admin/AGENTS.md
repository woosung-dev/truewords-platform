<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 관리자 앱 경계

- 관리자 화면만 소유한다. 사용자 채팅·기록은 `apps/web`이며 루트 `/`는 `/dashboard`로 이동한다.
- 기존 시연 관리자 gate와 FastAPI 최종 권한 검사를 유지한다. 비관리자는 `/access-denied`에서 멈추며 루트로 반복 이동하지 않는다.
- 앱 간 이동은 `NEXT_PUBLIC_WEB_URL`을 사용한다. 다른 hostname의 웹 로그인 쿠키가 자동 공유된다고 가정하지 않는다.
- 생성 DTO/SDK는 `@truewords/api-client-ts`, 공유 React UI는 `@truewords/ui-web`의 하위 경로를 사용한다. 공유 패키지는 앱을 import하지 않는다.
- 루트에서 `pnpm --filter @truewords/admin test`, `typecheck`, `lint`, `build`로 검증한다. E2E는 `tests/e2e`에 있다.
- Docker 빌드 context는 저장소 루트다. standalone entrypoint는 `apps/admin/server.js`다.
