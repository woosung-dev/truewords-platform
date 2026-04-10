# 카테고리별 문서 매핑 현황 표시 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자 카테고리 탭에서 각 카테고리의 문서 수/청크 수를 실시간으로 표시하고, 행 확장 시 volume 목록을 보여준다.

**Architecture:** 백엔드에서 Qdrant `count` + `scroll`을 `asyncio.gather`로 병렬 호출하여 카테고리별 통계를 집계하는 API를 추가하고, 프론트엔드 카테고리 탭 테이블에 통계 컬럼과 확장 행을 추가한다.

**Tech Stack:** FastAPI, Qdrant (AsyncQdrantClient), React, TanStack Query, Tailwind CSS, shadcn/ui, lucide-react

**Design notes:** UI 구현 시 `ui-ux-pro-max` 스킬을 사용하여 색상/스타일 디테일을 마무리할 것.

---

## 파일 구조

| 파일 | 변경 | 역할 |
|------|------|------|
| `backend/src/datasource/schemas.py` | 수정 | `CategoryDocumentStats` 응답 스키마 추가 |
| `backend/src/admin/data_router.py` | 수정 | `GET /admin/data-sources/category-stats` 엔드포인트 추가 |
| `admin/src/lib/api.ts` | 수정 | `CategoryDocumentStats` 타입 + `getCategoryStats()` 메서드 추가 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | 수정 | `useCategoryStats()` 훅 추가 |
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | 수정 | 테이블에 문서/청크 컬럼 + 확장 행 추가 |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | 수정 | 업로드 후 `["category-stats"]` 캐시 무효화 |

---

### Task 1: 백엔드 — 응답 스키마 추가

**Files:**
- Modify: `backend/src/datasource/schemas.py:1-40`

- [ ] **Step 1: `CategoryDocumentStats` 스키마 추가**

`backend/src/datasource/schemas.py` 파일 끝에 추가:

```python
class CategoryDocumentStats(BaseModel):
    """카테고리별 Qdrant 문서 통계."""
    source: str              # 카테고리 key (e.g. "A")
    total_chunks: int        # Qdrant 포인트 총 수
    volumes: list[str]       # 고유 volume 목록 (알파벳순 정렬)
    volume_count: int        # len(volumes) — 프론트 편의용
```

- [ ] **Step 2: 커밋**

```bash
git add backend/src/datasource/schemas.py
git commit -m "feat: CategoryDocumentStats 응답 스키마 추가"
```

---

### Task 2: 백엔드 — API 엔드포인트 추가

**Files:**
- Modify: `backend/src/admin/data_router.py:1-164`

- [ ] **Step 1: import 추가**

`backend/src/admin/data_router.py` 상단 import 섹션에 추가:

```python
import asyncio

from qdrant_client.models import Filter, FieldCondition, MatchValue

from src.datasource.schemas import CategoryDocumentStats
from src.qdrant_client import get_async_client
```

기존 import에서 `get_client`는 유지 (upload에서 사용).

- [ ] **Step 2: `category-stats` 엔드포인트 구현**

`backend/src/admin/data_router.py`의 `get_ingest_status` 함수 아래에 추가:

```python
@router.get("/category-stats", response_model=list[CategoryDocumentStats])
async def get_category_stats(
    current_admin: dict = Depends(get_current_admin),
    datasource_service: DataSourceCategoryService = Depends(get_datasource_service),
):
    """카테고리별 Qdrant 문서/청크 통계를 반환합니다."""
    categories = await datasource_service.list_all()
    if not categories:
        return []

    client = get_async_client()
    collection = settings.collection_name

    async def count_chunks(source_key: str) -> int:
        """카테고리별 청크 수 조회."""
        result = await client.count(
            collection_name=collection,
            count_filter=Filter(
                must=[FieldCondition(key="source", match=MatchValue(value=source_key))]
            ),
            exact=True,
        )
        return result.count

    async def collect_volumes(source_key: str) -> list[str]:
        """카테고리별 고유 volume 목록 수집 (페이지네이션 순회)."""
        volumes: set[str] = set()
        offset = None
        while True:
            points, offset = await client.scroll(
                collection_name=collection,
                scroll_filter=Filter(
                    must=[FieldCondition(key="source", match=MatchValue(value=source_key))]
                ),
                with_payload=["volume"],
                with_vectors=False,
                limit=1000,
                offset=offset,
            )
            for p in points:
                vol = p.payload.get("volume")
                if vol:
                    volumes.add(vol)
            if offset is None:
                break
        return sorted(volumes)

    # 모든 카테고리에 대해 count + scroll 병렬 실행
    tasks: list = []
    for cat in categories:
        tasks.append(count_chunks(cat.key))
        tasks.append(collect_volumes(cat.key))

    results = await asyncio.gather(*tasks)

    # 결과 조합: [count_A, volumes_A, count_B, volumes_B, ...]
    stats: list[CategoryDocumentStats] = []
    for i, cat in enumerate(categories):
        chunk_count = results[i * 2]
        volumes = results[i * 2 + 1]
        stats.append(
            CategoryDocumentStats(
                source=cat.key,
                total_chunks=chunk_count,
                volumes=volumes,
                volume_count=len(volumes),
            )
        )

    return stats
```

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/data_router.py
git commit -m "feat: GET /admin/data-sources/category-stats 엔드포인트 추가"
```

---

### Task 3: 프론트엔드 — API 타입 & 클라이언트

**Files:**
- Modify: `admin/src/lib/api.ts:186-215`

- [ ] **Step 1: `CategoryDocumentStats` 타입 추가**

`admin/src/lib/api.ts`에서 `DataSourceCategory` 인터페이스 아래(197행 뒤)에 추가:

```typescript
export interface CategoryDocumentStats {
  source: string;
  total_chunks: number;
  volumes: string[];
  volume_count: number;
}
```

- [ ] **Step 2: `getCategoryStats` 메서드 추가**

같은 파일의 `dataSourceCategoryAPI` 객체에 메서드 추가. 기존 `delete` 메서드 뒤에 추가:

```typescript
  getCategoryStats: () =>
    fetchAPI<CategoryDocumentStats[]>("/admin/data-sources/category-stats"),
```

- [ ] **Step 3: 커밋**

```bash
git add admin/src/lib/api.ts
git commit -m "feat: CategoryDocumentStats 타입 및 getCategoryStats API 메서드 추가"
```

---

### Task 4: 프론트엔드 — React Query 훅

**Files:**
- Modify: `admin/src/lib/hooks/use-data-source-categories.ts:1-27`

- [ ] **Step 1: `useCategoryStats` 훅 추가**

`admin/src/lib/hooks/use-data-source-categories.ts` 파일 수정. import 라인과 훅 추가:

import 라인을 수정:

```typescript
import { dataSourceCategoryAPI, type DataSourceCategory } from "@/lib/api";
```

위를 아래로 변경:

```typescript
import {
  dataSourceCategoryAPI,
  type DataSourceCategory,
  type CategoryDocumentStats,
} from "@/lib/api";
```

파일 끝에 훅 추가:

```typescript
export function useCategoryStats() {
  return useQuery<CategoryDocumentStats[]>({
    queryKey: ["category-stats"],
    queryFn: dataSourceCategoryAPI.getCategoryStats,
    staleTime: 60_000, // 60초 캐시
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add admin/src/lib/hooks/use-data-source-categories.ts
git commit -m "feat: useCategoryStats React Query 훅 추가"
```

---

### Task 5: 프론트엔드 — 카테고리 탭 UI 확장

**Files:**
- Modify: `admin/src/app/(dashboard)/data-sources/category-tab.tsx:1-378`

> **NOTE:** 이 태스크에서 UI 스타일링은 `ui-ux-pro-max` 스킬을 사용하여 마무리한다.

- [ ] **Step 1: import 추가**

`category-tab.tsx` 상단에 추가 import:

```typescript
import { ChevronRight, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryStats } from "@/lib/hooks/use-data-source-categories";
import type { CategoryDocumentStats } from "@/lib/api";
```

기존 lucide-react import에서 `ChevronRight`, `ChevronDown`을 추가하면 됨:

```typescript
import { Plus, Pencil, Power, ChevronRight, ChevronDown } from "lucide-react";
```

- [ ] **Step 2: 상태 + 데이터 준비**

`CategoryTab` 컴포넌트 내부, 기존 `const [sheetOpen, setSheetOpen] = useState(false);` 근처에 추가:

```typescript
const { data: categoryStats, isLoading: statsLoading } = useCategoryStats();
const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

// source key → stats 매핑 (O(1) 조회용)
const statsMap = useMemo(() => {
  const map = new Map<string, CategoryDocumentStats>();
  categoryStats?.forEach((s) => map.set(s.source, s));
  return map;
}, [categoryStats]);

function toggleExpand(key: string) {
  setExpandedKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  });
}
```

`useMemo`는 이미 import되어 있음 (1행).

- [ ] **Step 3: 테이블 헤더 수정**

기존 `<thead>` 부분:

```tsx
<tr className="border-b bg-muted/40">
  <th className="text-left font-medium px-4 py-2.5">Key</th>
  <th className="text-left font-medium px-4 py-2.5">이름</th>
  <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">설명</th>
  <th className="text-left font-medium px-4 py-2.5">색상</th>
  <th className="text-center font-medium px-4 py-2.5">상태</th>
  <th className="text-right font-medium px-4 py-2.5">액션</th>
</tr>
```

변경 후:

```tsx
<tr className="border-b bg-muted/40">
  <th className="w-8 px-2 py-2.5" />
  <th className="text-left font-medium px-4 py-2.5">Key</th>
  <th className="text-left font-medium px-4 py-2.5">이름</th>
  <th className="text-left font-medium px-4 py-2.5">문서 / 청크</th>
  <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">색상</th>
  <th className="text-center font-medium px-4 py-2.5">상태</th>
  <th className="text-right font-medium px-4 py-2.5">액션</th>
</tr>
```

변경점: (1) 빈 chevron 헤더 추가, (2) "설명" → "문서 / 청크" 교체, (3) 색상에 `hidden sm:table-cell` 추가.

- [ ] **Step 4: 테이블 본문 행 수정**

기존 `visibleCategories.map` 내부의 `<tr>` 전체를 교체. 기존:

```tsx
{visibleCategories.map((cat) => {
  const colors = getCategoryColors(cat.color);
  return (
    <tr
      key={cat.id}
      className={`border-b last:border-0 hover:bg-accent/30 transition-colors ${
        !cat.is_active ? "opacity-50" : ""
      }`}
    >
      <td className="px-4 py-3">
        <Badge variant="outline" className="font-mono text-xs">
          {cat.key}
        </Badge>
      </td>
      <td className="px-4 py-3 font-medium">{cat.name}</td>
      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
        {cat.description}
      </td>
      <td className="px-4 py-3">
        <div
          className={`w-5 h-5 rounded-full ${colors.bg} border ${colors.border}`}
          title={cat.color}
        />
      </td>
      <td className="px-4 py-3 text-center">
        <Badge
          className={
            cat.is_active
              ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"
              : "bg-slate-100 text-slate-500 hover:bg-slate-100 border-0"
          }
        >
          {cat.is_active ? "활성" : "비활성"}
        </Badge>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            title="편집"
            onClick={() => openEdit(cat)}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          {cat.is_active && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-destructive hover:text-destructive"
              title="비활성화"
              onClick={() => handleDeactivate(cat)}
            >
              <Power className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
})}
```

변경 후:

```tsx
{visibleCategories.map((cat) => {
  const colors = getCategoryColors(cat.color);
  const stat = statsMap.get(cat.key);
  const hasVolumes = stat && stat.volume_count > 0;
  const isExpanded = expandedKeys.has(cat.key);

  return (
    <Fragment key={cat.id}>
      <tr
        className={`border-b last:border-0 transition-colors ${
          !cat.is_active ? "opacity-50" : ""
        } ${hasVolumes ? "cursor-pointer hover:bg-accent/30" : "hover:bg-accent/30"}`}
        onClick={() => hasVolumes && toggleExpand(cat.key)}
      >
        {/* 확장 아이콘 */}
        <td className="w-8 px-2 py-3 text-center">
          {hasVolumes && (
            <button
              type="button"
              className="p-0.5 rounded hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(cat.key);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          )}
        </td>
        <td className="px-4 py-3">
          <Badge variant="outline" className="font-mono text-xs">
            {cat.key}
          </Badge>
        </td>
        <td className="px-4 py-3 font-medium">{cat.name}</td>
        {/* 문서 / 청크 */}
        <td className="px-4 py-3">
          {statsLoading ? (
            <Skeleton className="h-4 w-28" />
          ) : stat && stat.volume_count > 0 ? (
            <span className="text-sm">
              <span className="font-semibold">{stat.volume_count}</span>
              <span className="text-muted-foreground"> 문서 · </span>
              <span className="font-semibold">{stat.total_chunks.toLocaleString()}</span>
              <span className="text-muted-foreground"> 청크</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">문서 없음</span>
          )}
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <div
            className={`w-5 h-5 rounded-full ${colors.bg} border ${colors.border}`}
            title={cat.color}
          />
        </td>
        <td className="px-4 py-3 text-center">
          <Badge
            className={
              cat.is_active
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0"
                : "bg-slate-100 text-slate-500 hover:bg-slate-100 border-0"
            }
          >
            {cat.is_active ? "활성" : "비활성"}
          </Badge>
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              title="편집"
              onClick={(e) => {
                e.stopPropagation();
                openEdit(cat);
              }}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            {cat.is_active && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive hover:text-destructive"
                title="비활성화"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeactivate(cat);
                }}
              >
                <Power className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </td>
      </tr>

      {/* 확장 행: volume 목록 */}
      {isExpanded && stat && (
        <tr className="bg-muted/20">
          <td />
          <td colSpan={6} className="px-4 pb-3 pt-1">
            <div
              className="border-l-[3px] pl-3 ml-2"
              style={{ borderColor: `var(--color-${cat.color}, #94a3b8)` }}
            >
              <p className="text-xs text-muted-foreground mb-2">포함된 문서</p>
              <div className="flex flex-wrap gap-1.5">
                {stat.volumes.map((vol) => (
                  <Badge key={vol} variant="secondary" className="text-xs font-normal">
                    {vol}
                  </Badge>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
})}
```

- [ ] **Step 5: `Fragment` import 추가**

기존 React import 수정:

```typescript
import { useState, useMemo } from "react";
```

변경:

```typescript
import { Fragment, useState, useMemo } from "react";
```

- [ ] **Step 6: 빈 상태 colSpan 수정**

기존 빈 상태 `colSpan={6}`을 `colSpan={7}`로 변경 (열이 1개 추가됐으므로):

```tsx
<td
  colSpan={7}
  className="px-4 py-12 text-center text-muted-foreground"
>
```

- [ ] **Step 7: 커밋**

```bash
git add admin/src/app/\(dashboard\)/data-sources/category-tab.tsx
git commit -m "feat: 카테고리 탭에 문서/청크 통계 컬럼 + 확장 행 추가"
```

---

### Task 6: 프론트엔드 — 업로드 후 캐시 무효화

**Files:**
- Modify: `admin/src/app/(dashboard)/data-sources/page.tsx:148-149`

- [ ] **Step 1: 캐시 무효화 추가**

`page.tsx`의 `uploadOne` 함수 내에서, 업로드 성공 후 `queryClient.invalidateQueries` 호출 부분(149행)을 수정:

기존:

```typescript
queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
```

변경:

```typescript
queryClient.invalidateQueries({ queryKey: ["ingest-status"] });
queryClient.invalidateQueries({ queryKey: ["category-stats"] });
```

- [ ] **Step 2: 커밋**

```bash
git add admin/src/app/\(dashboard\)/data-sources/page.tsx
git commit -m "feat: 업로드 성공 시 category-stats 캐시 무효화 추가"
```

---

### Task 7: 수동 검증

- [ ] **Step 1: 백엔드 서버 실행**

```bash
cd backend && uv run uvicorn main:app --reload --port 8000
```

- [ ] **Step 2: API 직접 호출 확인**

```bash
# 로그인 후 쿠키 사용하거나, 개발 도구에서 직접 호출
curl -s http://localhost:8000/admin/data-sources/category-stats \
  -H "Cookie: access_token=<JWT>" | python -m json.tool
```

예상 응답:
```json
[
  {
    "source": "A",
    "total_chunks": 1245,
    "volumes": ["말씀선집 제1권", "말씀선집 제2권", "말씀선집 제3권"],
    "volume_count": 3
  },
  {
    "source": "B",
    "total_chunks": 0,
    "volumes": [],
    "volume_count": 0
  }
]
```

- [ ] **Step 3: 프론트엔드 확인**

```bash
cd admin && npm run dev
```

1. 브라우저에서 `/data-sources` → "카테고리 관리" 탭 클릭
2. 각 카테고리 행에 "N 문서 · N,NNN 청크" 표시 확인
3. 데이터 없는 카테고리: "문서 없음" 표시 확인
4. 데이터 있는 카테고리 행 클릭 → volume 목록 확장/축소 확인
5. 데이터 없는 카테고리: chevron 숨김 + 클릭 불가 확인

- [ ] **Step 4: 캐시 무효화 확인**

1. "문서 업로드" 탭에서 파일 업로드 실행
2. 업로드 완료 후 "카테고리 관리" 탭 전환
3. 해당 카테고리의 문서/청크 수 업데이트 확인

---

## 체크리스트

- [ ] Task 1: 백엔드 스키마
- [ ] Task 2: 백엔드 API 엔드포인트
- [ ] Task 3: 프론트엔드 API 타입/클라이언트
- [ ] Task 4: 프론트엔드 React Query 훅
- [ ] Task 5: 프론트엔드 카테고리 탭 UI
- [ ] Task 6: 프론트엔드 캐시 무효화
- [ ] Task 7: 수동 검증
