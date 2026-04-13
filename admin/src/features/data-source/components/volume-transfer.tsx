"use client";

import { useState, useMemo } from "react";
import { Search, ArrowRight, ArrowLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getCategoryColors } from "@/features/data-source/category-colors";
import type { VolumeInfo } from "@/features/data-source/types";

interface VolumeTransferProps {
  allVolumes: VolumeInfo[];
  includedVolumes: Set<string>;
  onMove: (volumes: string[], direction: "add" | "remove") => void;
  categoryMap: Map<string, { name: string; color: string }>;
}

function TransferPanel({
  title,
  variant,
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
  variant: "source" | "destination";
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
    const query = searchQuery.normalize("NFC").toLowerCase().trim();
    const filtered = volumes.filter(
      (v) => !query || v.volume.normalize("NFC").toLowerCase().includes(query)
    );
    if (!disabledVolumes || disabledVolumes.size === 0) return filtered;
    return filtered.sort((a, b) => {
      const aDisabled = disabledVolumes.has(a.volume) ? 1 : 0;
      const bDisabled = disabledVolumes.has(b.volume) ? 1 : 0;
      return aDisabled - bDisabled;
    });
  }, [volumes, searchQuery, disabledVolumes]);

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

  const isSource = variant === "source";

  return (
    <div className="border rounded-xl overflow-hidden flex flex-col h-full bg-background">
      {/* 헤더 */}
      <div
        className={cn(
          "px-4 py-3 flex items-center justify-between border-b",
          isSource ? "bg-slate-50" : "bg-indigo-50/60"
        )}
      >
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={onToggleSelectAll}
          />
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedCount > 0 ? (
            <span className="text-primary font-semibold">
              {selectedCount}/{selectableVolumes.length}
            </span>
          ) : (
            `${filteredVolumes.length}건`
          )}
        </span>
      </div>

      {/* 검색 */}
      <div className="px-3 py-2.5 border-b bg-muted/20">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="문서명 검색..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-8 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filteredVolumes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Search className="w-8 h-8 mb-2 opacity-30" />
            <span className="text-sm">
              {searchQuery ? "검색 결과 없음" : "문서 없음"}
            </span>
          </div>
        ) : (
          <div className="py-1">
            {filteredVolumes.map((v) => {
              const isDisabled = disabledVolumes?.has(v.volume) ?? false;
              const isSelected = selectedVolumes.has(v.volume);
              return (
                <label
                  key={v.volume}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                    isDisabled
                      ? "opacity-35 cursor-not-allowed"
                      : "cursor-pointer hover:bg-accent/40",
                    !isDisabled && isSelected && "bg-primary/5"
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(v.volume)}
                    disabled={isDisabled}
                    className="shrink-0"
                  />
                  <span className="flex-1 min-w-0 truncate" title={v.volume}>
                    {v.volume}
                  </span>
                  {categoryMap && v.sources.length > 0 && (
                    <span className="flex gap-1 shrink-0">
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
                              "h-5 px-1.5 text-[10px] font-mono leading-none",
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
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {v.chunk_count.toLocaleString()}청크
                  </span>
                </label>
              );
            })}
          </div>
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

  const disabledVolumes = useMemo(
    () =>
      new Set(
        allVolumes
          .filter((v) => includedVolumes.has(v.volume))
          .map((v) => v.volume)
      ),
    [allVolumes, includedVolumes]
  );

  const includedVolumeList = useMemo(
    () => allVolumes.filter((v) => includedVolumes.has(v.volume)),
    [allVolumes, includedVolumes]
  );

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
    <div className="h-full flex flex-col">
      {/* 데스크톱: 3열 그리드 */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_56px_1fr] gap-3 h-full min-h-0">
        <TransferPanel
          title="전체 문서"
          variant="source"
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
        <div className="flex flex-col gap-3 items-center justify-center">
          <Button
            size="icon"
            onClick={handleMoveRight}
            disabled={leftSelected.size === 0}
            className="h-10 w-10 rounded-full"
            title="선택 항목 추가"
          >
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={handleMoveLeft}
            disabled={rightSelected.size === 0}
            className="h-10 w-10 rounded-full"
            title="선택 항목 제거"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>

        <TransferPanel
          title="포함된 문서"
          variant="destination"
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
      <div className="sm:hidden flex flex-col h-full">
        <div className="grid grid-cols-2 border rounded-lg overflow-hidden mb-3 shrink-0">
          <button
            onClick={() => setMobileTab("all")}
            className={cn(
              "py-2.5 text-sm font-semibold transition-colors",
              mobileTab === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground"
            )}
          >
            전체 ({allVolumes.length})
          </button>
          <button
            onClick={() => setMobileTab("included")}
            className={cn(
              "py-2.5 text-sm font-semibold transition-colors",
              mobileTab === "included"
                ? "bg-primary text-primary-foreground"
                : "bg-muted/30 text-muted-foreground"
            )}
          >
            포함 ({includedVolumeList.length})
          </button>
        </div>

        <div className="flex-1 min-h-0">
          {mobileTab === "all" ? (
            <div className="flex flex-col h-full gap-3">
              <div className="flex-1 min-h-0">
                <TransferPanel
                  title="전체 문서"
                  variant="source"
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
              </div>
              <Button
                className="w-full shrink-0"
                onClick={handleMoveRight}
                disabled={leftSelected.size === 0}
              >
                선택 항목 추가 ({leftSelected.size}건)
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          ) : (
            <div className="flex flex-col h-full gap-3">
              <div className="flex-1 min-h-0">
                <TransferPanel
                  title="포함된 문서"
                  variant="destination"
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
              <Button
                variant="outline"
                className="w-full shrink-0"
                onClick={handleMoveLeft}
                disabled={rightSelected.size === 0}
              >
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                선택 항목 제거 ({rightSelected.size}건)
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
