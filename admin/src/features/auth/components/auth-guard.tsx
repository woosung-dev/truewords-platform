"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authAPI } from "@/features/auth/api";

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authAPI
      .me()
      .then(() => setIsAuth(true))
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
