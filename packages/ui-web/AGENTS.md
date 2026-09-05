# React 전용 UI 패키지

- 기존 웹·관리자에서 사용하는 shadcn primitive, 상태 배지, CSS 테마와 표시용 util만 소유한다.
- Flutter 공통 UI가 아니다. API 호출·인증·앱 라우팅·업무 상태를 이 패키지에 넣지 않는다.
- 컴포넌트는 `@truewords/ui-web/components/ui/button`처럼 하위 경로로 가져온다.
- React/React DOM 버전은 앱과 동일한 peer dependency다. 앱 globals.css에서 패키지 소스를 Tailwind `@source`로 스캔한다.
- 검증: `pnpm --filter @truewords/ui-web typecheck`, `lint`와 web/admin 빌드·컴포넌트 테스트.
