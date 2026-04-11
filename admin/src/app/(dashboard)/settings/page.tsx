"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";

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
    if (password.length < 8) {
      toast.error("비밀번호는 8자 이상이어야 합니다");
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-sm text-muted-foreground mt-1">
          관리자 계정을 관리합니다
        </p>
      </div>

      {/* 관리자 계정 생성 */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
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
              placeholder="8자 이상"
              required
              minLength={8}
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
              minLength={8}
            />
          </div>

          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "생성 중..." : "관리자 추가"}
          </Button>
        </form>
      </div>
    </div>
  );
}
