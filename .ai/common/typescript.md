# TypeScript / 프론트엔드 공통 규칙

> Next.js, React Native 등 TypeScript 기반 프론트엔드 스택에 공통 적용.

---

## 1. TypeScript

- **Strict 모드 필수**, `any` 사용 엄격히 금지 (부득이한 경우 `unknown` + Type Guard)
- 모든 API 응답 타입은 명시적으로 정의

---

## 2. 컴포넌트 (Thin Component)

- 페이지/UI 컴포넌트 내부에 비즈니스 로직 직접 작성 금지
- 비즈니스 로직은 커스텀 훅(`features/[domain]/hooks.ts`)으로 분리
- 서버 컴포넌트(RSC) 지향, `"use client"`는 말단 노드에만

---

## 3. 상태 관리

| 종류          | 도구        | 예시          |
| ------------- | ----------- | ------------- |
| Server State  | React Query | API 데이터    |
| Client Local  | useState    | 모달 상태, 폼 입력 |

### React Query

- Query Key 하드코딩 금지 → 도메인별 팩토리 패턴
- API 호출은 `features/[domain]/api.ts`에 집중
- `staleTime` / `refetchInterval` 도메인별 적절히 설정

> 전역 상태 관리(Zustand 등)는 필요 시 도입. 현재는 React Query + useState로 충분.

---

## 4. 에러 핸들링

- `if (isLoading)` / `if (error)` 남발 금지
- `Suspense` + `ErrorBoundary`로 위임

---

## 5. 네이밍 규칙

- Boolean: `is`, `has`, `should` 접두사
- 이벤트 핸들러: `handle` 접두사
- Props 이벤트: `on` 접두사
- 컴포넌트 파일: PascalCase
- 훅 파일: camelCase `use` 접두사
- 상수: UPPER_SNAKE_CASE

---

## 6. 도메인별 타입 위치

- 공통 유틸 타입 (`UUID`, `Timestamped`, `PaginatedResponse`): `types/index.ts`
- 도메인 타입: `features/[domain]/types.ts`

---

## 7. Toast 알림

- `sonner` 사용, `Toaster`는 `app/layout.tsx`에 한 번만 선언
