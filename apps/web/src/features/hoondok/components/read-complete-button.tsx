"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { DoneBadge, HoondokButton } from "@/components/hoondok";
import { useMissionCompletion, useSummary } from "@/features/hoondok/use-missions";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";

// "훈독 완료" — 로그인 상태면 POST /hoondok/missions/read/complete, 아니면 로컬(KST 날짜 키)에 두고 로그인 후 소급한다.
export function ReadCompleteButton() {
  const { user, isLoading } = useCurrentUser();
  const { data: summary } = useSummary(Boolean(user));
  const completion = useMissionCompletion("read", user, isLoading);
  const isDone = completion.isDone || Boolean(summary?.today.read);

  if (isDone) {
    return (
      <div className="card" role="status" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DoneBadge />
          <span>오늘 훈독을 마쳤어요.</span>
        </span>
        {completion.isUnsynced && (
          <Link className="hint" href={onboardingHref("/hoondok/read")}>
            <span>로그인하면 오늘 기록이 남아요 →</span>
          </Link>
        )}
        {completion.hasSaveFailed && (
          <span className="hint">
            <span>기록을 아직 저장하지 못했어요. 연결되면 다시 시도해요.</span>
          </span>
        )}
      </div>
    );
  }
  return (
    <>
      <HoondokButton onClick={completion.markDone} disabled={completion.isSaving}>
        <Check size={18} />
        훈독 완료
      </HoondokButton>
      {!user && !isLoading && (
        <div className="hint">
          <span>완료 기록은 로그인 후 남아요</span>
        </div>
      )}
    </>
  );
}
