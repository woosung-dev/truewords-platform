# 사용자 웹 — Next.js

- 훈독을 웹 루트(`/`, `/read`, `/ask` …)에서 소유한다. 예전 `/hoondok/*` 화면 주소는 `next.config.ts` 가 같은 경로로 308 하고, 정적 자산은 `public/hoondok/` 경로를 유지한다(리다이렉트 제외 목록에 넣는다). 관리자 화면은 `apps/admin`이다. 공통 규칙은 루트 `AGENTS.md`의 "웹 앱 공통"을 따른다.
- 인증은 `src/features/identity`의 일반 사용자 계정(쿠키 `hoondok_token`)뿐이다. 관리자 계정(`admin_token`)을 웹에서 읽거나 쓰지 않는다. 로그인 이동은 `/onboarding?returnTo=` 이고 `returnTo` 는 같은 origin 상대 경로만 허용한다.
- 훈독은 `NEXT_PUBLIC_HOONDOK_ENABLED=1` 빌드에서만 존재한다. 가정예배·가족 프리뷰 프로토타입(`NEXT_PUBLIC_HOONDOK_PREVIEW`)은 코드에서 삭제했고, 필요하면 git 이력에서 복원한다.
- 말씀 화면은 권리가 허용된 데이터만 보여준다.
- 훈독 CSS: 토큰(hex)은 `src/app/hoondok.css` 첫 블록에만 두고 나머지 CSS는 `[data-app="hoondok"]` 스코프와 `var()`만 쓴다(`pnpm hoondok:check`가 검사). 훈독 토큰을 `globals.css`·`:root`에 두지 않는다.
- 새 훈독 화면은 `src/features/hoondok/screens.ts` 레지스트리에 한 줄 추가한다. `tabs.ts`·`app-shell.tsx`는 건드리지 않는다. 공용 컴포넌트는 배럴 `src/components/hoondok/index.ts`로만 가져온다.
- 서비스워커는 `public/sw.js`(scope `/`)를 hoondok layout에서만 등록하고 `/api/*`·`/admin/*`·인증·온보딩 응답을 캐시하지 않는다. manifest `id`(`/hoondok`)는 바꾸지 않는다(설치된 앱이 다른 앱이 된다). 은퇴 스크립트 `public/hoondok/sw.js`는 예전 설치본 해제용이라 지우거나 리다이렉트하지 않는다(200 + `Service-Worker-Allowed: /hoondok`).
- 개인정보: 오류 수집은 안전한 kind와 정규화 경로만 보내고 질문·검색어·예외 원문·토큰을 담지 않는다. 함께 읽기 숫자는 서버 값만 쓰며 +1 보정이나 미완료자 표시를 하지 않는다. AI 질문은 로그인 필수이고 질문·답은 계정에만 보관한다(기기 `localStorage`에 남기지 않는다). 하루 5회(KST 자정 기준, 이어 묻기 포함)이며 공유 시맨틱 캐시를 쓰지 않는다. 사용자가 공개를 고른 세션 첫 답만 서버가 대화 기록에서 복사해 협회 검수 뒤 익명으로 공개하고, 본인이 내리면 지운다.
- AI 질문의 답은 `POST /hoondok/ask/stream`으로 받고(기록은 `/hoondok/me/asks*`, 공개 신청·열람은 `/hoondok/*questions`), `sources`가 0건이면 답을 보이지 않는다.
- 알림 권한 요청은 클릭 핸들러 안에서 동기적으로 시작한다(iOS 제스처 요건).
- 개발 서버는 `pnpm --filter @truewords/web dev`로만 띄운다. 이 스크립트의 `NEXT_TRACE_SPAN_THRESHOLD_MS`가 요청 쿼리를 `.next/dev/trace`에 남기지 않게 막는다. 공식 OFF 옵션이 아니며 직접 `next dev`는 이 보호를 우회한다.
- Next를 올릴 때는 검색 sentinel을 보내 stdout·stderr·디스크 trace에 쿼리가 남지 않는지 다시 확인한다. 과거 trace는 자동 삭제하지 않는다.
- 검증: 루트에서 `pnpm --filter @truewords/web test`, `typecheck`, `lint`, `build`. 통합은 `pnpm test:e2e`.
- 명세: [사용자 웹 UI/UX](../../docs/specs/web/ui-ux.md), [훈독 디자인 시스템](../../docs/specs/web/hoondok-design-system.md), [훈독 API](../../docs/specs/api/hoondok-api.md).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
