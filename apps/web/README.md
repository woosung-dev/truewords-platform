# TrueWords 사용자 웹

Next.js 사용자 채팅·내 기록·원문 보기를 관리자 앱과 독립 실행한다. PWA 서비스워커·알림·새 사용자 인증은 아직 구현하지 않았다. 현재 기존 시연 계정을 유지한다.

## 실행과 검증

저장소 루트에서 실행한다.

```bash
pnpm install --frozen-lockfile
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @truewords/web dev
```

기본 주소는 `http://localhost:3000`이다. FastAPI `8000`, 관리자 앱 `3001`을 별도로 실행한다. 일반/관리자 계정 모두 사용자 웹 로그인 후 채팅으로 진입한다. 기존 관리 URL은 `NEXT_PUBLIC_ADMIN_URL`의 관리자 앱으로 연결된다. 로그인 성공·로그아웃 시 React Query 캐시를 비워 다른 계정의 기록을 재사용하지 않는다.

```bash
pnpm --filter @truewords/web test
pnpm --filter @truewords/web typecheck
pnpm --filter @truewords/web lint
pnpm --filter @truewords/web build
pnpm test:e2e
```

공통 DTO/transport는 `@truewords/api-client-ts`, 검사 설정은 `@truewords/eslint-config`·`@truewords/typescript-config`를 사용한다. React primitive는 `src/components/ui`, 테마는 `src/app/globals.css`, 표시 유틸은 `src/lib/utils.ts`가 소유한다. 관리자 앱의 UI·CSS를 가져오지 않으며 같은 모양이라는 이유로 공용 UI 패키지를 만들지 않는다.

[사용자 웹 UI/UX 명세](../../docs/specs/web/ui-ux.md)는 현재 화면·소유권·미승인 리디자인의 경계를 기록한다. `/design-system`은 기존 사용자 웹 컴포넌트 전시이며 관리자나 신규 PWA의 공통 디자인 승인 기준이 아니다.

SSE 이벤트는 같은 OpenAPI 모델과 `contracts/fixtures/chat-stream.json`으로 검증하며, `done` 없는 단절과 사용자 취소는 정상 완료로 처리하지 않는다. 상세 실행은 [통합 테스트 안내](../../tests/e2e/README.md)를 참고한다.

## 컨테이너

```bash
docker build -f apps/web/Dockerfile -t truewords-web:test .
```

standalone entrypoint는 `apps/web/server.js`다. 프록시와 앱 간 링크는 `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_ADMIN_URL` build ARG로 고정한다. API는 `/api/backend` 프록시를 사용하며 `/api/chat`, `/api/chatbots`, `/api/sources`, `/admin` 구 alias도 보존한다. 개인 API 응답을 캐싱하는 서비스워커는 없다.
