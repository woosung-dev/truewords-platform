---
paths: ["apps/web/**/*", "apps/admin/**/*"]
---

# Frontend Rules (Next.js 16 — 사용자 웹 / 관리자)

모노레포의 현재 실행·구조·생성 SDK·앱별 인증 UX는 [사용자 웹](../../apps/web/README.md)·[관리자 앱](../../apps/admin/README.md)을 따른다. 아래 fetch wrapper·프록시·폴더 트리와 Vercel 배포 표기는 분리 전 참고 예시이며 현재 구현으로 복사하지 않는다. 공유 SDK의 로그인 이동은 각 앱의 `onUnauthorized`가 소유한다.

UI primitive·테마·표시 유틸은 각 앱의 `src/components/ui`, `src/app/globals.css`, `src/lib/utils.ts`가 소유한다. 앱 간 UI·CSS import와 공통 UI/토큰 패키지의 선행 생성을 금지한다. API SDK·ESLint·TypeScript 설정 3개 패키지는 유지한다. 현재 화면·컴포넌트 동작을 보존하며 앱별 [웹 UI/UX](../../docs/specs/web/ui-ux.md)·[관리자 UI/UX](../../docs/specs/admin/ui-ux.md)를 따른다. 앱별 소유권 승인은 신규 PWA 디자인이나 리디자인 승인이 아니다.

---

## 1. Tech Stack

| 항목            | 기술                                  |
| --------------- | ------------------------------------- |
| Framework       | Next.js 16 (App Router)               |
| Language        | TypeScript Strict                     |
| Styling         | Tailwind CSS v4 + shadcn/ui v4        |
| Package Manager | `pnpm`                                |
| Server State    | React Query (`@tanstack/react-query`) |
| Client State    | `useState` (필요 시 Zustand 도입)     |
| Chart           | Recharts                              |
| Auth            | Custom JWT (HttpOnly Cookie, 백엔드 연동) |
| 아이콘          | `lucide-react`                        |
| Toast           | `sonner`                              |
| 배포            | Vercel                                |

---

## 2. 핵심 제약 사항 (Strict Rules)

### Next.js 16 필수 패턴

- `params`, `searchParams`는 **`Promise<>`** 타입
- 클라이언트 컴포넌트: `use(params)` (React 19 `use()` 훅)
- 서버 컴포넌트: `await params` (async function)
- `node_modules/next/dist/docs/` 참조 필수

```typescript
// ✅ 클라이언트 컴포넌트 — use() 훅 사용 (현재 패턴)
"use client";
import { use } from "react";

export default function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <Detail id={id} />;
}

// ✅ 서버 컴포넌트 — await 사용
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Detail id={id} />;
}
```

### shadcn/ui v4

- 내부 의존성: `@base-ui/react` (Radix UI 아님)
- `@radix-ui/*` 직접 import 금지
- 추가: `pnpm dlx shadcn@latest add [component]`
- `components/ui/` 직접 수정 금지 → 래핑 컴포넌트

### Auth (Custom JWT + HttpOnly Cookie)

- 백엔드 `POST /admin/auth/login` → HttpOnly Cookie로 JWT 발급
- API 호출 시 `credentials: "include"`로 쿠키 자동 전송
- 인증 보호: `AuthGuard` 클라이언트 컴포넌트로 래핑
- 401 응답 시 `/login`으로 리다이렉트

```typescript
// features/auth/components/auth-guard.tsx
"use client";
export function AuthGuard({ children }: { children: React.ReactNode }) {
  // GET /admin/auth/me 호출로 인증 상태 확인
  // 미인증 시 /login 리다이렉트
}

// lib/api.ts — 공통 fetch wrapper
export async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, credentials: "include" });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  ...
}
```

### API 프록시

- `next.config.ts`의 `rewrites`로 백엔드 API 프록시 처리
- `proxy.ts` / `middleware.ts` 미사용

```typescript
// next.config.ts
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export default {
  async rewrites() {
    return [
      { source: "/admin/:path*", destination: `${BACKEND_URL}/admin/:path*` },
      { source: "/api/chat:path*", destination: `${BACKEND_URL}/chat:path*` },
    ];
  },
};
```

---

## 3. Directory Structure (FSD)

```
admin/src/
├── app/                        # 라우트 진입점 (Thin)
│   ├── layout.tsx                  # 루트 레이아웃 (metadata, providers)
│   ├── globals.css                 # 전역 스타일 + 테마
│   ├── login/                      # 로그인 (public)
│   ├── (chat)/                     # 챗봇 테스트 인터페이스
│   └── (dashboard)/                # 인증 보호 그룹
│       ├── layout.tsx                  # 사이드바 + 헤더
│       ├── dashboard/                  # 홈 KPI
│       ├── chatbots/                   # 챗봇 CRUD
│       ├── data-sources/               # 데이터 업로드 + 카테고리 관리
│       ├── analytics/                  # 검색 분석 (차트, 통계)
│       ├── feedback/                   # 피드백 대시보드
│       ├── audit-logs/                 # 감사 로그
│       └── settings/                   # Admin 사용자 관리
├── components/
│   ├── ui/                     # shadcn/ui (수정 금지)
│   └── providers.tsx           # TanStack Query + Toast 설정
├── features/                   # 도메인별 비즈니스
│   └── [domain]/
│       ├── components/
│       ├── api.ts
│       ├── hooks.ts
│       └── types.ts
├── lib/
│   ├── api.ts                  # fetchAPI wrapper (JWT 쿠키 인증)
│   └── utils.ts                # 헬퍼 함수
└── test/                       # Vitest 단위 테스트
```
