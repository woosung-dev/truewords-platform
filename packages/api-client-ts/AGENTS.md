# TypeScript API 클라이언트

- `src/generated/`는 FastAPI OpenAPI에서 생성한다. 직접 수정하지 않는다.
- 재생성: 루트 `pnpm contracts:generate`. 검사: `pnpm contracts:check`.
- 플랫폼 중립 transport는 쿠키·CSRF 헤더·구조화 오류·취소를 보존한다.
- 로그인 화면 이동은 앱의 `onUnauthorized`에 맡긴다. React/Next/앱 파일을 import하지 않는다.
- SSR에서는 요청별 인스턴스를 사용하고 사용자 쿠키를 전역 client에 저장하지 않는다.
- SSE는 앱 어댑터와 `contracts/fixtures`로 검증한다. 생성기의 자동 재연결을 채팅 POST에 적용하지 않는다.
