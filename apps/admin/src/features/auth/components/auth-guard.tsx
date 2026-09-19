"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authAPI } from "@/features/auth/api";
import { gateAdminEmail } from "@/features/auth/constants";
import { ApiError } from "@/lib/api";

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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    authAPI
      .me()
      .then((me) => {
        // ponytail: 시연 한시 — 게이트 계정만 관리자 라우트 접근 허용.
        // 게이트가 비어 있으면(빌드 env 누락) 빈 이메일과 "일치" 로 새지 않도록 아무도 통과시키지 않는다.
        const gate = gateAdminEmail();
        if (requireAdmin && (!gate || (me.email ?? "").toLowerCase() !== gate)) {
          // email claim 없는 구 토큰은 재로그인으로 새 토큰 발급 유도,
          // 비관리자는 루트(관리자 대시보드)로 돌려보내지 않아 반복 이동을 막는다.
          router.replace(me.email == null ? "/login" : "/access-denied");
          return; // isAuth false 유지 → null 렌더
        }
        setIsAuth(true);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
        } else {
          // 일시 오류(콜드스타트 5xx·네트워크 단절)는 미인증이 아님 — 재시도 안내
          setFailed(true);
        }
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attempt(재시도) 시에만 재실행
  }, [attempt]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-muted-foreground">연결 상태를 확인할 수 없습니다.</p>
        <Button
          variant="outline"
          onClick={() => {
            setFailed(false);
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
        >
          다시 시도
        </Button>
      </div>
    );
  }

  if (!isAuth) return null;

  return <>{children}</>;
}
