"use client";

import { useState, useMemo } from "react";
import { Search, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { VolumeInfo } from "@/features/data-source/types";

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
