"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  dataSourceCategoryAPI,
  type DataSourceCategory,
} from "@/lib/api";
import { useDataSourceCategories } from "@/lib/hooks/use-data-source-categories";
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
import { Plus, Pencil, Power, CheckCircle2, XCircle } from "lucide-react";

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
  name: string;
  description: string;
  color: string;
  is_searchable: boolean;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  color: "indigo",
  is_searchable: true,
  is_active: true,
};

/** 다음 사용 가능한 알파벳 key를 자동 생성 */
function getNextKey(existingKeys: string[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const ch of alphabet) {
    if (!existingKeys.includes(ch)) return ch;
  }
  // 알파벳 소진 시 숫자 조합
  for (let i = 1; i <= 99; i++) {
    const k = `S${i}`;
    if (!existingKeys.includes(k)) return k;
  }
  return `S${Date.now()}`;
}

export default function CategoryTab() {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading } = useDataSourceCategories();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DataSourceCategory | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const createMutation = useMutation({
    mutationFn: (data: FormState) => {
      const existingKeys = categories.map((c) => c.key);
      const key = getNextKey(existingKeys);
      return dataSourceCategoryAPI.create({
        key,
        name: data.name,
        description: data.description,
        color: data.color,
        sort_order: categories.length + 1,
        is_active: data.is_active,
        is_searchable: data.is_searchable,
      });
    },
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

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSheetOpen(true);
  }

  function openEdit(cat: DataSourceCategory) {
    setEditing(cat);
    setForm({
      name: cat.name,
      description: cat.description,
      color: cat.color,
      is_searchable: cat.is_searchable,
      is_active: cat.is_active,
    });
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: {
          name: form.name,
          description: form.description,
          color: form.color,
          is_searchable: form.is_searchable,
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
              <th className="text-left font-medium px-4 py-2.5">Key</th>
              <th className="text-left font-medium px-4 py-2.5">이름</th>
              <th className="text-left font-medium px-4 py-2.5 hidden sm:table-cell">
                설명
              </th>
              <th className="text-left font-medium px-4 py-2.5">색상</th>
              <th className="text-center font-medium px-4 py-2.5">검색</th>
              <th className="text-center font-medium px-4 py-2.5">상태</th>
              <th className="text-right font-medium px-4 py-2.5">액션</th>
            </tr>
          </thead>
          <tbody>
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
                    {cat.is_searchable ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground/40 mx-auto" />
                    )}
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
                        onClick={() => openEdit(cat)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {cat.is_active && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive hover:text-destructive"
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
        <SheetContent>
          <SheetHeader>
            <SheetTitle>
              {editing ? "카테고리 수정" : "새 카테고리 추가"}
            </SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            {/* Key (수정 시에만 표시) */}
            {editing && (
              <div className="space-y-2">
                <Label>Key</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-sm px-3 py-1">
                    {editing.key}
                  </Badge>
                  <span className="text-xs text-muted-foreground">자동 생성됨 (변경 불가)</span>
                </div>
              </div>
            )}

            {/* 이름 */}
            <div className="space-y-2">
              <Label htmlFor="cat-name">
                이름 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
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
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="예: 615권 텍스트 데이터"
              />
            </div>

            {/* 색상 */}
            <div className="space-y-2">
              <Label>색상</Label>
              <div className="flex gap-2">
                {COLOR_OPTIONS.map((opt) => {
                  const c = getCategoryColors(opt.key);
                  const selected = form.color === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, color: opt.key }))
                      }
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

            {/* 검색 가능 */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="cat-searchable"
                checked={form.is_searchable}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, is_searchable: !!v }))
                }
              />
              <Label htmlFor="cat-searchable" className="text-sm">
                검색 티어에서 사용 가능
              </Label>
            </div>

            {/* 활성 (수정 시에만) */}
            {editing && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="cat-active"
                  checked={form.is_active}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, is_active: !!v }))
                  }
                />
                <Label htmlFor="cat-active" className="text-sm">
                  활성 상태
                </Label>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isPending} className="flex-1">
                {isPending
                  ? "저장 중..."
                  : editing
                    ? "수정"
                    : "생성"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={closeSheet}
                className="flex-1"
              >
                취소
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
