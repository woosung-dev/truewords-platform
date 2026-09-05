# web/admin/API 통합 검증

실제 계정·권한·DB와 두 Next.js 프록시를 검증한다. 질문 응답만 `apps/api/tests/e2e_app.py`의 dependency override가 공통 SSE fixture를 지연 전송한다. Gemini 호출은 없고 실제 세션/메시지 저장 및 내 기록·피드백은 유지한다. 운영 데이터에는 실행하지 않는다.

## 격리 환경

1. 저장소 루트의 `apps/api/docker-compose.e2e.yml`로 전용 PostgreSQL/Qdrant를 실행한다. 이 설정은 tmpfs 저장소이며 기존 개발 볼륨을 연결하지 않는다.
2. 별도 DB 환경변수로 API migration, `apps/api/scripts/create_admin.py`(각 계정), `apps/api/scripts/seed_chatbot_configs.py`를 실행한다. 관리자 게이트 계정 `demo-admin@example.com`(`E2E_ADMIN_EMAIL`로 변경 가능, API의 `DEMO_ADMIN_EMAIL`과 같아야 한다), 비관리자 `admin@test.com`, 테스트 암호 `test1234`를 사용한다. 루트 `make e2e`가 1~3을 한 번에 처리한다.
3. `pnpm --filter @truewords/e2e exec playwright install chromium`으로 브라우저를 준비하고 `pnpm test:e2e`를 실행한다.

기본 자동 실행은 API `8000`, web `127.0.0.1:3000`, admin `localhost:3001`을 사용하며 이미 실행 중인 서버를 재사용하지 않는다. 쿠키는 포트로 구분되지 않으므로 두 프론트엔드는 다른 hostname을 사용한다. 두 앱의 Next.js `allowedDevOrigins`는 `127.0.0.1` 개발 리소스 요청을 허용하며 운영 CORS 설정과는 별개다.

## 별도 포트 서버 사용

프론트엔드 실행 시 `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WEB_URL`, `NEXT_PUBLIC_ADMIN_URL`을 실제 테스트 주소로 설정한다. 이 값은 Next.js가 시작될 때 읽는다.

```bash
E2E_EXTERNAL_SERVERS=1 \
E2E_WEB_ORIGIN=http://127.0.0.1:3200 \
E2E_ADMIN_ORIGIN=http://localhost:3201 \
E2E_API_ORIGIN=http://127.0.0.1:18000 \
pnpm test:e2e
```

`admin-flow`는 기존 관리자 편집·권한 시나리오, `data-source-delete`는 삭제 확인 UI(데이터 API mock), `web-flow`는 모바일 채팅/SSE·출처·기록·로그아웃, `split-apps`는 origin 이동·호스트별 쿠키·alias·CSRF·계정 간 대화 기록 격리를 검증한다. SSE는 최종 답변뿐 아니라 첫 chunk의 중간 표시, 사용자 취소 후 부분 답변 보존, `done` 없이 연결이 끝났을 때의 오류 안내도 검사한다. 원문 모달은 실제 Qdrant 문서가 필요하지 않도록 한 응답만 mock한다. API의 원문 ACL은 별도 pytest에서 검증한다.

## 앱별 UI·테마 회귀

`ui-theme`의 4개 시나리오는 web/admin × light/dark 조합에서 로그인 키보드 이동·입력/버튼 크기, 390px 화면, 실제 제품 Sheet의 Portal 색상·토큰 상속·Escape 닫기를 확인한다. 웹의 비활성 전송 버튼과 모바일 적용 버튼 크기도 검사한다. 신규 다크모드 전환 기능을 가정하지 않고 기존 `.dark` 클래스를 직접 적용한다.

production CSS 최적화는 OKLCH를 Lab으로 표현할 수 있어 색상 문자열 대신 브라우저가 그린 RGBA 채널을 비교한다(채널당 허용 오차 1). 각 Portal 스크린샷은 테스트 첨부 파일로 저장한다. 이 검사는 전체 화면 픽셀 스냅샷이나 모든 접근성 검사를 대체하지 않는다.

부분 실행: `pnpm --filter @truewords/e2e exec playwright test --project=ui-theme-chromium`. 전체 실행에는 기존 34개와 새 UI 회귀 4개, 총 38개가 포함된다.
