# TrueWords Admin

TrueWords 플랫폼 관리자 대시보드 (Next.js)

---

## 기술 스택

| 기술 | 버전 | 용도 |
|------|------|------|
| Next.js | 16 | App Router 프레임워크 |
| React | 19 | UI 라이브러리 |
| TailwindCSS | 4 | 스타일링 |
| TanStack Query | 5 | 서버 상태 관리 |
| shadcn/ui | 4 | UI 컴포넌트 |
| Lucide React | - | 아이콘 |
| TypeScript | 5 | 타입 안전성 |

---

## 디렉토리 구조

```
admin/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # 루트 레이아웃
│   │   ├── page.tsx                # 랜딩 (→ 로그인 리다이렉트)
│   │   ├── globals.css             # 글로벌 스타일
│   │   ├── login/                  # 로그인 페이지
│   │   └── (dashboard)/            # 인증 필요 영역
│   │       ├── layout.tsx          # 대시보드 공통 레이아웃 (사이드바 등)
│   │       ├── dashboard/          # 대시보드 홈
│   │       ├── data-sources/       # 데이터 소스 관리
│   │       └── chatbots/           # 챗봇 버전 관리
│   ├── components/
│   │   ├── ui/                     # shadcn/ui 컴포넌트
│   │   ├── auth-guard.tsx          # 인증 가드
│   │   ├── providers.tsx           # React Query Provider 등
│   │   └── search-tier-editor.tsx  # 검색 티어 에디터
│   ├── lib/
│   │   ├── api.ts                  # 백엔드 API 클라이언트
│   │   ├── hooks/                  # 커스텀 훅
│   │   ├── utils.ts                # 유틸리티
│   │   └── category-colors.ts      # 카테고리 색상 매핑
│   └── test/                       # 단위 테스트
├── e2e/                            # Playwright E2E 테스트
├── public/                         # 정적 파일
├── vercel.json                     # Vercel 배포 설정
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 로컬 개발

### 사전 요구사항

- Node.js 22+
- 백엔드 서버 실행 중 (`http://localhost:8000`)

### 1. 환경변수 설정

```bash
# .env.local 생성
echo 'NEXT_PUBLIC_API_URL=http://localhost:8000' > .env.local
```

| 변수 | 필수 | 설명 |
|------|:---:|------|
| `NEXT_PUBLIC_API_URL` | O | 백엔드 API 주소 |

### 2. 의존성 설치 + 실행

```bash
pnpm install
pnpm dev
```

- Admin 대시보드: http://localhost:3000
- 로그인 후 대시보드 접근 가능 (백엔드 `scripts/create_admin.py`로 계정 생성)

---

## 주요 페이지

| 경로 | 페이지 | 기능 |
|------|--------|------|
| `/login` | 로그인 | 관리자 JWT 인증 |
| `/dashboard` | 대시보드 | 전체 현황 |
| `/data-sources` | 데이터 소스 | 데이터 업로드, 인제스트, 카테고리 관리 |
| `/chatbots` | 챗봇 관리 | 챗봇 버전 설정, 데이터 소스 조합, 검색 티어 |

---

## 스크립트

```bash
# 개발 서버 (자동 리로드)
pnpm dev

# 프로덕션 빌드
pnpm build

# 프로덕션 서버
pnpm start

# 린트
pnpm lint
```

---

## 테스트

```bash
# 단위 테스트
pnpm test

# 단위 테스트 (Watch 모드)
pnpm test:watch

# E2E 테스트 (Playwright)
pnpm test:e2e

# E2E 테스트 (UI 모드)
pnpm test:e2e:ui
```

---

## 배포

Vercel에 자동 배포됩니다.

- `main` 브랜치 푸시 → 프로덕션 배포
- PR 생성 → Preview 배포

```json
// vercel.json
{
  "framework": "nextjs",
  "buildCommand": "pnpm build",
  "installCommand": "npm ci"
}
```

---

## 백엔드 API 연동

`src/lib/api.ts`에서 `NEXT_PUBLIC_API_URL`을 기반으로 백엔드와 통신합니다.

- 인증: JWT 쿠키 기반 (`httpOnly`)
- 데이터 페칭: TanStack Query로 캐싱 + 자동 갱신
- CORS: 백엔드에서 `ADMIN_FRONTEND_URL`로 허용
