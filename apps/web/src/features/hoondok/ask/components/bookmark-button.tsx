"use client";

// 북마크 토글 버튼 — 이름은 상태와 상관없이 "북마크"로 고정하고 상태는 aria-pressed 로만 알린다(WAI-ARIA APG 토글).
// 켜지면 아이콘만 채운다. 목록 카드는 aria-describedby 로 어느 질문인지 함께 들려준다.
import { Bookmark } from "lucide-react";

export function BookmarkButton({
  isOn,
  onToggle,
  describedBy,
  className = "icon-btn",
  size = 20,
}: {
  isOn: boolean;
  onToggle: () => void;
  describedBy?: string;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-pressed={isOn}
      aria-label="북마크"
      aria-describedby={describedBy}
      onClick={onToggle}
    >
      <Bookmark size={size} aria-hidden="true" fill={isOn ? "currentColor" : "none"} />
    </button>
  );
}
