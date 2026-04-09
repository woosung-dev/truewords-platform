"use client";

import { Fragment, useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  dataSourceCategoryAPI,
  type DataSourceCategory,
} from "@/lib/api";
import { useDataSourceCategories, useAddVolumeTag, useRemoveVolumeTag, useActiveCategories } from "@/lib/hooks/use-data-source-categories";
import { getCategoryColors } from "@/lib/category-colors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plus, Pencil, Power, ChevronRight, ChevronDown, Tag, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryStats } from "@/lib/hooks/use-data-source-categories";
import type { CategoryDocumentStats } from "@/lib/api";

const COLOR_OPTIONS = [
  { key: "indigo", label: "인디고" },
  { key: "violet", label: "바이올렛" },
  { key: "blue", label: "블루" },
  { key: "emerald", label: "에메랄드" },
  { key: "amber", label: "앰버" },
  { key: "rose", label: "로즈" },
  { key: "slate", label: "슬레이트" },
] as const;

interface FormState {
  key: string;
  name: string;
  description: string;
  color: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  key: "",
  name: "",
  description: "",
  color: "indigo",
  is_active: true,
};

export default function CategoryTab() {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading } = useDataSourceCategories();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DataSourceCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const { data: categoryStats, isLoading: statsLoading } = useCategoryStats();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const addTagMutation = useAddVolumeTag();
  const removeTagMutation = useRemoveVolumeTag();
  const { data: allCategories = [] } = useActiveCategories();

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

  const createMutation = useMutation({
    mutationFn: (data: FormState) =>
      dataSourceCategoryAPI.create({
        key: data.key,
        name: data.name,
        description: data.description,
        color: data.color,
        sort_order: categories.length + 1,
        is_active: data.is_active,
        is_searchable: true, // 미구현 기능, 기본값 유지
      }),
    onSuccess: () => {
      toast.success("카테고리가 생성되었습니다");
      queryClient.invalidateQueries({ queryKey: ["data-source-categories"] });
      closeSheet();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FormState> }) =>
      dataSourceCategoryAPI.update(id, data),
    onSuccess: () => {
      toast.success("카테고리가 수정되었습니다");
      queryClient.invalidateQueries({ queryKey: ["data-source-categories"] });
      closeSheet();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dataSourceCategoryAPI.delete(id),
    onSuccess: () => {
      toast.success("카테고리가 비활성화되었습니다");
      queryClient.invalidateQueries({ queryKey: ["data-source-categories"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // 다음 사용 가능한 알파벳 자동 계산 (A→Z 순)
  const nextKey = useMemo(() => {
    const usedKeys = new Set(categories.map((c) => c.key.toUpperCase()));
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      if (!usedKeys.has(letter)) return letter;
    }
    return "";
  }, [categories]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, key: nextKey });
    setSheetOpen(true);
  }

  function openEdit(cat: DataSourceCategory) {
    setEditing(cat);
    setForm({
      key: cat.key,
      name: cat.name,
      description: cat.description,
      color: cat.color,
      is_active: cat.is_active,
    });
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: {
          name: form.name,
          description: form.description,
          color: form.color,
          is_active: form.is_active,
        },
      });
    } else {
      createMutation.mutate(form);
    }
  }

  function handleDeactivate(cat: DataSourceCategory) {
    if (!confirm(`"${cat.name}" 카테고리를 비활성화하시겠습니까?`)) return;
    deleteMutation.mutate(cat.id);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const [showInactive, setShowInactive] = useState(false);
  const visibleCategories = showInactive
    ? categories
    : categories.filter((c) => c.is_active);
  const inactiveCount = categories.filter((c) => !c.is_active).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        <p className="text-sm">카테고리 로딩 중...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">카테고리 관리</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            데이터 소스 분류를 추가하거나 수정합니다
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inactiveCount > 0 && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showInactive ? "비활성 숨기기" : `비활성 ${inactiveCount}개 보기`}
            </button>
          )}
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            새 카테고리
          </Button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="w-8 px-2 py-2.5" />
              <th className="text-left font-medium px-4 py-2.5">Key</th>
              <th className="text-left font-medium px-4 py-2.5">이름</th>
              <th className="text-left font-medium px-4 py-2.5">문서 / 청크</th>
              <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">색상</th>
              <th className="text-center font-medium px-4 py-2.5">상태</th>
              <th className="text-right font-medium px-4 py-2.5">액션</th>
            </tr>
          </thead>
          <tbody>
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
                          className={`border-l-[3px] pl-3 ml-2 ${colors.border}`}
                        >
                          <p className="text-xs text-muted-foreground mb-2">포함된 문서</p>
                          <div className="space-y-2">
                            {stat.volumes.map((vol) => (
                              <div key={vol} className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm">{vol}</span>
                                <Badge variant="outline" className="text-xs gap-1">
                                  <Tag className="w-3 h-3" />
                                  {cat.key}
                                </Badge>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  title={`${cat.key} 카테고리에서 제거`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (confirm(`"${vol}"을(를) ${cat.name} 카테고리에서 제거하시겠습니까?`)) {
                                      removeTagMutation.mutate(
                                        { volume: vol, source: cat.key },
                                        { onError: (err: Error) => toast.error(err.message) }
                                      );
                                    }
                                  }}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                            <div className="pt-1">
                              <select
                                className="text-xs border rounded-md px-2 py-1 bg-background cursor-pointer"
                                defaultValue=""
                                onChange={(e) => {
                                  const targetSource = e.target.value;
                                  if (!targetSource) return;
                                  stat.volumes.forEach((v) => {
                                    addTagMutation.mutate(
                                      { volume: v, source: targetSource },
                                      { onError: (err: Error) => toast.error(err.message) }
                                    );
                                  });
                                  e.target.value = "";
                                  toast.success(`${cat.name}의 문서를 선택한 카테고리에 추가했습니다`);
                                }}
                              >
                                <option value="">+ 카테고리 태그 추가...</option>
                                {allCategories
                                  .filter((c) => c.key !== cat.key)
                                  .map((c) => (
                                    <option key={c.key} value={c.key}>
                                      {c.name} ({c.key})
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {visibleCategories.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  카테고리가 없습니다. 새 카테고리를 추가하세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 추가/수정 Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex flex-col p-0 gap-0">
          {/* 헤더 */}
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <div className="flex items-center gap-2">
              <SheetTitle className="text-base">
                {editing ? "카테고리 수정" : "새 카테고리 추가"}
              </SheetTitle>
              <Badge variant="outline" className="font-mono text-xs">
                {editing ? editing.key : nextKey || "—"}
              </Badge>
            </div>
          </SheetHeader>

          {/* 폼 본문 */}
          <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-y-auto">
            <div className="flex-1 px-6 py-6 space-y-6">
              {/* 이름 */}
              <div className="space-y-2">
                <Label htmlFor="cat-name">
                  이름 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cat-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="예: 말씀선집"
                  required
                />
              </div>

              {/* 설명 */}
              <div className="space-y-2">
                <Label htmlFor="cat-desc">설명</Label>
                <Input
                  id="cat-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="예: 615권 텍스트 데이터"
                />
              </div>

              {/* 색상 */}
              <div className="space-y-3">
                <Label>색상</Label>
                <div className="flex items-center gap-3">
                  {COLOR_OPTIONS.map((opt) => {
                    const c = getCategoryColors(opt.key);
                    const selected = form.color === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, color: opt.key }))}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${c.bg} ${
                          selected
                            ? `${c.border} ring-2 ring-offset-2 ${c.activeRing}`
                            : "border-transparent hover:scale-110"
                        }`}
                        title={opt.label}
                      />
                    );
                  })}
                </div>
              </div>

              {/* 활성 상태 (수정 시에만) */}
              {editing && (
                <div className="flex items-center gap-3 py-1">
                  <Checkbox
                    id="cat-active"
                    checked={form.is_active}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: !!v }))}
                  />
                  <Label htmlFor="cat-active" className="text-sm font-normal cursor-pointer">
                    활성 상태
                  </Label>
                </div>
              )}
            </div>

            {/* 하단 버튼 — 고정 */}
            <div className="px-6 py-4 border-t bg-background flex gap-2">
              <Button type="submit" disabled={isPending} className="flex-1">
                {isPending ? "저장 중..." : editing ? "수정" : "생성"}
              </Button>
              <Button type="button" variant="outline" onClick={closeSheet} className="flex-1">
                취소
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
