# 사용자 웹 UI/UX — 현재 구현과 소유권

- 문서 ID: `UI-WEB-001`
- 상태: **앱별 소유권 승인 · 기존 화면 보존 기준** (2026-09-05). 새 디자인·리디자인 승인 문서가 아니다.
- 변경 계획: [APP-UI-001](../../plans/active/2026-09-05-app-owned-ui.md). 실제 구현·검증 상태는 해당 계획에 기록한다.

## 현재 구현 기준

- `apps/web`은 `/`, `/history`, `/about`, `/login`, `/design-system`을 소유한다. 채팅·출처/원문 보기·피드백·기록·스트림 취소와 기존 시연 계정 로그인 흐름을 보존한다.
- 화면·기능 UI는 `src/app`, `src/features`, `src/components/truewords`, primitive는 `src/components/ui`가 소유한다. 표시 유틸은 `src/lib/utils.ts`, 테마·전역 스타일은 `src/app/globals.css`, 폰트 연결은 `src/app/layout.tsx`에 둔다.
- 기존 paper 계열 화면·폰트·컴포넌트 크기·모션을 이번 소유권 이동에서 재설계하지 않는다. `/design-system`은 기존 사용자 웹의 컴포넌트 전시이며 관리자나 신규 PWA의 공통 디자인 기준이 아니다.
- 새 일반 사용자 인증·서버 푸시·알림함은 미구현이다. PWA 셸(manifest·`public/sw.js`·`/hoondok` 설치·권한 데모)은 2026-09-09 부터 `NEXT_PUBLIC_PWA_ENABLED=1` 플래그 뒤에 있으며 기존 화면·테마를 바꾸지 않는다. 신규 훈독 화면의 토큰은 [UI-HOONDOK-001](hoondok-design-system.md) 초안이 따로 관리하며 이 문서의 paper 토큰을 덮어쓰지 않는다. 기존 시연 화면이 신규 제품 기능의 승인·완료 증거가 되지 않는다.

## 변경 경계와 검증

- 관리자 UI·CSS를 import하지 않는다. 같은 토큰 값·primitive 코드가 있어도 양 앱 동시 변경이나 공용 패키지 생성을 요구하지 않는다.
- `api-client-ts`, `eslint-config`, `typescript-config`는 공유한다. 제품 요구사항·업무 규칙·최종 권한은 공통 PRD/spec와 FastAPI가 담당하며 이 문서에 복제하지 않는다.
- 변경 시 light/dark·좁은 화면·Portal·키보드 동작, 로딩/빈 결과/오류, 로그인·계정 전환, SSE 중간 표시·취소·단절을 회귀 검증한다. 기존 테스트 수치를 새 변경의 통과 증거로 사용하지 않는다.

## 미승인 디자인과 과거 자료

[S0 제품 방향](../../research/2026-08-30-pwa-app-direction.md)은 제품 방향 승인과 후속 디자인 시스템 작업을 구분한다. 채택 프로토타입·승인 PRD·사용자 선택 없이 신규 PWA 색상·정보구조·화면 규칙을 확정하지 않는다. [과거 디자인 전략](../../research/17-design-strategy.md)은 역사적 참고이며 현재 제품의 승인 디자인으로 자동 상속하지 않는다.

실행 명령은 [앱 README](../../../apps/web/README.md), 개발 경계는 [앱 AGENTS](../../../apps/web/AGENTS.md)를 따른다. 관리자 화면은 별도 [관리자 UI/UX](../admin/ui-ux.md)가 소유한다.
