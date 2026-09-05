"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authAPI } from "@/features/auth/api";
import { ApiError } from "@/lib/api";
import { Button } from "@truewords/ui-web/components/ui/button";

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    authAPI
      .me()
      .then(() => {
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
