"use client";

// AI 질문의 로그인 안내와 하루 남은 횟수 (DEC-PWA-025 2차). 질문은 훈독 로그인한 분만, 하루 5번(KST 자정 초기화)까지다.
import { useQuery } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { onboardingHref } from "@/features/identity/gate";
import { ASK_QUOTA_KEY, asksAPI } from "../asks-api";

export const DAILY_LIMIT_DONE = "오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)";

/** 오늘 남은 횟수. 로그인 전·불러오기 실패면 remaining 이 null 이다 — 그때는 막지 않고 서버 판정(429)에 맡긴다. */
export function useAskQuota(isLoggedIn: boolean) {
  const quota = useQuery({
    queryKey: ASK_QUOTA_KEY,
    queryFn: ({ signal }) => asksAPI.quota(signal),
    enabled: isLoggedIn,
    retry: false,
  });
  const remaining = isLoggedIn && quota.data ? quota.data.remaining : null;
  return { remaining, isExhausted: remaining === 0 };
}

/** "오늘 남은 질문 N회" 또는 소진 안내. 횟수를 모르면 그리지 않는다. */
export function AskQuotaNote({ remaining, className = "" }: { remaining: number | null; className?: string }) {
  if (remaining === null) return null;
  return (
    <p className={`ask-quota${remaining === 0 ? " ask-quota--out" : ""} ${className}`.trim()} role="status">
      {remaining === 0 ? DAILY_LIMIT_DONE : `오늘 남은 질문 ${remaining}회`}
    </p>
  );
}

/** 로그인 안내 빈 상태. returnTo 는 로그인 뒤 돌아올 /hoondok 아래 주소다. */
export function AskLoginGate({
  title,
  body,
  returnTo,
  quote,
  replace,
}: {
  title: string;
  body: string;
  returnTo: string;
  /** 로그인 뒤에도 남아 있을 질문 문장(있으면 미리 보여 준다). */
  quote?: string;
  /** 로그인 화면을 기록에 쌓지 않는다 — 돌아온 뒤 ✕·뒤로가 이 안내 화면(같은 주소)으로 한 번 더 돌아오지 않게. */
  replace?: boolean;
}) {
  return (
    <div className="empty ask-gate">
      <span className="empty__ic">
        <LogIn size={26} aria-hidden="true" />
      </span>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__body">{body}</p>
      {quote && <p className="ask-gate__quote">{quote}</p>}
      <Link className="btn btn-primary ql-empty__cta" href={onboardingHref(returnTo)} replace={replace}>
        로그인하기
      </Link>
    </div>
  );
}
