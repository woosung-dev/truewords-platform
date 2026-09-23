"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDeleteDialog } from "@/features/hoondok/components/confirm-delete-dialog";
import { JeongseongForm } from "@/features/hoondok/components/jeongseong-form";
import { kstTodayIso } from "@/features/hoondok/dates";
import { isNotFound, loadErrorMessage, mutationErrorMessage } from "@/features/hoondok/groups-api";
import { jeongseongAPI } from "@/features/hoondok/jeongseong-api";
import {
  emptyJeongseongValues,
  fromJeongseong,
  JEONGSEONG_STATUS_LABEL,
  type JeongseongFormValues,
  type JeongseongStatus,
  jeongseongEndDate,
  jeongseongStatus,
  type OfficialJeongseong,
  toJeongseongPayload,
} from "@/features/hoondok/jeongseong-form";

const QUERY_KEY = ["hoondok", "official-jeongseongs"];

// 상태 배지 — 편성 목록의 검수 배지 토큰을 그대로 쓴다(새 디자인 없음).
const STATUS_BADGE: Record<JeongseongStatus, string> = {
  active: "bg-success-soft text-success hover:bg-success-soft border border-success-border",
  upcoming: "bg-transparent text-muted-foreground hover:bg-transparent border border-dashed border-border",
  ended: "bg-admin-muted text-muted-foreground hover:bg-admin-muted border border-border",
};

type Editing = { mode: "create" } | { mode: "edit"; item: OfficialJeongseong } | null;

/** API-HD-042 공식 정성 — 모든 모임 상세에 자동 표시된다. 진행 상태는 KST 오늘로 화면이 계산한다. */
export default function OfficialJeongseongsPage() {
  const queryClient = useQueryClient();
  const today = kstTodayIso();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<OfficialJeongseong | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => jeongseongAPI.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const saveMutation = useMutation({
    mutationFn: (values: JeongseongFormValues) =>
      editing?.mode === "edit"
        ? jeongseongAPI.update(editing.item.id, toJeongseongPayload(values))
        : jeongseongAPI.create(toJeongseongPayload(values)),
    onSuccess: () => {
      toast.success(editing?.mode === "edit" ? "저장되었습니다" : "공식 정성이 등록되었습니다");
      setEditing(null);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(mutationErrorMessage(err, "저장에 실패했습니다"));
      if (isNotFound(err)) {
        setEditing(null);
        refresh();
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => jeongseongAPI.remove(id),
    onSuccess: () => {
      toast.success("공식 정성이 삭제되었습니다");
      setDeleting(null);
      refresh();
    },
    onError: (err: Error) => {
      toast.error(mutationErrorMessage(err, "삭제에 실패했습니다"));
      if (isNotFound(err)) {
        setDeleting(null);
        refresh();
      }
    },
  });

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">공식 정성</h1>
          <p className="text-sm text-muted-foreground mt-1">
            모든 모임 상세에 자동으로 보여요. 모임 정성은 여기 없어요.
          </p>
        </div>
        {editing === null && (
          <Button size="sm" onClick={() => setEditing({ mode: "create" })}>
            <Plus className="w-4 h-4 mr-1.5" />새 공식 정성
          </Button>
        )}
      </div>

      {editing && (
        <JeongseongForm
          key={editing.mode === "edit" ? editing.item.id : "new"}
          mode={editing.mode}
          initialValues={editing.mode === "edit" ? fromJeongseong(editing.item) : emptyJeongseongValues(today)}
          isSubmitting={saveMutation.isPending}
          onSubmit={(values) => saveMutation.mutate(values)}
          onCancel={() => setEditing(null)}
        />
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-card overflow-hidden">
          {["s1", "s2", "s3"].map((key, i) => (
            <div key={key} className={`px-5 py-4 ${i !== 0 ? "border-t" : ""}`}>
              <Skeleton className="h-5 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <p className="text-muted-foreground text-sm">
            {loadErrorMessage(error, "공식 정성 목록을 불러올 수 없습니다.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">등록된 공식 정성이 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                <TableHead className="font-semibold text-foreground">제목</TableHead>
                <TableHead className="font-semibold text-foreground">기간</TableHead>
                <TableHead className="font-semibold text-foreground">상태</TableHead>
                <TableHead className="font-semibold text-foreground">출처 메모</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => {
                const { status, dayIndex } = jeongseongStatus(item.started_on, item.duration_days, today);
                return (
                  <TableRow key={item.id} data-id={item.id} className="hover:bg-admin-muted/30 transition-colors">
                    <TableCell className="font-medium max-w-[20rem] truncate">{item.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {item.started_on} ~ {jeongseongEndDate(item.started_on, item.duration_days)} ·{" "}
                      {item.duration_days}일
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[status]}>{JEONGSEONG_STATUS_LABEL[status]}</Badge>
                      {dayIndex !== null && <span className="ml-2 text-xs text-muted-foreground">{dayIndex}일차</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[16rem] truncate">
                      {item.source_note ?? "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setEditing({ mode: "edit", item })}
                      >
                        <Pencil className="w-3.5 h-3.5 mr-1.5" />
                        수정
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(item)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        삭제
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleting !== null}
        title={`"${deleting?.title ?? ""}" 삭제`}
        description="모든 모임 상세에서 사라져요. 되돌릴 수 없어요."
        confirmLabel="삭제"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}
