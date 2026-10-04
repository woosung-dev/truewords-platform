"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authAPI } from "@/features/auth/api";
import { gateAdminEmail } from "@/features/auth/constants";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authAPI.login(email, password);
      // 계정 전환 후 이전 계정의 관리자 query 결과를 재사용하지 않는다.
      queryClient.clear();
      // 기존 시연 계정 정책을 유지하되 앱 간 쿠키 공유를 전제하지 않는다.
      const gate = gateAdminEmail();
      const isGateAdmin = gate !== "" && email.trim().toLowerCase() === gate;
      router.push(isGateAdmin ? "/chatbots" : "/access-denied");
    } catch (err) {
      // ApiError.status 로 분기 — message 문자열엔 "401" 이 포함되지 않음
      setError(
        err instanceof ApiError && err.status === 401
          ? "이메일 또는 비밀번호가 올바르지 않습니다"
          : "서버에 연결할 수 없습니다",
      );
      // 제출 중 버튼이 비활성화되며 포커스가 body 로 빠지므로, 고쳐 입력할 첫 칸으로 돌려준다.
      emailRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-admin-bg p-6">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-accent-foreground">TW</span>
          </div>
          <span className="font-semibold text-lg">TrueWords Admin</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">관리자 로그인</h1>
          <p className="text-sm text-muted-foreground">관리자 계정으로 로그인하세요</p>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">이메일</Label>
            <Input
              ref={emailRef}
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              required
              autoFocus
              autoComplete="email"
              className="h-11"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">비밀번호</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="h-11 pr-12"
              />
              {/* 로그인은 휴대폰에서도 열리므로 입력·표시 버튼 모두 44px 터치 영역을 둔다. */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                tabIndex={-1}
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="h-11 w-full" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </Button>
        </form>
      </div>
    </main>
  );
}
