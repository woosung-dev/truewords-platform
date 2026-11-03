# 사용자 웹 UI/UX — 현재 구현과 소유권

- 문서 ID: `UI-WEB-001`
- 상태: **앱별 소유권 승인 · 기존 화면 보존 기준** (2026-09-05). 새 디자인·리디자인 승인 문서가 아니다.
- 변경 계획: [APP-UI-001](../../plans/completed/2026-09-05-app-owned-ui.md). 실제 구현·검증 상태는 해당 계획에 기록한다.

## 현재 구현 기준

- `apps/web`은 훈독 전용이다. 웹 루트(`/`)가 훈독 홈이고 화면 경로는 접두 없이 `/read`·`/ask`·`/library`·`/words/{volume}`·`/garden`·`/c/{id}` 등이다(`DEC-PWA-026`, 2026-11-04). 레드팀 시연 챗 화면(`/` 채팅·`/history`·`/about`·`/login`)은 삭제했고 백엔드 `/chat` API 는 남아 있다. 삭제한 주소는 `/login`→`/onboarding`, `/history`→`/ask`, `/about`→`/` 로 임시 리다이렉트한다. 예전 훈독 주소 `/hoondok`·`/hoondok/*` 는 같은 경로의 루트로 308 하며, 정적 자산(`/hoondok/fonts|icons|photos|cards|mascot|voices/*`·`manifest.webmanifest`·은퇴 `sw.js`)은 경로를 유지한다. 훈독 화면 기준은 [훈독 디자인](hoondok-design-system.md)이 소유한다.
- 화면은 `src/app/(hoondok)`(route group, 레이아웃이 `[data-app="hoondok"]` 스코프·PWA 메타·서비스워커를 붙인다), 기능 UI는 `src/features/hoondok`·`src/components/hoondok`가 소유한다. 루트 layout·`src/app/globals.css`·`src/components/ui`(토스트)는 훈독 스코프 밖(404·토스트)만 맡는다.
- 기존 paper 계열 화면·폰트·컴포넌트 크기·모션을 이번 소유권 이동에서 재설계하지 않는다.
- 훈독은 일반 사용자 인증·PWA 설치(manifest `id` `/hoondok` 유지, `start_url`·`scope` `/`)·서비스워커(`/sw.js`, scope `/`)·Web Push 알림을 구현했다. 예전 `/hoondok` scope 등록은 은퇴 스크립트(`/hoondok/sw.js`)와 앱의 등록 코드가 해제한다.

## 변경 경계와 검증

- 관리자 UI·CSS를 import하지 않는다. 같은 토큰 값·primitive 코드가 있어도 양 앱 동시 변경이나 공용 패키지 생성을 요구하지 않는다.
- `api-client-ts`, `eslint-config`, `typescript-config`는 공유한다. 제품 요구사항·업무 규칙·최종 권한은 공통 PRD/spec와 FastAPI가 담당하며 이 문서에 복제하지 않는다.
- 앱은 라이트 고정이다(`DEC-PWA-017`). 변경 시 좁은 화면·Portal·키보드 동작, 로딩/빈 결과/오류, 로그인·계정 전환, SSE 중간 표시·취소·단절을 회귀 검증한다. 기존 테스트 수치를 새 변경의 통과 증거로 사용하지 않는다.

## 미승인 디자인과 과거 자료

[S0 제품 방향](../../research/2026-08-30-pwa-app-direction.md)은 제품 방향 승인과 후속 디자인 시스템 작업을 구분한다. 채택 프로토타입·승인 PRD·사용자 선택 없이 신규 PWA 색상·정보구조·화면 규칙을 확정하지 않는다. [과거 디자인 전략](../../research/17-design-strategy.md)은 역사적 참고이며 현재 제품의 승인 디자인으로 자동 상속하지 않는다.

실행 명령은 [앱 README](../../../apps/web/README.md), 개발 경계는 [앱 AGENTS](../../../apps/web/AGENTS.md)를 따른다. 관리자 화면은 별도 [관리자 UI/UX](../admin/ui-ux.md)가 소유한다.
