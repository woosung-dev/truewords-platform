"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { DoneBadge, HoondokButton } from "@/components/hoondok";

// "훈독 완료" — Phase 1 은 화면 상태만 바뀐다. Phase 2 에서 POST /hoondok/missions/read/complete 로 기록한다.
export function ReadCompleteButton() {
  const [isDone, setIsDone] = useState(false);
  if (isDone) {
    return (
      <div className="card" role="status" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <DoneBadge />
        <span>오늘 훈독을 마쳤어요.</span>
      </div>
    );
  }
  return (
    <HoondokButton onClick={() => setIsDone(true)}>
      <Check size={18} />
      훈독 완료
    </HoondokButton>
  );
}
