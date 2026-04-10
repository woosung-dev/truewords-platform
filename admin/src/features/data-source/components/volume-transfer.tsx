"use client";

import { useState, useMemo } from "react";
import { Search, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getCategoryColors } from "@/features/data-source/category-colors";
import type { VolumeInfo } from "@/features/data-source/types";

interface VolumeTransferProps {
  /** 전체 volume 목록 */
  allVolumes: VolumeInfo[];
  /** 현재 카테고리에 포함된 volume 이름 Set */
  includedVolumes: Set<string>;
  /** volume 이동 콜백 */
  onMove: (volumes: string[], direction: "add" | "remove") => void;
  /** 카테고리 key → { name, color } 매핑 (뱃지 렌더링용) */
  categoryMap: Map<string, { name: string; color: string }>;
}

function TransferPanel({
  title,
  volumes,
  searchQuery,
  onSearchChange,
  selectedVolumes,
  onToggleSelect,
  onToggleSelectAll,
  disabledVolumes,
  categoryMap,
}: {
  title: string;
  volumes: VolumeInfo[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedVolumes: Set<string>;
  onToggleSelect: (volume: string) => void;
  onToggleSelectAll: () => void;
  disabledVolumes?: Set<string>;
  categoryMap?: Map<string, { name: string; color: string }>;
}) {
  const filteredVolumes = useMemo(() => {
    const filtered = volumes.filter((v) =>
      v.volume.toLowerCase().includes(searchQuery.toLowerCase())
    );
    // disabled 항목을 하단으로 정렬
    if (!disabledVolumes || disabledVolumes.size === 0) return filtered;
    return filtered.sort((a, b) => {
      const aDisabled = disabledVolumes.has(a.volume) ? 1 : 0;
      const bDisabled = disabledVolumes.has(b.volume) ? 1 : 0;
      return aDisabled - bDisabled;
    });
  }, [volumes, searchQuery, disabledVolumes]);

  // 선택 가능한 항목 (disabled 제외)
  const selectableVolumes = useMemo(
    () =>
      disabledVolumes
        ? filteredVolumes.filter((v) => !disabledVolumes.has(v.volume))
        : filteredVolumes,
    [filteredVolumes, disabledVolumes]
  );

  const allFilteredSelected =
    selectableVolumes.length > 0 &&
    selectableVolumes.every((v) => selectedVolumes.has(v.volume));

  const selectedCount = selectableVolumes.filter((v) =>
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
              {selectedCount}/{selectableVolumes.length} 선택
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
          filteredVolumes.map((v) => {
            const isDisabled = disabledVolumes?.has(v.volume) ?? false;
            return (
              <label
                key={v.volume}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm transition-colors",
                  isDisabled
                    ? "opacity-40 cursor-not-allowed"
                    : "cursor-pointer hover:bg-accent/30",
                  !isDisabled && selectedVolumes.has(v.volume)
                    ? "bg-primary/5"
                    : ""
                )}
              >
                <Checkbox
                  checked={selectedVolumes.has(v.volume)}
                  onCheckedChange={() => onToggleSelect(v.volume)}
                  disabled={isDisabled}
                />
                <span className="truncate flex-1">{v.volume}</span>
                {/* 소속 카테고리 뱃지 */}
                {categoryMap && v.sources.length > 0 && (
                  <span className="flex gap-0.5 shrink-0">
                    {v.sources.map((src) => {
                      const cat = categoryMap.get(src);
                      const colors = cat
                        ? getCategoryColors(cat.color)
                        : getCategoryColors("slate");
                      return (
                        <Badge
                          key={src}
                          variant="outline"
                          className={cn(
                            "h-4 px-1 text-[10px] font-mono leading-none",
                            colors.text,
                            colors.bg
                          )}
                        >
                          {src}
                        </Badge>
                      );
                    })}
                  </span>
                )}
                <span className="text-xs text-muted-foreground shrink-0">
                  {v.chunk_count}청크
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function VolumeTransfer({
  allVolumes,
  includedVolumes,
  onMove,
  categoryMap,
}: VolumeTransferProps) {
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<"all" | "included">("all");

  // 왼쪽 패널: 전체 문서 (이미 포함된 항목은 disabled)
  const disabledVolumes = useMemo(
    () =>
      new Set(
        allVolumes
          .filter((v) => includedVolumes.has(v.volume))
          .map((v) => v.volume)
      ),
    [allVolumes, includedVolumes]
  );

  // 오른쪽 패널: 포함된 문서만
  const includedVolumeList = useMemo(
    () => allVolumes.filter((v) => includedVolumes.has(v.volume)),
    [allVolumes, includedVolumes]
  );

  // 전체 선택 토글 헬퍼
  const toggleSelectAll = (
    volumes: VolumeInfo[],
    searchQuery: string,
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    disabled?: Set<string>
  ) => {
    const filtered = volumes
      .filter((v) =>
        v.volume.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .filter((v) => !disabled?.has(v.volume));
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
          title="전체 문서"
          volumes={allVolumes}
          searchQuery={leftSearch}
          onSearchChange={setLeftSearch}
          selectedVolumes={leftSelected}
          onToggleSelect={(v) => toggleSelect(v, leftSelected, setLeftSelected)}
          onToggleSelectAll={() =>
            toggleSelectAll(
              allVolumes,
              leftSearch,
              leftSelected,
              setLeftSelected,
              disabledVolumes
            )
          }
          disabledVolumes={disabledVolumes}
          categoryMap={categoryMap}
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
            onClick={() => setMobileTab("all")}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              mobileTab === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground"
            }`}
          >
            전체 ({allVolumes.length})
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
        {mobileTab === "all" ? (
          <>
            <TransferPanel
              title="전체 문서"
              volumes={allVolumes}
              searchQuery={leftSearch}
              onSearchChange={setLeftSearch}
              selectedVolumes={leftSelected}
              onToggleSelect={(v) =>
                toggleSelect(v, leftSelected, setLeftSelected)
              }
              onToggleSelectAll={() =>
                toggleSelectAll(
                  allVolumes,
                  leftSearch,
                  leftSelected,
                  setLeftSelected,
                  disabledVolumes
                )
              }
              disabledVolumes={disabledVolumes}
              categoryMap={categoryMap}
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
