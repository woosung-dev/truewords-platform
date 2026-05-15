# 인기 질문 전체 탐색 페이지 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/analytics/queries` 신규 페이지로 전체 고유 질문을 검색/정렬/페이지네이션으로 탐색할 수 있게 하고, 긴 질문 셀에 호버/탭 툴팁을 제공한다.

**Architecture:** Backend는 기존 analytics router/repository 패턴대로 raw SQL `text()` 기반 엔드포인트 `GET /admin/analytics/search/queries` 추가. Frontend는 `/analytics/queries/page.tsx` 신규 페이지 + 범용 `TruncateTooltip` 컴포넌트 + 기존 Top 10 링크 연결. 행 클릭 시 PR #39에서 만든 `QueryDetailModal`을 그대로 재사용.

**Tech Stack:** FastAPI + SQLAlchemy (raw `text`) · Pydantic v2 · Next.js 16 App Router · React Query · `@base-ui/react/tooltip` (shadcn v4) · Tailwind CSS v4 · pytest + vitest

**Spec:** `docs/superpowers/specs/2026-04-21-all-queries-explorer-design.md`

---

## File Structure

### Backend
| 파일 | 유형 | 책임 |
|---|---|---|
| `backend/src/admin/analytics_schemas.py` | 수정 | `QueryListItem`, `QueryListResponse` 추가 |
| `backend/src/admin/analytics_repository.py` | 수정 | `get_queries(q, days, sort, page, size)` 메서드 추가 |
| `backend/src/admin/analytics_router.py` | 수정 | `GET /admin/analytics/search/queries` 엔드포인트 추가 |
| `backend/tests/test_analytics_queries.py` | 신규 | 통합 테스트 7건 |

### Frontend
| 파일 | 유형 | 책임 |
|---|---|---|
| `admin/src/components/ui/tooltip.tsx` | 신규 (shadcn 생성) | shadcn/ui v4 Tooltip 컴포넌트 |
| `admin/src/features/analytics/types.ts` | 수정 | `QuerySortKey`, `QueryListItem`, `QueryListResponse` |
| `admin/src/features/analytics/api.ts` | 수정 | `getQueries(...)` 추가 |
| `admin/src/features/analytics/components/truncate-tooltip.tsx` | 신규 | 말줄임 + 툴팁 + 모바일 tap-toggle 래퍼 |
| `admin/src/app/(dashboard)/analytics/page.tsx` | 수정 | Top 10 헤더 "모두 보기" 링크 + 질문 셀 TruncateTooltip 교체 |
| `admin/src/app/(dashboard)/analytics/queries/page.tsx` | 신규 | 질문 탐색 페이지 본체 |
| `admin/src/test/queries-page.test.tsx` | 신규 | vitest 5건 |

---

## Task 1: Backend — Pydantic 응답 스키마 추가

**Files:**
- Modify: `backend/src/admin/analytics_schemas.py`

- [ ] **Step 1: 스키마 추가**

파일 끝에 추가:

```python
class QueryListItem(BaseModel):
    query_text: str
    count: int
    latest_at: datetime
    negative_feedback_count: int


class QueryListResponse(BaseModel):
    items: list[QueryListItem]
    total: int
    page: int
    size: int
    days: int
```

- [ ] **Step 2: 임포트 검증**

Run: `cd backend && uv run python -c "from src.admin.analytics_schemas import QueryListResponse, QueryListItem; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/analytics_schemas.py
git commit -m "feat(analytics): add query list response schemas"
```

---

## Task 2: Backend — Repository `get_queries` 구현

**Files:**
- Modify: `backend/src/admin/analytics_repository.py`

- [ ] **Step 1: 메서드 추가**

`AnalyticsRepository` 클래스 끝(파일의 `get_query_details` 다음)에 추가:

```python
    async def get_queries(
        self,
        q: str = "",
        days: int = 30,
        sort: str = "count_desc",
        page: int = 1,
        size: int = 50,
    ) -> dict:
        """고유 질문 집계 + 검색/정렬/페이지네이션.

        반환 구조:
            {
                "items": list[dict],  # query_text, count, latest_at, negative_feedback_count
                "total": int,
                "page": int,
                "size": int,
                "days": int,
            }
        """
        cutoff = datetime.utcnow() - timedelta(days=days)
        q_pattern = f"%{q}%" if q else ""
        offset = (page - 1) * size

        # 1) 총 고유 질문 수
        total_result = await self.session.execute(
            text("""
                SELECT COUNT(DISTINCT query_text) AS total
                FROM search_events
                WHERE created_at >= :cutoff
                  AND (:q = '' OR query_text ILIKE :q_pattern)
            """),
            {"cutoff": cutoff, "q": q, "q_pattern": q_pattern},
        )
        total = total_result.scalar_one() or 0

        if total == 0:
            return {
                "items": [],
                "total": 0,
                "page": page,
                "size": size,
                "days": days,
            }

        # 2) 페이지 항목 + 부정 피드백 집계
        items_result = await self.session.execute(
            text("""
                WITH agg AS (
                    SELECT
                        se.query_text,
                        COUNT(*)::int AS count,
                        MAX(se.created_at) AS latest_at,
                        ARRAY_AGG(DISTINCT se.message_id) AS assistant_ids
                    FROM search_events se
                    WHERE se.created_at >= :cutoff
                      AND (:q = '' OR se.query_text ILIKE :q_pattern)
                    GROUP BY se.query_text
                )
                SELECT
                    agg.query_text,
                    agg.count,
                    agg.latest_at,
                    COALESCE(
                        (SELECT COUNT(*) FROM answer_feedback af
                         WHERE af.message_id = ANY(agg.assistant_ids)
                           AND af.feedback_type != 'HELPFUL'),
                        0
                    )::int AS negative_feedback_count
                FROM agg
                ORDER BY
                    CASE WHEN :sort = 'count_desc'  THEN agg.count END DESC,
                    CASE WHEN :sort = 'count_asc'   THEN agg.count END ASC,
                    CASE WHEN :sort = 'recent_desc' THEN agg.latest_at END DESC,
                    CASE WHEN :sort = 'recent_asc'  THEN agg.latest_at END ASC,
                    agg.query_text ASC
                LIMIT :limit OFFSET :offset
            """),
            {
                "cutoff": cutoff,
                "q": q,
                "q_pattern": q_pattern,
                "sort": sort,
                "limit": size,
                "offset": offset,
            },
        )

        items = [
            {
                "query_text": row.query_text,
                "count": row.count,
                "latest_at": row.latest_at,
                "negative_feedback_count": row.negative_feedback_count,
            }
            for row in items_result.all()
        ]

        return {
            "items": items,
            "total": total,
            "page": page,
            "size": size,
            "days": days,
        }
```

- [ ] **Step 2: 임포트 검증**

Run: `cd backend && uv run python -c "from src.admin.analytics_repository import AnalyticsRepository; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/analytics_repository.py
git commit -m "feat(analytics): add get_queries repository method"
```

---

## Task 3: Backend — Router 엔드포인트 추가

**Files:**
- Modify: `backend/src/admin/analytics_router.py`

- [ ] **Step 1: 스키마 임포트에 QueryListResponse 추가**

`analytics_router.py` 상단 임포트 블록에서 `analytics_schemas` from-import에 `QueryListResponse` 삽입 (알파벳순):

```python
from src.admin.analytics_schemas import (
    DailyCount,
    DashboardSummary,
    FeedbackSummary,
    FeedbackDistribution,
    NegativeFeedbackItem,
    QueryDetailResponse,
    QueryListResponse,
    SearchStats,
    TopQuery,
)
```

- [ ] **Step 2: 엔드포인트 추가**

파일 끝(기존 `get_query_details` 이후)에 추가:

```python
@router.get("/search/queries", response_model=QueryListResponse)
async def get_queries(
    q: str = Query(default="", max_length=500),
    days: int = Query(default=30, ge=1, le=365),
    sort: str = Query(
        default="count_desc",
        pattern="^(count_desc|count_asc|recent_desc|recent_asc)$",
    ),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=100),
    repo: AnalyticsRepository = Depends(_get_repo),
    current_admin: dict = Depends(get_current_admin),
) -> QueryListResponse:
    """고유 질문 집계 + 검색/정렬/페이지네이션."""
    data = await repo.get_queries(q=q, days=days, sort=sort, page=page, size=size)
    return QueryListResponse(**data)
```

- [ ] **Step 3: 라우트 배선 검증**

Run:
```bash
cd backend && uv run python -c "from src.admin.analytics_router import router; \
  routes = [r.path for r in router.routes]; \
  assert '/admin/analytics/search/queries' in routes, routes; \
  print('ok')"
```
Expected: `ok`

- [ ] **Step 4: 커밋**

```bash
git add backend/src/admin/analytics_router.py
git commit -m "feat(analytics): add GET /search/queries endpoint"
```

---

## Task 4: Backend — pytest 통합 테스트 7건

**Files:**
- Create: `backend/tests/test_analytics_queries.py`

기존 `test_analytics_query_details.py` 패턴을 따라 `app.dependency_overrides`로 repo를 AsyncMock으로 대체.

- [ ] **Step 1: 파일 생성**

```python
# backend/tests/test_analytics_queries.py
"""Analytics /search/queries 엔드포인트 테스트."""

import uuid
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport

with patch("main.init_db", new_callable=AsyncMock):
    from main import app

from src.admin.analytics_repository import AnalyticsRepository
from src.admin.analytics_router import _get_repo
from src.admin.dependencies import get_current_admin


def _mock_admin():
    return {"user_id": uuid.uuid4(), "role": "admin"}


@pytest.fixture
def async_client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def override_admin_auth():
    app.dependency_overrides[get_current_admin] = _mock_admin
    yield
    app.dependency_overrides.pop(get_current_admin, None)


def _override_repo(repo: AsyncMock):
    app.dependency_overrides[_get_repo] = lambda: repo


def _clear_repo_override():
    app.dependency_overrides.pop(_get_repo, None)


@pytest.mark.asyncio
async def test_queries_returns_empty_when_no_match(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


@pytest.mark.asyncio
async def test_queries_returns_items_sorted_by_count_desc(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [
            {
                "query_text": "36가정 축복",
                "count": 3,
                "latest_at": datetime(2026, 4, 17, 12, 34),
                "negative_feedback_count": 1,
            },
            {
                "query_text": "노조와 사조직",
                "count": 2,
                "latest_at": datetime(2026, 4, 17, 1, 3),
                "negative_feedback_count": 0,
            },
        ],
        "total": 2,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()

    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["items"][0]["query_text"] == "36가정 축복"
    assert body["items"][0]["count"] == 3
    assert body["items"][0]["negative_feedback_count"] == 1


@pytest.mark.asyncio
async def test_queries_respects_sort_recent_desc(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"sort": "recent_desc"},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_queries.assert_awaited_once_with(
        q="", days=30, sort="recent_desc", page=1, size=50
    )


@pytest.mark.asyncio
async def test_queries_applies_ilike_search(async_client, override_admin_auth):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 0,
        "page": 1,
        "size": 50,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"q": "천일국"},
            )
    finally:
        _clear_repo_override()
    assert resp.status_code == 200
    repo.get_queries.assert_awaited_once_with(
        q="천일국", days=30, sort="count_desc", page=1, size=50
    )


@pytest.mark.asyncio
async def test_queries_paginates_with_size_and_page(
    async_client, override_admin_auth
):
    repo = AsyncMock(spec=AnalyticsRepository)
    repo.get_queries.return_value = {
        "items": [],
        "total": 120,
        "page": 3,
        "size": 20,
        "days": 30,
    }
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get(
                "/admin/analytics/search/queries",
                params={"page": 3, "size": 20},
            )
    finally:
        _clear_repo_override()
    body = resp.json()
    assert body["total"] == 120
    assert body["page"] == 3
    assert body["size"] == 20


@pytest.mark.asyncio
async def test_queries_rejects_invalid_sort(async_client, override_admin_auth):
    async with async_client as client:
        resp = await client.get(
            "/admin/analytics/search/queries",
            params={"sort": "invalid_value"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_queries_requires_admin_auth(async_client):
    repo = AsyncMock(spec=AnalyticsRepository)
    _override_repo(repo)
    try:
        async with async_client as client:
            resp = await client.get("/admin/analytics/search/queries")
    finally:
        _clear_repo_override()
    assert resp.status_code == 401
```

- [ ] **Step 2: 테스트 실행**

Run: `cd backend && uv run pytest tests/test_analytics_queries.py -v`
Expected: 7 tests PASS

- [ ] **Step 3: 전체 회귀 확인**

Run: `cd backend && uv run pytest tests/ -q`
Expected: 직전 대비 +7 PASS, 기타 회귀 없음

- [ ] **Step 4: 커밋**

```bash
git add backend/tests/test_analytics_queries.py
git commit -m "test(analytics): integration tests for /search/queries endpoint"
```

---

## Task 5: Frontend — shadcn Tooltip 컴포넌트 추가

**Files:**
- Create: `admin/src/components/ui/tooltip.tsx` (shadcn CLI로 자동 생성)

- [ ] **Step 1: shadcn 설치 명령 실행**

Run: `cd admin && pnpm dlx shadcn@latest add tooltip`
Expected: `admin/src/components/ui/tooltip.tsx` 생성. 터미널이 interactive prompt를 띄우면 기본값(Overwrite: No, Project: current) 선택.

- [ ] **Step 2: 생성된 파일 확인**

Run: `ls -la admin/src/components/ui/tooltip.tsx`
Expected: 파일 존재

Run: `head -5 admin/src/components/ui/tooltip.tsx`
Expected: `"use client"` 포함, `@base-ui/react/tooltip` import 라인 존재

- [ ] **Step 3: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: 커밋**

```bash
git add admin/src/components/ui/tooltip.tsx admin/package.json admin/pnpm-lock.yaml
git commit -m "chore(ui): add shadcn tooltip component"
```

---

## Task 6: Frontend — TruncateTooltip 래퍼 컴포넌트

**Files:**
- Create: `admin/src/features/analytics/components/truncate-tooltip.tsx`

- [ ] **Step 1: 컴포넌트 작성**

```tsx
// admin/src/features/analytics/components/truncate-tooltip.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface Props {
  text: string;
  className?: string;
  maxWidth?: string;
}

export function TruncateTooltip({
  text,
  className = "",
  maxWidth = "max-w-md",
}: Props) {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setIsTouchDevice(window.matchMedia("(hover: none)").matches);
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={isTouchDevice ? open : undefined} onOpenChange={setOpen}>
        <TooltipTrigger
          asChild
          onClick={(e) => {
            if (isTouchDevice) {
              e.stopPropagation();
              setOpen((prev) => !prev);
            }
          }}
        >
          <span className={`block truncate cursor-help text-left ${className}`}>
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent
          className={`${maxWidth} whitespace-pre-wrap break-words text-xs leading-relaxed`}
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

> 주: shadcn Tooltip API가 `TooltipProvider`를 요구할 수 있음. Task 5에서 생성된 `tooltip.tsx`의 export를 먼저 확인하고, 만약 `TooltipProvider`가 export 되지 않으면 해당 줄들을 제거하고 단순히 `Tooltip/TooltipTrigger/TooltipContent`만 사용. (shadcn v4는 대부분 `TooltipProvider` 포함)

- [ ] **Step 2: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors. 에러가 있으면 위 note대로 TooltipProvider 제거 후 재시도.

- [ ] **Step 3: 커밋**

```bash
git add admin/src/features/analytics/components/truncate-tooltip.tsx
git commit -m "feat(analytics): add TruncateTooltip wrapper with mobile tap toggle"
```

---

## Task 7: Frontend — 타입 및 API 클라이언트 확장

**Files:**
- Modify: `admin/src/features/analytics/types.ts`
- Modify: `admin/src/features/analytics/api.ts`

- [ ] **Step 1: 타입 추가 (types.ts 끝에)**

```typescript
export type QuerySortKey =
  | "count_desc"
  | "count_asc"
  | "recent_desc"
  | "recent_asc";

export interface QueryListItem {
  query_text: string;
  count: number;
  latest_at: string;
  negative_feedback_count: number;
}

export interface QueryListResponse {
  items: QueryListItem[];
  total: number;
  page: number;
  size: number;
  days: number;
}
```

- [ ] **Step 2: API 클라이언트에 getQueries 추가**

`admin/src/features/analytics/api.ts`의 import 블록에 `QueryListResponse, QuerySortKey` 추가:

```typescript
import type {
  DashboardSummary,
  DailyCount,
  SearchStats,
  TopQuery,
  FeedbackSummary,
  NegativeFeedbackItem,
  QueryDetail,
  QueryListResponse,
  QuerySortKey,
} from "./types";
```

그리고 `analyticsAPI` 객체 끝에 추가:

```typescript
  getQueries: (params: {
    q?: string;
    days?: number;
    sort?: QuerySortKey;
    page?: number;
    size?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    qs.set("days", String(params.days ?? 30));
    qs.set("sort", params.sort ?? "count_desc");
    qs.set("page", String(params.page ?? 1));
    qs.set("size", String(params.size ?? 50));
    return fetchAPI<QueryListResponse>(
      `/admin/analytics/search/queries?${qs.toString()}`
    );
  },
```

- [ ] **Step 3: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 4: 커밋**

```bash
git add admin/src/features/analytics/types.ts admin/src/features/analytics/api.ts
git commit -m "feat(analytics): add query list types and getQueries API"
```

---

## Task 8: Frontend — 질문 탐색 페이지 본체

**Files:**
- Create: `admin/src/app/(dashboard)/analytics/queries/page.tsx`

- [ ] **Step 1: 페이지 컴포넌트 작성**

```tsx
// admin/src/app/(dashboard)/analytics/queries/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { analyticsAPI } from "@/features/analytics/api";
import type { QuerySortKey } from "@/features/analytics/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
import QueryDetailModal from "@/features/analytics/components/query-detail-modal";

const DAYS_OPTIONS = [7, 30, 90, 365];
const SORT_LABEL: Record<QuerySortKey, string> = {
  count_desc: "횟수 ↓",
  count_asc: "횟수 ↑",
  recent_desc: "최근 발생 ↓",
  recent_asc: "최근 발생 ↑",
};

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function QueriesExplorerPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const q = sp.get("q") ?? "";
  const days = Number(sp.get("days") ?? 30);
  const sort = (sp.get("sort") ?? "count_desc") as QuerySortKey;
  const page = Number(sp.get("page") ?? 1);
  const size = 50;

  const [searchInput, setSearchInput] = useState(q);
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // 검색어 debounce (300ms)
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== q) {
        updateParams({ q: searchInput, page: 1 });
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const updateParams = (changes: Record<string, string | number>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === "" || v === undefined || v === null) {
        params.delete(k);
      } else {
        params.set(k, String(v));
      }
    }
    router.push(`/analytics/queries?${params.toString()}`);
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["queries", q, days, sort, page, size],
    queryFn: () => analyticsAPI.getQueries({ q, days, sort, page, size }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / size)) : 1;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* 헤더 */}
      <div>
        <nav className="text-xs text-muted-foreground">
          <Link href="/analytics" className="hover:underline">
            검색 분석
          </Link>
          <span className="mx-1">›</span>
          <span>질문 탐색</span>
        </nav>
        <h1 className="text-2xl font-bold tracking-tight mt-2">질문 탐색</h1>
        <p className="text-sm text-muted-foreground mt-1">
          전체 질문을 검색·정렬하고 각 질문의 상세를 확인합니다
        </p>
      </div>

      {/* 필터 바 */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="질문 검색..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">기간</span>
            <select
              value={days}
              onChange={(e) =>
                updateParams({ days: Number(e.target.value), page: 1 })
              }
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  최근 {d}일
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-muted-foreground text-xs">정렬</span>
            <select
              value={sort}
              onChange={(e) =>
                updateParams({ sort: e.target.value, page: 1 })
              }
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {(Object.keys(SORT_LABEL) as QuerySortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        {isLoading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-10">
            <p className="text-sm text-muted-foreground">
              데이터를 불러오지 못했습니다
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              다시 시도
            </Button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center">
            조건에 맞는 질문이 없습니다
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground w-10">
                    순위
                  </th>
                  <th className="py-2 px-3 text-left text-xs font-medium text-muted-foreground">
                    질문
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-16">
                    횟수
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-14">
                    👎
                  </th>
                  <th className="py-2 px-3 text-right text-xs font-medium text-muted-foreground w-36">
                    최근 발생
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => {
                  const rank = (page - 1) * size + i + 1;
                  return (
                    <tr
                      key={`${item.query_text}-${i}`}
                      className={
                        (i !== 0 ? "border-t " : "") +
                        "cursor-pointer hover:bg-muted/40 transition-colors"
                      }
                      onClick={() => setSelectedQuery(item.query_text)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedQuery(item.query_text);
                        }
                      }}
                      title="클릭하면 상세 정보를 확인할 수 있습니다"
                    >
                      <td className="py-2 px-3 text-muted-foreground font-mono text-xs">
                        {rank}
                      </td>
                      <td className="py-2 px-3 max-w-0 w-full">
                        <TruncateTooltip text={item.query_text} />
                      </td>
                      <td className="py-2 px-3 text-right font-medium">
                        {item.count.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {item.negative_feedback_count > 0 ? (
                          <span className="text-rose-600 font-medium">
                            {item.negative_feedback_count}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-xs text-muted-foreground">
                        {formatDateTime(item.latest_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 페이지네이션 */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              총 {data.total.toLocaleString()}건 · {size}개/페이지
            </span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => updateParams({ page: page - 1 })}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 font-mono">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: page + 1 })}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 질문 상세 모달 (기존 재사용) */}
      <QueryDetailModal
        open={selectedQuery !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedQuery(null);
        }}
        queryText={selectedQuery}
        days={days}
      />
    </div>
  );
}
```

- [ ] **Step 2: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 3: 커밋**

```bash
git add "admin/src/app/(dashboard)/analytics/queries/page.tsx"
git commit -m "feat(analytics): add /analytics/queries explorer page"
```

---

## Task 9: Frontend — Top 10 카드 "모두 보기" 링크 + TruncateTooltip 교체

**Files:**
- Modify: `admin/src/app/(dashboard)/analytics/page.tsx`

- [ ] **Step 1: 임포트 추가**

`admin/src/app/(dashboard)/analytics/page.tsx` 상단 임포트에 `Link`와 `TruncateTooltip` 추가:

```typescript
import Link from "next/link";
import { TruncateTooltip } from "@/features/analytics/components/truncate-tooltip";
```

- [ ] **Step 2: Top 10 카드 헤더를 수정**

`TopQueriesTable` 함수 내 최상단 `<h2 className="text-sm font-semibold">인기 질문 Top 10</h2>` 라인을 아래로 교체:

```tsx
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">인기 질문 Top 10</h2>
        <Link
          href="/analytics/queries"
          className="text-xs text-primary hover:underline"
        >
          모두 보기 →
        </Link>
      </div>
```

- [ ] **Step 3: 질문 셀의 `<span title={...}>` 교체**

`TopQueriesTable` 함수 내 `<td className="py-2 px-3 truncate max-w-0 w-full">` 블록:

```tsx
                  <td className="py-2 px-3 truncate max-w-0 w-full">
                    <span className="block truncate" title={q.query_text}>
                      {q.query_text}
                    </span>
                  </td>
```

위 부분을 아래로 교체:

```tsx
                  <td className="py-2 px-3 max-w-0 w-full">
                    <TruncateTooltip text={q.query_text} />
                  </td>
```

- [ ] **Step 4: 타입체크**

Run: `cd admin && pnpm tsc --noEmit`
Expected: no errors

- [ ] **Step 5: 커밋**

```bash
git add "admin/src/app/(dashboard)/analytics/page.tsx"
git commit -m "feat(analytics): link Top 10 to full explorer + TruncateTooltip"
```

---

## Task 10: Frontend — queries-page vitest 5건

**Files:**
- Create: `admin/src/test/queries-page.test.tsx`

- [ ] **Step 1: 테스트 작성**

```tsx
// admin/src/test/queries-page.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { QueryListResponse } from "@/features/analytics/types";

const mockGetQueries = vi.fn();
vi.mock("@/features/analytics/api", () => ({
  analyticsAPI: {
    getQueries: (...args: unknown[]) => mockGetQueries(...args),
    getQueryDetails: vi.fn().mockResolvedValue({
      query_text: "",
      total_count: 0,
      returned_count: 0,
      days: 30,
      occurrences: [],
    }),
  },
}));

const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

import QueriesExplorerPage from "@/app/(dashboard)/analytics/queries/page";

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <QueriesExplorerPage />
    </QueryClientProvider>
  );
}

function fixture(
  overrides: Partial<QueryListResponse> = {}
): QueryListResponse {
  return {
    items: [],
    total: 0,
    page: 1,
    size: 50,
    days: 30,
    ...overrides,
  };
}

beforeEach(() => {
  mockGetQueries.mockReset();
  mockPush.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("QueriesExplorerPage", () => {
  it("빈 결과면 안내 문구를 보여준다", async () => {
    mockGetQueries.mockResolvedValue(fixture({ total: 0, items: [] }));
    renderPage();
    expect(await screen.findByText(/조건에 맞는 질문이 없습니다/)).toBeDefined();
  });

  it("결과가 있으면 순위와 질문 텍스트가 노출된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 2,
        items: [
          {
            query_text: "36가정 축복",
            count: 3,
            latest_at: "2026-04-17T12:34:00",
            negative_feedback_count: 1,
          },
          {
            query_text: "노조와 사조직",
            count: 2,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    expect(await screen.findAllByText("36가정 축복")).toBeDefined();
    expect(screen.getAllByText("노조와 사조직")).toBeDefined();
  });

  it("행 클릭 시 모달이 열린다(QueryDetailModal)", async () => {
    const user = userEvent.setup();
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "천일국",
            count: 1,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    const rowButton = await screen.findByRole("button", { name: /천일국/ });
    await user.click(rowButton);
    // 모달 열림 → 헤더 제목이 document.body에 나타남
    await waitFor(() => {
      expect(document.body.textContent).toContain("천일국");
    });
  });

  it("부정 피드백 0건은 대시(—)로 표기된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "안녕",
            count: 1,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 0,
          },
        ],
      })
    );
    renderPage();
    await screen.findByText("안녕");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("부정 피드백 >0 은 숫자로 노출된다", async () => {
    mockGetQueries.mockResolvedValue(
      fixture({
        total: 1,
        items: [
          {
            query_text: "삼대상목적",
            count: 2,
            latest_at: "2026-04-17T01:03:00",
            negative_feedback_count: 2,
          },
        ],
      })
    );
    renderPage();
    expect(await screen.findByText("2")).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `cd admin && pnpm test src/test/queries-page.test.tsx`
Expected: 5 tests PASS

- [ ] **Step 3: 커밋**

```bash
git add admin/src/test/queries-page.test.tsx
git commit -m "test(analytics): add QueriesExplorerPage vitest cases"
```

---

## Task 11: 최종 검증

**Files:** (없음, 검증)

- [ ] **Step 1: Backend 전체 테스트**

Run: `cd backend && uv run pytest tests/ -q`
Expected: 직전 대비 +7 PASS, 회귀 없음

- [ ] **Step 2: Frontend 전체 테스트**

Run: `cd admin && pnpm test`
Expected: 기존 + 신규 5건 PASS (login.test.tsx 기존 flaky는 미해결이어도 무방)

- [ ] **Step 3: 타입체크 + 린트**

Run: `cd admin && pnpm tsc --noEmit && pnpm lint`
Expected: no errors

- [ ] **Step 4: 브라우저 E2E (Playwright MCP 또는 사용자 직접)**

1. `pnpm dev` + backend 실행
2. `/analytics` 진입 → Top 10 카드 헤더 "모두 보기 →" 링크 확인
3. 링크 클릭 → `/analytics/queries` 이동
4. 검색 입력 "천일국" → 300ms 후 결과 재조회 확인
5. 기간 셀렉트 변경 → URL 업데이트 + 재조회
6. 정렬 변경 → 결과 순서 바뀜 확인
7. 행 클릭 → 기존 QueryDetailModal 오픈, 답변/출처 노출
8. 페이지네이션 다음/이전 동작 확인
9. 긴 질문 셀 hover → 툴팁 전체 노출
10. 콘솔 에러 없음

- [ ] **Step 5: main 대비 커밋 요약 확인**

Run: `git log main..HEAD --oneline`
Expected: Task 1-10의 커밋 10~11건

---

## Done Criteria

- `/analytics/queries`에서 전체 질문을 검색/정렬/페이지네이션으로 탐색 가능
- Top 10 카드에 "모두 보기 →" 링크가 있고 질문 셀은 TruncateTooltip으로 교체됨
- 각 행 클릭 → 기존 QueryDetailModal이 그대로 오픈
- Backend 신규 7건 pytest + Frontend 신규 5건 vitest 모두 통과
- 타입체크·린트·브라우저 E2E 통과
