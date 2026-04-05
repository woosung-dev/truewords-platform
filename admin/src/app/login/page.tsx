"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authAPI } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authAPI.login(email, password);
      router.push("/chatbots");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message.includes("401")
            ? "이메일 또는 비밀번호가 올바르지 않습니다"
            : "서버에 연결할 수 없습니다"
          : "로그인 실패"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* 좌측 브랜딩 패널 */}
      <div className="hidden lg:flex flex-col justify-between bg-slate-950 text-white p-10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold">TW</span>
          </div>
          <span className="font-semibold text-lg tracking-tight">TrueWords</span>
        </div>

        <div className="space-y-6">
          <blockquote className="text-2xl font-light text-slate-200 leading-relaxed">
            "말씀 데이터 기반<br />AI 챗봇 관리 시스템"
          </blockquote>
          <div className="space-y-2 text-sm text-slate-400">
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-indigo-400" />
              615권 텍스트 RAG 파이프라인
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-indigo-400" />
              다중 챗봇 버전 관리
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-indigo-400" />
              하이브리드 검색 & 리랭킹
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600">© 2026 TrueWords Platform</p>
      </div>

      {/* 우측 로그인 폼 */}
      <div className="flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* 모바일에서만 보이는 로고 */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-white">TW</span>
            </div>
            <span className="font-semibold text-lg">TrueWords Admin</span>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">관리자 로그인</h1>
            <p className="text-sm text-muted-foreground">
              관리자 계정으로 로그인하세요
            </p>
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">이메일</Label>
              <Input
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
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
