"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, fetchAPI } from "@/lib/api";
import { authAPI } from "@/features/auth/api";
import { Button } from "@truewords/ui-web/components/ui/button";
import { Input } from "@truewords/ui-web/components/ui/input";
import { Label } from "@truewords/ui-web/components/ui/label";
import { Badge } from "@truewords/ui-web/components/ui/badge";
import { Skeleton } from "@truewords/ui-web/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@truewords/ui-web/components/ui/table";
import {
  Ban,
  CheckCircle2,
  Loader2,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import DeactivateConfirmDialog from "./deactivate-confirm-dialog";

import type { AdminUserResponse } from "@truewords/api-client-ts/types";

type StatusFilter = "all" | "active" | "inactive";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "active", label: "활성" },
  { key: "inactive", label: "비활성" },
];

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // 비활성화 확인 대상. null 이면 다이얼로그 닫힘.
  const [pendingTarget, setPendingTarget] = useState<AdminUserResponse | null>(null);
  const queryClient = useQueryClient();

  const { data: admins, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchAPI<AdminUserResponse[]>("/admin/users"),
  });

  // 본인 계정 식별용 — 자기 자신은 비활성화할 수 없다(백엔드도 400 으로 거부).
  const { data: me } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => authAPI.me(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      fetchAPI<AdminUserResponse>("/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, role: "admin" }),
      }),
    onSuccess: (data) => {
      toast.success(`관리자 계정이 생성되었습니다: ${data.email}`);
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409")
        ? "이미 존재하는 이메일입니다"
        : err.message.includes("연결")
          ? "서버에 연결할 수 없습니다"
          : "계정 생성에 실패했습니다";
      toast.error(msg);
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: { id: string; email: string; isActive: boolean }) =>
      fetchAPI<AdminUserResponse>(`/admin/users/${vars.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: vars.isActive }),
      }),
    onSuccess: (_data, vars) => {
      // success-feedback — 무엇이 어떻게 됐는지 대상까지 밝힌다.
      toast.success(
        vars.isActive
          ? `활성화되었습니다: ${vars.email}`
          : `비활성화되었습니다: ${vars.email} — 새 로그인이 차단됩니다`,
      );
      setPendingTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => {
      // error-clarity — 원인 + 다음 행동을 함께 제시.
      // status 로 분기한다. backend 의 HTTPException 은 전용 handler 가 없어
      // `{"detail": ...}` 로 내려오고 ApiError.message 는 일반 문구로 대체되므로,
      // 메시지 문자열 매칭은 신뢰할 수 없다.
      const status = err instanceof ApiError ? err.status : 0;
      const msg =
        status === 400
          ? "본인 계정은 비활성화할 수 없습니다. 다른 관리자 계정으로 진행하세요."
          : status === 404
            ? "계정을 찾을 수 없습니다. 목록을 새로고침해 주세요."
            : status === 403
              ? "권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요."
              : status >= 500
                ? "서버 오류로 실패했습니다. 잠시 후 다시 시도해 주세요."
                : "상태 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.";
      toast.error(msg);
    },
  });

  const counts = useMemo(() => {
    const active = admins?.filter((a) => a.is_active).length ?? 0;
    return { all: admins?.length ?? 0, active, inactive: (admins?.length ?? 0) - active };
  }, [admins]);

  const visibleAdmins = useMemo(() => {
    if (!admins) return [];
    if (statusFilter === "active") return admins.filter((a) => a.is_active);
    if (statusFilter === "inactive") return admins.filter((a) => !a.is_active);
    return admins;
  }, [admins, statusFilter]);

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("비밀번호가 일치하지 않습니다");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          관리자 계정을 관리합니다
        </p>
      </div>

      {/* 관리자 계정 생성 */}
      <div className="rounded-xl border bg-card p-5 space-y-4 max-w-lg">
        <div className="flex items-center gap-2 border-b pb-3">
          <UserPlus className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">새 관리자 추가</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">
              이메일 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password">
              비밀번호 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-confirm">
              비밀번호 확인 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="admin-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="비밀번호 재입력"
              required
            />
          </div>

          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "생성 중..." : "관리자 추가"}
          </Button>
        </form>
      </div>

      {/* 관리자 계정 목록 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3 border-b pb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">관리자 계정 목록</h3>
          {admins && (
            <span className="text-xs text-muted-foreground">({counts.all})</span>
          )}

          {/* 상태 필터 — 비활성 계정이 다수일 때 활성 계정을 바로 찾기 위함 */}
          {admins && admins.length > 0 && (
            <div
              role="group"
              aria-label="상태로 목록 필터"
              className="ml-auto flex items-center gap-1 rounded-lg border bg-admin-muted/40 p-0.5"
            >
              {FILTERS.map((f) => {
                const selected = statusFilter === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setStatusFilter(f.key)}
                    className={`min-h-8 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f.label}
                    <span className="ml-1 tabular-nums opacity-70">
                      {counts[f.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !admins || admins.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            등록된 관리자가 없습니다
          </p>
        ) : visibleAdmins.length === 0 ? (
          // empty-states — 필터 때문에 비었음을 알리고 되돌릴 행동을 제공
          <div className="py-6 text-center text-sm text-muted-foreground space-y-2">
            <p>
              {statusFilter === "active" ? "활성" : "비활성"} 상태인 계정이 없습니다
            </p>
            <Button variant="outline" size="sm" onClick={() => setStatusFilter("all")}>
              전체 보기
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-admin-muted/40 hover:bg-admin-muted/40">
                <TableHead className="font-semibold text-foreground">
                  이메일
                </TableHead>
                <TableHead className="font-semibold text-foreground">
                  역할
                </TableHead>
                <TableHead className="font-semibold text-foreground">
                  상태
                </TableHead>
                <TableHead className="font-semibold text-foreground">
                  생성일
                </TableHead>
                <TableHead className="font-semibold text-foreground text-right">
                  액션
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleAdmins.map((admin) => {
                const isSelf = me?.user_id === admin.id;
                const isBusy =
                  statusMutation.isPending &&
                  statusMutation.variables?.id === admin.id;

                return (
                  <TableRow
                    key={admin.id}
                    className="hover:bg-admin-muted/30 transition-colors"
                  >
                    <TableCell className="font-medium">
                      <span className="break-all">{admin.email}</span>
                      {isSelf && (
                        <Badge className="ml-2 bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                          본인
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                        {admin.role.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {/* color-not-only — 아이콘 + 텍스트로 색 없이도 상태 구분 */}
                      {admin.is_active ? (
                        <Badge className="gap-1 bg-success-soft text-success hover:bg-success-soft border border-success-border">
                          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                          활성
                        </Badge>
                      ) : (
                        <Badge className="gap-1 bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                          <Ban className="w-3 h-3" aria-hidden="true" />
                          비활성
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(admin.created_at).toLocaleString("ko-KR")}
                    </TableCell>
                    <TableCell className="text-right">
                      {admin.is_active ? (
                        <Button
                          variant="outline"
                          // destructive-emphasis — 표 안이라 solid 대신 테두리/텍스트로 위험을 표시
                          className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isSelf || isBusy}
                          aria-disabled={isSelf || isBusy}
                          title={
                            isSelf
                              ? "본인 계정은 비활성화할 수 없습니다"
                              : `${admin.email} 비활성화`
                          }
                          aria-label={
                            isSelf
                              ? "본인 계정은 비활성화할 수 없습니다"
                              : `${admin.email} 비활성화`
                          }
                          onClick={() => setPendingTarget(admin)}
                        >
                          {isBusy ? (
                            <Loader2
                              className="w-3.5 h-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span className="ml-1.5">비활성화</span>
                        </Button>
                      ) : (
                        // 활성화는 되돌리기(undo) 경로이며 위험하지 않아 확인 없이 즉시 실행
                        <Button
                          variant="outline"
                          disabled={isBusy}
                          aria-disabled={isBusy}
                          title={`${admin.email} 활성화`}
                          aria-label={`${admin.email} 활성화`}
                          onClick={() =>
                            statusMutation.mutate({
                              id: admin.id,
                              email: admin.email,
                              isActive: true,
                            })
                          }
                        >
                          {isBusy ? (
                            <Loader2
                              className="w-3.5 h-3.5 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span className="ml-1.5">활성화</span>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <DeactivateConfirmDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(null);
        }}
        email={pendingTarget?.email ?? null}
        busy={statusMutation.isPending}
        onConfirm={() => {
          if (!pendingTarget) return;
          statusMutation.mutate({
            id: pendingTarget.id,
            email: pendingTarget.email,
            isActive: false,
          });
        }}
      />
    </div>
  );
}
