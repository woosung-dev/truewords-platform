# TrueWords 관리자 웹

Next.js 16.3.4·React 19.2.4 관리자 앱이다. 사용자 채팅은 `apps/web`에서 독립 실행한다.

## 실행

저장소 루트에서 실행한다.

```bash
pnpm install --frozen-lockfile
cp apps/admin/.env.example apps/admin/.env.local
pnpm --filter @truewords/admin dev
```

기본 주소는 `http://localhost:3001`, FastAPI는 `http://localhost:8000`이다. `/`는 `/dashboard`로 이동한다. 기존 시연 gate를 유지하며 비관리자는 `/access-denied`에서 멈춘다. 다른 hostname의 사용자 웹 쿠키는 자동 공유되지 않으므로 앱별 로그인한다. 로그인 성공·로그아웃 시 앱의 React Query 캐시를 비워 계정 간 이전 결과 재사용을 막는다.

## 경계와 검증

관리자 업무 화면은 `src/app/(dashboard)`, 기능별 API 연결·UI는 `src/features`, 앱 인증 UX는 `src/features/auth`가 소유한다. React primitive는 `src/components/ui`, 테마는 `src/app/globals.css`, 표시 유틸은 `src/lib/utils.ts`에 둔다. 사용자 웹의 UI·CSS를 가져오지 않는다.

공통 DTO/transport는 `packages/api-client-ts`, 검사 설정은 `packages/eslint-config`·`packages/typescript-config`를 유지한다. 서버 업무 규칙은 FastAPI에 둔다. [관리자 UI/UX 명세](../../docs/specs/admin/ui-ux.md)는 현재 구현과 앱별 소유권만 기록하며, 사용자 웹과 동일한 디자인이나 신규 리디자인을 승인하지 않는다.

```bash
pnpm --filter @truewords/admin test
pnpm --filter @truewords/admin typecheck
pnpm --filter @truewords/admin lint
pnpm --filter @truewords/admin build
pnpm test:e2e
```

E2E 격리 환경과 두 앱 테스트는 [통합 테스트 안내](../../tests/e2e/README.md)를 따른다.

## 컨테이너

```bash
docker build -f apps/admin/Dockerfile -t truewords-admin:test .
```

저장소 루트 context와 루트 pnpm lockfile을 사용한다. standalone entrypoint는 `apps/admin/server.js`이며 static/public도 같은 앱 경로로 복사한다. `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_ADMIN_URL`은 빌드 시 프록시·링크에 고정되므로 운영에서는 build ARG를 지정한다. 운영 origin 변경·배포는 이 구조 전환과 별도 승인 작업이다.
