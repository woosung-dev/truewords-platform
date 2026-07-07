"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserPlus, Users } from "lucide-react";

interface AdminUserResponse {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const queryClient = useQueryClient();

  const { data: admins, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchAPI<AdminUserResponse[]>("/admin/users"),
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

      {/* 관리자 계정 목록 — ponytail: 읽기 전용, 활성/삭제 액션은 요청 시 추가 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 border-b pb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">관리자 계정 목록</h3>
          {admins && (
            <span className="text-xs text-muted-foreground">
              ({admins.length})
            </span>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((admin) => (
                <TableRow
                  key={admin.id}
                  className="hover:bg-admin-muted/30 transition-colors"
                >
                  <TableCell className="font-medium">{admin.email}</TableCell>
                  <TableCell>
                    <Badge className="bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                      {admin.role.toLowerCase()}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {admin.is_active ? (
                      <Badge className="bg-success-soft text-success hover:bg-success-soft border border-success-border">
                        활성
                      </Badge>
                    ) : (
                      <Badge className="bg-secondary text-muted-foreground hover:bg-secondary border border-border">
                        비활성
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(admin.created_at).toLocaleString("ko-KR")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
