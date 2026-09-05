# 사용자 웹 — Next.js

- `/`, `/history`, `/about`, `/design-system`, `/login`을 소유한다. 관리자 화면은 `apps/admin`이다.
- 현재는 기존 시연 계정 인증이다. 신규 일반 사용자 인증·PWA 서비스워커·알림은 M5 승인 후 별도 구현한다.
- 앱 간 이동은 `NEXT_PUBLIC_ADMIN_URL`, API는 같은 origin의 `/api/backend` 프록시를 사용한다. 계정 쿠키를 다른 hostname으로 복사하지 않는다.
- 제품 업무·권한은 FastAPI에 둔다. 생성 DTO/SDK는 `@truewords/api-client-ts`, React UI는 `@truewords/ui-web`의 명시적 하위 경로로 가져온다.
- 앱별 React Query Provider를 유지한다. 서버 모듈 전역에 사용자·세션 상태를 두지 않는다.
- 루트에서 `pnpm --filter @truewords/web test`, `typecheck`, `lint`, `build`로 검증한다. 통합 검증은 `pnpm test:e2e`다.
- 설치된 Next.js의 `node_modules/next/dist/docs/` 관련 문서를 먼저 확인한다. 빌드/프록시 설정은 Next.js 16.2.2 기준이다.
