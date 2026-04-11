---
paths: ["admin/**/*"]
---

# Frontend Rules (Next.js 16 — Admin Dashboard)

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

- `params`, `searchParams`는 **`Promise<>`** 타입 → `await` 필수
- `node_modules/next/dist/docs/` 참조 필수

```typescript
// ✅ Next.js 16
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
