// 관리자 인증 상태 (me() 호출) 를 useEffect 로 1회 확인하는 훅.
// AuthGuard 가 mount 시점 인증 검증에 사용. 401 시 caller 가 redirect 처리.

"use client";

import { useEffect, useState } from "react";
import { authAPI } from "./api";
import type { AdminMe } from "./types";

export type AuthStatus =
  | { status: "loading" }
  | { status: "authenticated"; me: AdminMe }
  | { status: "unauthenticated" };

export function useAuth(): AuthStatus {
  const [state, setState] = useState<AuthStatus>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    authAPI
      .me()
      .then((me) => {
        if (!cancelled) setState({ status: "authenticated", me });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unauthenticated" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
