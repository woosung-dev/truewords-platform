# 카테고리 태그 관리 Transfer UI 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transfer 패턴 기반의 카테고리-문서 관리 UI를 구현하여, 개별 문서 단위로 카테고리를 자유롭게 추가/제거할 수 있도록 한다.

**Architecture:** 새 API `GET /volumes`로 전체 volume 목록을 가져오고, 프론트에서 Transfer 컴포넌트(좌/우 패널 + 검색 + 전체 선택)를 Sheet 안에 렌더링한다. 일괄 저장 시 diff를 계산하여 기존 addVolumeTag/removeVolumeTag API를 순차 호출한다.

**Tech Stack:** FastAPI + Qdrant (백엔드), Next.js + React Query + Tailwind + @base-ui/react (프론트엔드)

**Spec:** `docs/superpowers/specs/2026-04-09-category-tag-transfer-ui-design.md`

---

## 파일 구조

### 신규 생성

| 파일 | 역할 |
|------|------|
| `admin/src/components/ui/volume-transfer.tsx` | Transfer 컴포넌트 (좌/우 패널, 검색, 전체 선택, 반응형 탭) |
| `admin/src/components/ui/volume-transfer-sheet.tsx` | Sheet 래퍼 (열기/닫기, diff 계산, 일괄 저장 로직) |

### 수정

| 파일 | 변경 |
|------|------|
| `backend/src/datasource/schemas.py` | VolumeInfo 스키마 추가 |
| `backend/src/admin/data_router.py` | GET /volumes 엔드포인트 추가, 업로드 source optional 처리 |
| `admin/src/lib/api.ts` | VolumeInfo 타입 + getAllVolumes() 추가 |
| `admin/src/lib/hooks/use-data-source-categories.ts` | useAllVolumes() 훅 추가 |
| `admin/src/app/(dashboard)/data-sources/category-tab.tsx` | "문서 관리" 버튼, 미분류 행, 기존 확장 행 태그 UI 제거 |
| `admin/src/app/(dashboard)/data-sources/page.tsx` | source 드롭다운 "미분류" 기본값 |

---

## Task 1: 백엔드 — VolumeInfo 스키마 추가

**Files:**
- Modify: `backend/src/datasource/schemas.py:56-60` (끝부분에 추가)

- [ ] **Step 1: VolumeInfo 스키마 추가**

`backend/src/datasource/schemas.py` 파일 끝에 추가:

```python
class VolumeInfo(BaseModel):
    """전체 volume 목록 조회 응답 — Transfer UI용"""
    volume: str = Field(..., description="문서(volume) 이름")
    sources: list[str] = Field(default_factory=list, description="속한 카테고리 key 배열")
    chunk_count: int = Field(..., description="청크 수")
```

- [ ] **Step 2: 커밋**

```bash
git add backend/src/datasource/schemas.py
git commit -m "feat: VolumeInfo 스키마 추가 (Transfer UI용)"
```

---

## Task 2: 백엔드 — GET /volumes 엔드포인트 추가

**Files:**
- Modify: `backend/src/admin/data_router.py:169-225` (category-stats 엔드포인트 아래에 추가)

- [ ] **Step 1: import에 VolumeInfo 추가**

`backend/src/admin/data_router.py` 상단의 schemas import 부분을 수정. 기존 import 라인을 찾아서 VolumeInfo를 추가:

```python
from src.datasource.schemas import (
    CategoryDocumentStats,
    VolumeTagRequest,
    VolumeTagResponse,
    VolumeInfo,
)
```

- [ ] **Step 2: GET /volumes 엔드포인트 구현**

`GET /category-stats` 엔드포인트(약 225번째 줄) 바로 아래에 추가:

```python
@router.get("/volumes", response_model=list[VolumeInfo])
async def get_all_volumes():
    """전체 volume 목록 조회 — Transfer UI용. volume별 sources와 chunk_count 반환."""
    from src.datasource.qdrant_client import get_qdrant_client, COLLECTION_NAME

    client = get_qdrant_client()

    # volume별 집계: {volume_name: {"sources": set(), "chunk_count": int}}
    volume_map: dict[str, dict] = {}

    offset = None
    while True:
        results = client.scroll(
            collection_name=COLLECTION_NAME,
            limit=1000,
            offset=offset,
            with_payload=["volume", "source"],
            with_vectors=False,
        )
        points, next_offset = results

        if not points:
            break

        for point in points:
            payload = point.payload or {}
            volume = payload.get("volume", "")
            if not volume:
                continue

            raw_source = payload.get("source", [])
            if isinstance(raw_source, str):
                sources = [raw_source] if raw_source else []
            else:
                sources = list(raw_source) if raw_source else []

            if volume not in volume_map:
                volume_map[volume] = {"sources": set(), "chunk_count": 0}

            volume_map[volume]["sources"].update(sources)
            volume_map[volume]["chunk_count"] += 1

        offset = next_offset
        if offset is None:
            break

    # 정렬 후 반환
    return sorted(
        [
            VolumeInfo(
                volume=vol,
                sources=sorted(info["sources"]),
                chunk_count=info["chunk_count"],
            )
            for vol, info in volume_map.items()
        ],
        key=lambda v: v.volume,
    )
```

- [ ] **Step 3: 서버 시작 및 수동 테스트**

```bash
cd backend && python -m uvicorn src.main:app --reload
# 별도 터미널에서:
curl -s http://localhost:8000/admin/data-sources/volumes | python -m json.tool | head -20
```

Expected: VolumeInfo 배열 반환 (volume, sources, chunk_count 포함)

- [ ] **Step 4: 커밋**

```bash
git add backend/src/admin/data_router.py
git commit -m "feat: GET /admin/data-sources/volumes 엔드포인트 추가"
```

---

## Task 3: 백엔드 — 업로드 시 source optional 처리

**Files:**
- Modify: `backend/src/admin/data_router.py:90-154` (upload 엔드포인트)

- [ ] **Step 1: upload 엔드포인트의 source 파라미터를 optional로 변경**

`POST /upload` 엔드포인트에서 `source` Form 파라미터를 찾아서 수정:

```python
# 기존:
source: str = Form(...)

# 변경:
source: str = Form("")
```

- [ ] **Step 2: _process_file의 source 처리 확인**

`_process_file()` 함수 내에서 source가 빈 문자열일 때 빈 배열로 저장되는지 확인. Qdrant payload에 source를 설정하는 부분을 찾아서, 빈 문자열 처리를 추가:

```python
# _process_file 내 source를 payload에 넣는 부분:
# 기존에 source를 배열로 저장하는 로직이 있다면 그 부분에서:
source_list = [source] if source else []
```

이 변경은 기존 코드에서 source를 payload에 설정하는 정확한 위치에 적용해야 한다. `_process_file()` 함수 내에서 `"source"` 키워드를 검색하여 해당 라인을 수정.

- [ ] **Step 3: 커밋**

```bash
git add backend/src/admin/data_router.py
git commit -m "feat: 업로드 시 source를 optional로 변경 (미분류 허용)"
```

---

## Task 4: 프론트엔드 — API 클라이언트 및 훅 추가

**Files:**
- Modify: `admin/src/lib/api.ts:187-245` (타입 및 API 메서드 추가)
- Modify: `admin/src/lib/hooks/use-data-source-categories.ts:51-59` (훅 추가)

- [ ] **Step 1: VolumeInfo 타입 추가**

`admin/src/lib/api.ts`에서 `VolumeTagResponse` 타입 정의(약 210-214줄) 아래에 추가:

```typescript
export interface VolumeInfo {
  volume: string;
  sources: string[];
  chunk_count: number;
}
```

- [ ] **Step 2: getAllVolumes() API 메서드 추가**

`dataSourceCategoryAPI` 객체 내, `removeVolumeTag` 메서드 아래에 추가:

```typescript
  getAllVolumes: () =>
    fetchAPI<VolumeInfo[]>("/admin/data-sources/volumes"),
```

- [ ] **Step 3: useAllVolumes() 훅 추가**

`admin/src/lib/hooks/use-data-source-categories.ts` 파일 끝에 추가. 먼저 import에 `VolumeInfo`를 추가:

```typescript
// 기존 import에 VolumeInfo 추가:
import { dataSourceCategoryAPI, type DataSourceCategory, type CategoryDocumentStats, type VolumeInfo } from "@/lib/api";
```

파일 끝에 훅 추가:

```typescript
export function useAllVolumes() {
  return useQuery<VolumeInfo[]>({
    queryKey: ["all-volumes"],
    queryFn: () => dataSourceCategoryAPI.getAllVolumes(),
    staleTime: 60_000,
    enabled: false, // Transfer Sheet 열릴 때 수동 refetch
  });
}
```

- [ ] **Step 4: 커밋**

```bash
git add admin/src/lib/api.ts admin/src/lib/hooks/use-data-source-categories.ts
git commit -m "feat: getAllVolumes API 클라이언트 및 useAllVolumes 훅 추가"
```

---

## Task 5: 프론트엔드 — Transfer 컴포넌트 구현

**Files:**
- Create: `admin/src/components/ui/volume-transfer.tsx`

이 컴포넌트는 좌/우 패널 + 검색 + 전체 선택 + 반응형 탭을 포함하는 순수 프레젠테이션 컴포넌트.

- [ ] **Step 1: VolumeTransfer 컴포넌트 작성**

```typescript
"use client";

import { useState, useMemo } from "react";
import { Search, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { VolumeInfo } from "@/lib/api";

interface VolumeTransferProps {
  /** 전체 volume 목록 */
  allVolumes: VolumeInfo[];
  /** 현재 카테고리에 포함된 volume 이름 Set */
  includedVolumes: Set<string>;
  /** volume 이동 콜백 */
  onMove: (volumes: string[], direction: "add" | "remove") => void;
}

function TransferPanel({
  title,
  volumes,
  searchQuery,
  onSearchChange,
  selectedVolumes,
  onToggleSelect,
  onToggleSelectAll,
}: {
  title: string;
  volumes: VolumeInfo[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedVolumes: Set<string>;
  onToggleSelect: (volume: string) => void;
  onToggleSelectAll: () => void;
}) {
  const filteredVolumes = useMemo(
    () =>
      volumes.filter((v) =>
        v.volume.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [volumes, searchQuery]
  );

  const allFilteredSelected =
    filteredVolumes.length > 0 &&
    filteredVolumes.every((v) => selectedVolumes.has(v.volume));

  const selectedCount = filteredVolumes.filter((v) =>
    selectedVolumes.has(v.volume)
  ).length;

  return (
    <div className="border rounded-lg overflow-hidden flex flex-col min-h-0">
      {/* 헤더 — 전체 선택 + 카운트 */}
      <div className="bg-muted/50 px-3 py-2 flex items-center justify-between border-b">
        <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={onToggleSelectAll}
          />
          {title}
        </label>
        <span className="text-xs text-muted-foreground">
          {selectedCount > 0 ? (
            <span className="text-primary font-medium">
              {selectedCount}/{filteredVolumes.length} 선택
            </span>
          ) : (
            `${filteredVolumes.length}건`
          )}
        </span>
      </div>

      {/* 검색 */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto max-h-[320px]">
        {filteredVolumes.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {searchQuery ? "검색 결과 없음" : "문서 없음"}
          </div>
        ) : (
          filteredVolumes.map((v) => (
            <label
              key={v.volume}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-accent/30 transition-colors ${
                selectedVolumes.has(v.volume) ? "bg-primary/5" : ""
              }`}
            >
              <Checkbox
                checked={selectedVolumes.has(v.volume)}
                onCheckedChange={() => onToggleSelect(v.volume)}
              />
              <span className="truncate flex-1">{v.volume}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {v.chunk_count}청크
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export default function VolumeTransfer({
  allVolumes,
  includedVolumes,
  onMove,
}: VolumeTransferProps) {
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<"excluded" | "included">(
    "excluded"
  );

  // 좌/우 패널 데이터 분리
  const excludedVolumes = useMemo(
    () => allVolumes.filter((v) => !includedVolumes.has(v.volume)),
    [allVolumes, includedVolumes]
  );
  const includedVolumeList = useMemo(
    () => allVolumes.filter((v) => includedVolumes.has(v.volume)),
    [allVolumes, includedVolumes]
  );

  // 전체 선택 토글 헬퍼
  const toggleSelectAll = (
    volumes: VolumeInfo[],
    searchQuery: string,
    selected: Set<string>,
    setSelected: (s: Set<string>) => void
  ) => {
    const filtered = volumes.filter((v) =>
      v.volume.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const allSelected = filtered.every((v) => selected.has(v.volume));
    if (allSelected) {
      const next = new Set(selected);
      filtered.forEach((v) => next.delete(v.volume));
      setSelected(next);
    } else {
      const next = new Set(selected);
      filtered.forEach((v) => next.add(v.volume));
      setSelected(next);
    }
  };

  // 개별 선택 토글 헬퍼
  const toggleSelect = (
    volume: string,
    selected: Set<string>,
    setSelected: (s: Set<string>) => void
  ) => {
    const next = new Set(selected);
    if (next.has(volume)) next.delete(volume);
    else next.add(volume);
    setSelected(next);
  };

  // 이동 핸들러
  const handleMoveRight = () => {
    if (leftSelected.size === 0) return;
    onMove(Array.from(leftSelected), "add");
    setLeftSelected(new Set());
  };

  const handleMoveLeft = () => {
    if (rightSelected.size === 0) return;
    onMove(Array.from(rightSelected), "remove");
    setRightSelected(new Set());
  };

  return (
    <div>
      {/* 데스크톱: 3열 그리드 */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_48px_1fr] gap-2 items-start">
        <TransferPanel
          title="미포함 문서"
          volumes={excludedVolumes}
          searchQuery={leftSearch}
          onSearchChange={setLeftSearch}
          selectedVolumes={leftSelected}
          onToggleSelect={(v) => toggleSelect(v, leftSelected, setLeftSelected)}
          onToggleSelectAll={() =>
            toggleSelectAll(
              excludedVolumes,
              leftSearch,
              leftSelected,
              setLeftSelected
            )
          }
        />

        {/* 중앙 화살표 */}
        <div className="flex flex-col gap-2 items-center pt-16">
          <Button
            size="sm"
            onClick={handleMoveRight}
            disabled={leftSelected.size === 0}
            className="h-8 w-8 p-0"
            title="선택 항목 추가"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleMoveLeft}
            disabled={rightSelected.size === 0}
            className="h-8 w-8 p-0"
            title="선택 항목 제거"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
        </div>

        <TransferPanel
          title="포함된 문서"
          volumes={includedVolumeList}
          searchQuery={rightSearch}
          onSearchChange={setRightSearch}
          selectedVolumes={rightSelected}
          onToggleSelect={(v) =>
            toggleSelect(v, rightSelected, setRightSelected)
          }
          onToggleSelectAll={() =>
            toggleSelectAll(
              includedVolumeList,
              rightSearch,
              rightSelected,
              setRightSelected
            )
          }
        />
      </div>

      {/* 모바일: 탭 전환 */}
      <div className="sm:hidden">
        {/* 탭 헤더 */}
        <div className="grid grid-cols-2 border rounded-lg overflow-hidden mb-3">
          <button
            onClick={() => setMobileTab("excluded")}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              mobileTab === "excluded"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground"
            }`}
          >
            미포함 ({excludedVolumes.length})
          </button>
          <button
            onClick={() => setMobileTab("included")}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              mobileTab === "included"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground"
            }`}
          >
            포함 ({includedVolumeList.length})
          </button>
        </div>

        {/* 활성 탭 패널 */}
        {mobileTab === "excluded" ? (
          <>
            <TransferPanel
              title="미포함 문서"
              volumes={excludedVolumes}
              searchQuery={leftSearch}
              onSearchChange={setLeftSearch}
              selectedVolumes={leftSelected}
              onToggleSelect={(v) =>
                toggleSelect(v, leftSelected, setLeftSelected)
              }
              onToggleSelectAll={() =>
                toggleSelectAll(
                  excludedVolumes,
                  leftSearch,
                  leftSelected,
                  setLeftSelected
                )
              }
            />
            <Button
              className="w-full mt-3"
              onClick={handleMoveRight}
              disabled={leftSelected.size === 0}
            >
              선택 항목 추가 ▶ ({leftSelected.size}건)
            </Button>
          </>
        ) : (
          <>
            <TransferPanel
              title="포함된 문서"
              volumes={includedVolumeList}
              searchQuery={rightSearch}
              onSearchChange={setRightSearch}
              selectedVolumes={rightSelected}
              onToggleSelect={(v) =>
                toggleSelect(v, rightSelected, setRightSelected)
              }
              onToggleSelectAll={() =>
                toggleSelectAll(
                  includedVolumeList,
                  rightSearch,
                  rightSelected,
                  setRightSelected
                )
              }
            />
            <Button
              variant="outline"
              className="w-full mt-3"
              onClick={handleMoveLeft}
              disabled={rightSelected.size === 0}
            >
              ◀ 선택 항목 제거 ({rightSelected.size}건)
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add admin/src/components/ui/volume-transfer.tsx
git commit -m "feat: VolumeTransfer 컴포넌트 구현 (좌/우 패널 + 반응형 탭)"
```

---

## Task 6: 프론트엔드 — Transfer Sheet 래퍼 구현

**Files:**
- Create: `admin/src/components/ui/volume-transfer-sheet.tsx`

이 컴포넌트는 Sheet 열기/닫기, 초기 상태 저장, diff 계산, 일괄 저장 로직을 담당.

- [ ] **Step 1: VolumeTransferSheet 컴포넌트 작성**

```typescript
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import VolumeTransfer from "@/components/ui/volume-transfer";
import { useAllVolumes, useActiveCategories, useAddVolumeTag, useRemoveVolumeTag } from "@/lib/hooks/use-data-source-categories";
import { getCategoryColors } from "@/lib/category-colors";
import type { VolumeInfo } from "@/lib/api";

interface VolumeTransferSheetProps {
  /** Sheet 열림 상태 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 대상 카테고리 key (미분류 모드일 때 null) */
  categoryKey: string | null;
  /** 대상 카테고리 이름 */
  categoryName: string;
  /** 대상 카테고리 색상 */
  categoryColor?: string;
}

export default function VolumeTransferSheet({
  open,
  onOpenChange,
  categoryKey,
  categoryName,
  categoryColor,
}: VolumeTransferSheetProps) {
  const queryClient = useQueryClient();
  const { data: allVolumes = [], refetch } = useAllVolumes();
  const { data: activeCategories = [] } = useActiveCategories();
  const addTagMutation = useAddVolumeTag();
  const removeTagMutation = useRemoveVolumeTag();

  // 현재 포함된 volume Set (로컬 state)
  const [includedVolumes, setIncludedVolumes] = useState<Set<string>>(
    new Set()
  );
  // 초기 상태 (diff 계산용)
  const [initialIncluded, setInitialIncluded] = useState<Set<string>>(
    new Set()
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // 미분류 모드에서 선택한 카테고리
  const [selectedCategoryForUncategorized, setSelectedCategoryForUncategorized] =
    useState<string>("");

  // 실제 사용할 카테고리 key
  const effectiveKey = categoryKey ?? selectedCategoryForUncategorized;

  // Sheet 열릴 때 데이터 fetch + 초기 상태 설정
  useEffect(() => {
    if (open) {
      refetch();
    }
  }, [open, refetch]);

  useEffect(() => {
    if (open && allVolumes.length > 0 && effectiveKey) {
      const included = new Set(
        allVolumes
          .filter((v) => v.sources.includes(effectiveKey))
          .map((v) => v.volume)
      );
      setIncludedVolumes(included);
      setInitialIncluded(included);
    }
  }, [open, allVolumes, effectiveKey]);

  // 이동 핸들러 (로컬 state만 변경)
  const handleMove = useCallback(
    (volumes: string[], direction: "add" | "remove") => {
      setIncludedVolumes((prev) => {
        const next = new Set(prev);
        if (direction === "add") {
          volumes.forEach((v) => next.add(v));
        } else {
          volumes.forEach((v) => next.delete(v));
        }
        return next;
      });
    },
    []
  );

  // diff 계산
  const diff = useMemo(() => {
    const added = Array.from(includedVolumes).filter(
      (v) => !initialIncluded.has(v)
    );
    const removed = Array.from(initialIncluded).filter(
      (v) => !includedVolumes.has(v)
    );
    return { added, removed };
  }, [includedVolumes, initialIncluded]);

  const hasChanges = diff.added.length > 0 || diff.removed.length > 0;

  // 일괄 저장
  const handleSave = async () => {
    if (!effectiveKey || !hasChanges) return;

    setSaving(true);
    const totalOps = diff.added.length + diff.removed.length;
    setProgress({ current: 0, total: totalOps });

    let completed = 0;
    const errors: string[] = [];

    // 추가 처리
    for (const volume of diff.added) {
      try {
        await addTagMutation.mutateAsync({ volume, source: effectiveKey });
        completed++;
        setProgress({ current: completed, total: totalOps });
      } catch {
        errors.push(`추가 실패: ${volume}`);
      }
    }

    // 제거 처리
    for (const volume of diff.removed) {
      try {
        await removeTagMutation.mutateAsync({ volume, source: effectiveKey });
        completed++;
        setProgress({ current: completed, total: totalOps });
      } catch {
        errors.push(`제거 실패: ${volume}`);
      }
    }

    setSaving(false);

    if (errors.length > 0) {
      toast.error(`일부 작업 실패 (${errors.length}건)`, {
        description: errors.slice(0, 3).join(", "),
      });
    } else {
      toast.success(
        `저장 완료 (추가 ${diff.added.length}건, 제거 ${diff.removed.length}건)`
      );
      queryClient.invalidateQueries({ queryKey: ["category-stats"] });
      queryClient.invalidateQueries({ queryKey: ["all-volumes"] });
      onOpenChange(false);
    }
  };

  // 취소 (변경사항 버리기)
  const handleCancel = () => {
    setIncludedVolumes(initialIncluded);
    onOpenChange(false);
  };

  const colors = categoryColor ? getCategoryColors(categoryColor) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {categoryKey ? (
              <>
                <Badge
                  variant="outline"
                  className={`font-mono text-xs ${colors?.text ?? ""} ${colors?.bg ?? ""}`}
                >
                  {categoryKey}
                </Badge>
                {categoryName}
              </>
            ) : (
              <span className="text-amber-700">미분류 문서 분류</span>
            )}
            <span className="text-muted-foreground font-normal text-sm">
              — 문서 관리
            </span>
          </SheetTitle>
        </SheetHeader>

        {/* 미분류 모드: 카테고리 선택 드롭다운 */}
        {!categoryKey && (
          <div className="mt-3 px-1">
            <label className="text-sm font-medium text-muted-foreground mb-1.5 block">
              분류할 카테고리 선택
            </label>
            <select
              value={selectedCategoryForUncategorized}
              onChange={(e) => setSelectedCategoryForUncategorized(e.target.value)}
              className="w-full text-sm border rounded-md px-3 py-2 bg-background"
            >
              <option value="">카테고리를 선택하세요</option>
              {activeCategories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.key})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Transfer 컴포넌트 */}
        <div className="flex-1 min-h-0 mt-4">
          <VolumeTransfer
            allVolumes={allVolumes}
            includedVolumes={includedVolumes}
            onMove={handleMove}
          />
        </div>

        {/* 변경 요약 */}
        {hasChanges && (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            변경 예정:
            {diff.added.length > 0 && (
              <span className="font-medium"> +{diff.added.length}건 추가</span>
            )}
            {diff.removed.length > 0 && (
              <span className="font-medium"> -{diff.removed.length}건 제거</span>
            )}
          </div>
        )}

        {/* 저장 프로그레스 */}
        {saving && (
          <div className="mt-2 text-sm text-muted-foreground text-center">
            {progress.total}건 중 {progress.current}건 처리 중...
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
          <Button variant="outline" onClick={handleCancel} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges || saving || !effectiveKey}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                저장 중...
              </>
            ) : hasChanges ? (
              `저장 (${diff.added.length + diff.removed.length}건 변경)`
            ) : (
              "변경 없음"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add admin/src/components/ui/volume-transfer-sheet.tsx
git commit -m "feat: VolumeTransferSheet 구현 (diff 계산 + 일괄 저장)"
```

---

## Task 7: 프론트엔드 — 카테고리 탭에 "문서 관리" 버튼 + 미분류 행 추가

**Files:**
- Modify: `admin/src/app/(dashboard)/data-sources/category-tab.tsx`

이 태스크는 기존 category-tab.tsx를 수정하여:
1. Actions 열에 "문서 관리" 아이콘 버튼 추가
2. 미분류 가상 행 추가
3. 기존 확장 행의 태그 추가 드롭다운 제거 (Transfer로 대체)
4. VolumeTransferSheet 연동

- [ ] **Step 1: import 추가**

`category-tab.tsx` 상단 import에 추가:

```typescript
import { FolderOpen } from "lucide-react";
import VolumeTransferSheet from "@/components/ui/volume-transfer-sheet";
import { useAllVolumes } from "@/lib/hooks/use-data-source-categories";
```

- [ ] **Step 2: Transfer Sheet 상태 추가**

컴포넌트 내부 state 선언 영역(약 54-83줄)에 추가:

```typescript
// Transfer Sheet 상태
const [transferOpen, setTransferOpen] = useState(false);
const [transferTarget, setTransferTarget] = useState<{
  key: string | null;
  name: string;
  color?: string;
} | null>(null);

// 미분류 volume 계산을 위한 allVolumes
const { data: allVolumes = [] } = useAllVolumes();

const uncategorizedVolumes = useMemo(
  () => allVolumes.filter((v) => v.sources.length === 0),
  [allVolumes]
);
```

Transfer Sheet 열기 핸들러:

```typescript
const openTransfer = (key: string | null, name: string, color?: string) => {
  setTransferTarget({ key, name, color });
  setTransferOpen(true);
};
```

- [ ] **Step 3: Actions 열에 "문서 관리" 버튼 추가**

기존 Actions 열 (약 305-334줄)에서 편집 버튼과 비활성화 버튼 사이에 추가:

```typescript
{/* 문서 관리 버튼 */}
<Button
  size="sm"
  variant="outline"
  className="h-7 px-2"
  onClick={() => openTransfer(cat.key, cat.name, cat.color)}
  title="문서 관리"
>
  <FolderOpen className="w-3.5 h-3.5" />
</Button>
```

- [ ] **Step 4: 기존 확장 행의 태그 추가 드롭다운 제거**

확장 행(약 372-398줄)에 있는 `<select>` 태그 추가 드롭다운을 제거. 해당 `<select>` 요소와 그 안의 `<option>`들, 그리고 onChange 핸들러를 모두 삭제.

확장 행은 읽기 전용 volume 목록 + 각 volume의 태그 배지 + 제거 버튼만 유지.

- [ ] **Step 5: 미분류 가상 행 추가**

테이블 `<tbody>` 끝(기존 카테고리 행들의 Fragment 맵 이후, 약 406줄)에 미분류 행 추가:

```typescript
{/* 미분류 가상 행 */}
{uncategorizedVolumes.length > 0 && (
  <tr className="border-t-2 border-dashed border-amber-300 bg-amber-50/50">
    <td className="px-4 py-3 w-8"></td>
    <td className="px-4 py-3">
      <Badge variant="outline" className="font-mono text-xs bg-amber-100 text-amber-800 border-amber-300">
        —
      </Badge>
    </td>
    <td className="px-4 py-3 font-semibold text-amber-800">미분류 문서</td>
    <td className="px-4 py-3 text-amber-800">
      {uncategorizedVolumes.length}권 /{" "}
      {uncategorizedVolumes.reduce((sum, v) => sum + v.chunk_count, 0).toLocaleString()}
    </td>
    <td className="px-4 py-3 hidden sm:table-cell">
      <div className="w-5 h-5 rounded-full bg-gray-300 border border-gray-400" />
    </td>
    <td className="px-4 py-3">
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-xs">
        ⚠ 미분류
      </Badge>
    </td>
    <td className="px-4 py-3">
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs text-amber-800 border-amber-300"
        onClick={() => openTransfer(null, "미분류 문서")}
      >
        분류하기 →
      </Button>
    </td>
  </tr>
)}
```

- [ ] **Step 6: VolumeTransferSheet 렌더링 추가**

컴포넌트 JSX 맨 끝(Sheet 컴포넌트 이후)에 추가:

```typescript
{/* Transfer Sheet */}
{transferTarget && (
  <VolumeTransferSheet
    open={transferOpen}
    onOpenChange={setTransferOpen}
    categoryKey={transferTarget.key}
    categoryName={transferTarget.name}
    categoryColor={transferTarget.color}
  />
)}
```

- [ ] **Step 7: 빌드 확인**

```bash
cd admin && npm run build
```

Expected: 빌드 성공, 타입 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add admin/src/app/(dashboard)/data-sources/category-tab.tsx
git commit -m "feat: 카테고리 탭에 Transfer Sheet 연동 + 미분류 행 추가"
```

---

## Task 8: 프론트엔드 — 업로드 탭 source optional 처리

**Files:**
- Modify: `admin/src/app/(dashboard)/data-sources/page.tsx:32-48,79-86,378-394`

- [ ] **Step 1: defaultSource를 빈 문자열로 변경**

`page.tsx`에서 `defaultSource` 계산 부분(약 39줄)을 수정:

```typescript
// 기존:
const defaultSource = categories[0]?.key ?? "";

// 변경:
const defaultSource = "";
```

- [ ] **Step 2: source 드롭다운에 "미분류" 옵션 추가**

pending 파일의 source 드롭다운(약 381-391줄)을 수정. 기존 `<select>` 내부에 "미분류" 옵션 추가:

```typescript
<select
  value={pf.source}
  onChange={(e) => updateSource(pf.id, e.target.value)}
  className="text-xs border rounded-md px-2 py-1.5 bg-background shrink-0 cursor-pointer"
>
  <option value="">미분류 (선택 안함)</option>
  {categories.map((c) => (
    <option key={c.key} value={c.key}>
      {c.name} ({c.key})
    </option>
  ))}
</select>
```

- [ ] **Step 3: 빌드 확인**

```bash
cd admin && npm run build
```

Expected: 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add admin/src/app/(dashboard)/data-sources/page.tsx
git commit -m "feat: 업로드 시 source 선택을 optional로 변경 (미분류 기본값)"
```

---

## Task 9: 통합 확인 및 정리

**Files:**
- 모든 수정 파일 대상

- [ ] **Step 1: 전체 빌드 확인**

```bash
cd admin && npm run build
```

Expected: 빌드 성공, 경고 없음

- [ ] **Step 2: 백엔드 서버 기동 확인**

```bash
cd backend && python -m uvicorn src.main:app --reload
```

Expected: 서버 정상 기동, `/admin/data-sources/volumes` 엔드포인트 등록 확인

- [ ] **Step 3: 수동 E2E 테스트**

1. 업로드 탭: 파일 업로드 시 "미분류 (선택 안함)" 기본 선택 확인
2. 카테고리 탭: "문서 관리" 버튼 → Transfer Sheet 열림 확인
3. Transfer Sheet: 좌/우 패널 문서 이동 → 저장 → 카테고리 stats 갱신 확인
4. 미분류 행: 미분류 문서가 있으면 테이블 하단에 표시, "분류하기" 클릭 확인
5. 모바일: 반응형 탭 전환 확인 (브라우저 DevTools 축소)

- [ ] **Step 4: 최종 커밋**

변경 누락 파일이 있다면 추가 커밋:

```bash
git status
# 필요시:
git add -A && git commit -m "chore: Transfer UI 통합 정리"
```
