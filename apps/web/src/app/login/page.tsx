"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BrandMark } from "@/components/truewords";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authAPI } from "@/features/auth/api";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // 제출 중 버튼이 비활성화되면 포커스가 사라지므로, 실패하면 이메일 칸으로 돌려준다.
  const emailRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authAPI.login(email, password);
      // 계정 전환 후 이전 계정의 기록·원문 query 결과를 재사용하지 않는다.
      queryClient.clear();
      // 사용자 웹은 계정 역할과 무관하게 채팅으로 진입한다.
      void fetch("/api/chatbots", { credentials: "include" }).catch(() => {});
      router.prefetch("/");
      router.push("/");
    } catch (err) {
      // ApiError.status 로 분기 — message 문자열엔 "401" 이 포함되지 않음
      setError(
        err instanceof ApiError && err.status === 401
          ? "이메일 또는 비밀번호가 올바르지 않습니다"
          : "서버에 연결할 수 없습니다",
      );
      requestAnimationFrame(() => emailRef.current?.focus());
    } finally {
      setLoading(false);
    }
  }

  // 시연 참여 게이트와 같은 단일 컬럼 폼 — 기술 소개 패널 없이 로그인만 둔다.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8">
        <BrandMark />

        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">로그인</h1>
          <p className="text-sm text-muted-foreground">기존 시연 계정으로 로그인하세요</p>
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
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
                className="pr-12 md:pr-10"
              />
              {/* 모바일 44px, 데스크톱 32px 타점 — 아이콘(16px)은 가운데 */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-0 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:size-8"
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </Button>
        </form>
      </div>
    </main>
  );
}
