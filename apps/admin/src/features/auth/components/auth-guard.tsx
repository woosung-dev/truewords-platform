"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { gateAdminEmail } from "@/features/auth/constants";
import { useMe } from "@/features/auth/hooks";
import { ApiError } from "@/lib/api";

const subscribeNothing = () => () => {};
const isBrowser = () => true;
const isServer = () => false;

// 인증 확인(me)과 화면 데이터 요청이 동시에 출발하도록 확인 중에도 children 을 마운트하되 보이지 않게 둔다.
// 데이터는 FastAPI 가 최종 검사하므로(미인증 401 → /login, 게이트 밖 계정 403) 숨긴 동안 받은 것이 노출되지 않는다.
// 확인 실패(401·비관리자·일시 오류)면 children 을 내려 화면을 보이지 않는다.
export default function AuthGuard({
  children,
  requireAdmin = false,
}: {
  children: React.ReactNode;
  requireAdmin?: boolean;
}) {
  const router = useRouter();
  // 서버 렌더·hydration 에서는 children 을 그리지 않는다(종전처럼 "확인 중"만) — hydration 직후 바로 마운트된다.
  const isClient = useSyncExternalStore(subscribeNothing, isBrowser, isServer);
  const { data: me, error, refetch } = useMe();
  const unauthorized = error instanceof ApiError && error.status === 401;
  // ponytail: 시연 한시 — 게이트 계정만 관리자 라우트 접근 허용.
  // 게이트가 비어 있으면(빌드 env 누락) 빈 이메일과 "일치" 로 새지 않도록 아무도 통과시키지 않는다.
  const gate = gateAdminEmail();
  const denied = !!me && requireAdmin && (!gate || (me.email ?? "").toLowerCase() !== gate);
  // email claim 없는 구 토큰은 재로그인으로 새 토큰 발급 유도,
  // 비관리자는 루트(관리자 대시보드)로 돌려보내지 않아 반복 이동을 막는다.
  const redirectTo = unauthorized || (denied && me.email == null) ? "/login" : denied ? "/access-denied" : null;
  // 일시 오류(콜드스타트 5xx·네트워크 단절)는 미인증이 아님 — 재시도 안내
  const failed = !!error && !unauthorized && !me;
  const ready = !!me && !redirectTo;

  useEffect(() => {
    if (redirectTo) router.replace(redirectTo);
  }, [redirectTo, router]);

  if (redirectTo) return null;

  if (failed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-muted-foreground">연결 상태를 확인할 수 없습니다.</p>
        <Button variant="outline" onClick={() => void refetch()}>
          다시 시도
        </Button>
      </div>
    );
  }

  return (
    <>
      {!ready && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
          <p className="text-muted-foreground">확인 중...</p>
        </div>
      )}
      {/* 확인 전에는 투명·스크린리더 숨김. 같은 요소를 유지해야 children 이 다시 마운트되지 않는다. */}
      {isClient && (
        <div className={ready ? "contents" : "opacity-0"} aria-hidden={ready ? undefined : true}>
          {children}
        </div>
      )}
    </>
  );
}
