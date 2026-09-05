# 관리자 UI/UX — 현재 구현과 소유권

- 문서 ID: `UI-ADMIN-001`
- 상태: **앱별 소유권 승인 · 기존 화면 보존 기준** (2026-09-05). 새 디자인·리디자인 승인 문서가 아니다.
- 변경 계획: [APP-UI-001](../../plans/active/2026-09-05-app-owned-ui.md). 실제 구현·검증 상태는 해당 계획에 기록한다.

## 현재 구현 기준

- `apps/admin`은 대시보드·챗봇·데이터 소스·검색 분석·피드백·감사 로그·설정과 관리자 로그인/접근 거부 화면을 소유한다. `/`는 `/dashboard`로 이동하며 사용자 채팅은 `apps/web`으로 연결한다.
- 업무 화면은 `src/app/(dashboard)`, 기능 UI는 `src/features`, primitive는 `src/components/ui`가 소유한다. 표시 유틸은 `src/lib/utils.ts`, 테마·전역 스타일은 `src/app/globals.css`, 폰트 연결은 `src/app/layout.tsx`에 둔다.
- 기존 사이드바·좁은 화면의 Sheet 탐색·테이블·폼·상태 표시를 보존한다. 기존 관리자 cool slate 맥락과 Portal 테마 적용을 유지하며 소유권 이동을 이유로 색상·크기·동작을 재설계하지 않는다.
- 기존 관리자 gate, 비관리자의 `/access-denied` 정지, 로그인·로그아웃 시 계정별 캐시 분리를 유지한다. UI 접근 제어는 FastAPI의 최종 권한 검사를 대신하지 않는다.

## 변경 경계와 검증

- 사용자 웹의 UI·CSS를 import하지 않는다. 같은 모양·토큰 값이 현재 존재해도 공통 디자인을 강제하지 않는다. 관리자 전용 변경은 이 앱에서 소유한다.
- `api-client-ts`, `eslint-config`, `typescript-config`는 공유한다. 제품 요구사항·API 계약·업무 규칙을 관리자 UI 문서로 복제하지 않는다.
- 변경 시 light/dark·좁은 화면·Portal·키보드 동작과 로딩/빈 결과/오류, 관리자 권한 거부·CRUD·계정 전환을 회귀 검증한다. 기존 테스트 수치를 새 변경의 통과 증거로 사용하지 않는다.

## 미승인 디자인과 기존 명세

사용자 웹의 `/design-system`, [과거 디자인 전략](../../research/17-design-strategy.md), 신규 PWA의 후속 디자인 검토는 관리자 디자인 승인을 의미하지 않는다. 관리자 리디자인은 별도 범위·사용자 승인을 받아 이 앱 명세에 반영한다. [데이터 소스 재설계](../2026-04-06-data-source-page-redesign.md) 등 기존 기능 명세의 업무 동작은 이번 소유권 이동으로 변경하지 않는다.

실행 명령은 [앱 README](../../../apps/admin/README.md), 개발 경계는 [앱 AGENTS](../../../apps/admin/AGENTS.md)를 따른다. 사용자 화면은 별도 [웹 UI/UX](../web/ui-ux.md)가 소유한다.
