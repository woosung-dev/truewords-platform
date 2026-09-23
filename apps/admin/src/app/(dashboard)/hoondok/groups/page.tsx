"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDeleteDialog } from "@/features/hoondok/components/confirm-delete-dialog";
import {
  type AdminGroupItem,
  formatKstDate,
  groupsAPI,
  isNotFound,
  loadErrorMessage,
  mutationErrorMessage,
} from "@/features/hoondok/groups-api";

const QUERY_KEY = ["hoondok", "admin-groups"];

/**
 * API-HD-043 모임 목록 + 삭제(신고 대응). 이름·인원·생성일만 보인다 —
 * 모임원 이름·한 줄 본문·초대 코드는 API 가 admin 에게도 내지 않으므로 화면에도 없다.
 */
export default function HoondokGroupsPage() {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<AdminGroupItem | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => groupsAPI.list(),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => groupsAPI.remove(id),
    onSuccess: () => {
      toast.success("모임이 삭제되었습니다");
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
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">모임</h1>
        <p className="text-sm text-muted-foreground mt-1">
          신고 대응용이에요. 모임원 이름과 한 줄은 여기서 볼 수 없어요.
          {data && <span className="ml-1">· {data.length}개</span>}
        </p>
      </div>

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
          <p className="text-muted-foreground text-sm">{loadErrorMessage(error, "모임 목록을 불러올 수 없습니다.")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            다시 시도
          </Button>
        </div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-muted-foreground text-sm">만들어진 모임이 없습니다.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                <TableHead className="font-semibold text-foreground">이름</TableHead>
                <TableHead className="font-semibold text-foreground">인원</TableHead>
                <TableHead className="font-semibold text-foreground">생성일</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((group) => (
                <TableRow key={group.id} data-id={group.id} className="hover:bg-admin-muted/30 transition-colors">
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{group.member_count}명</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatKstDate(group.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(group)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                      삭제
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleting !== null}
        title={`"${deleting?.name ?? ""}" 모임 삭제`}
        description={`모임원 ${deleting?.member_count ?? 0}명의 모임 기록·한 줄·반응·모임 정성이 모두 지워져요. 되돌릴 수 없어요.`}
        confirmLabel="모임 삭제"
        isPending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </div>
  );
}
