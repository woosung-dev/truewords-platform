"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authAPI } from "@/features/auth/api";
import { ADMIN_EMAIL } from "@/features/auth/constants";

export default function AuthGuard({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const router = useRouter();
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authAPI
      .me()
      .then((me) => {
        // ponytail: 시연 한시 — 하드코딩 관리자 계정만 관리자 라우트 접근 허용
        if (requireAdmin && (me.email ?? "").toLowerCase() !== ADMIN_EMAIL) {
          router.replace("/"); // 로그인됐지만 관리자 아님 → 채팅으로
          return; // isAuth false 유지 → null 렌더
        }
        setIsAuth(true);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- router는 마운트 시 1회만 실행
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  if (!isAuth) return null;

  return <>{children}</>;
}
