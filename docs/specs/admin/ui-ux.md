# 관리자 UI/UX — 현재 구현과 소유권

- 문서 ID: `UI-ADMIN-001`
- 상태: **앱별 소유권 승인 · 기존 화면 보존 기준** (2026-09-05). 새 디자인·리디자인 승인 문서가 아니다.
- 변경 계획: [APP-UI-001](../../plans/active/2026-09-05-app-owned-ui.md). 실제 구현·검증 상태는 해당 계획에 기록한다.

## 현재 구현 기준

- `apps/admin`은 대시보드·챗봇·훈독 편성(`/hoondok`, 2026-09-19 Phase 3 B)·훈독 권리 원장(`/hoondok/rights`)·데이터 소스·검색 분석·피드백·감사 로그·설정과 관리자 로그인/접근 거부 화면을 소유한다. `/`는 `/dashboard`로 이동하며 사용자 채팅은 `apps/web`으로 연결한다.
- 업무 화면은 `src/app/(dashboard)`, 기능 UI는 `src/features`, primitive는 `src/components/ui`가 소유한다. 표시 유틸은 `src/lib/utils.ts`, 테마·전역 스타일은 `src/app/globals.css`, 폰트 연결은 `src/app/layout.tsx`에 둔다.
- 기존 사이드바·좁은 화면의 Sheet 탐색·테이블·폼·상태 표시를 보존한다. 기존 관리자 cool slate 맥락과 Portal 테마 적용을 유지하며 소유권 이동을 이유로 색상·크기·동작을 재설계하지 않는다.
- `/hoondok/rights` 상단은 저작물(총서)별 현황 표다. `GET /admin/hoondok/content-rights/series`가 주는 등록·공개·대기·철회·청크 수를 시리즈 한 줄로 보여주고, 행의 "일괄 변경" 버튼이 다이얼로그를 연다. 다이얼로그는 승인 상태(기본 허용)·허용 범위 3개(기본 검색 스니펫·원문 전재)·공식성 등급(기본 "변경하지 않음")을 받아 `POST /admin/hoondok/content-rights/bulk`로 그 시리즈 전 권을 한 번에 바꾼다. 등급은 운영자가 고른 경우에만 페이로드에 실어 기존 등급을 덮지 않는다. 원장이 비어 있으면 표 대신 시드 스크립트 안내를 보여주고, 아래 개별 목록은 총서 필터(기본 "전체")와 행별 청크 수를 갖는다. 개별 등록·수정 폼의 동작은 그대로다.
- 기존 관리자 gate, 비관리자의 `/access-denied` 정지, 로그인·로그아웃 시 계정별 캐시 분리를 유지한다. UI 접근 제어는 FastAPI의 최종 권한 검사를 대신하지 않는다.

## 변경 경계와 검증

- 사용자 웹의 UI·CSS를 import하지 않는다. 같은 모양·토큰 값이 현재 존재해도 공통 디자인을 강제하지 않는다. 관리자 전용 변경은 이 앱에서 소유한다.
- `api-client-ts`, `eslint-config`, `typescript-config`는 공유한다. 제품 요구사항·API 계약·업무 규칙을 관리자 UI 문서로 복제하지 않는다.
- 변경 시 light/dark·좁은 화면·Portal·키보드 동작과 로딩/빈 결과/오류, 관리자 권한 거부·CRUD·계정 전환을 회귀 검증한다. 기존 테스트 수치를 새 변경의 통과 증거로 사용하지 않는다.

## 미승인 디자인과 기존 명세

사용자 웹의 `/design-system`, [과거 디자인 전략](../../research/17-design-strategy.md), 신규 PWA의 후속 디자인 검토는 관리자 디자인 승인을 의미하지 않는다. 관리자 리디자인은 별도 범위·사용자 승인을 받아 이 앱 명세에 반영한다. [데이터 소스 재설계](../2026-04-06-data-source-page-redesign.md) 등 기존 기능 명세의 업무 동작은 이번 소유권 이동으로 변경하지 않는다.

실행 명령은 [앱 README](../../../apps/admin/README.md), 개발 경계는 [앱 AGENTS](../../../apps/admin/AGENTS.md)를 따른다. 사용자 화면은 별도 [웹 UI/UX](../web/ui-ux.md)가 소유한다.
