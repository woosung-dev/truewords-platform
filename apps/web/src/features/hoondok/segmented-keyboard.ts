import type { KeyboardEvent } from "react";

// 탭과 라디오 묶음의 방향키 이동은 선택과 포커스를 함께 바꾼다.
export function handleSegmentKeyDown(event: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"], button[role="radio"]'),
  ).filter((item) => !item.disabled && item.getAttribute("aria-disabled") !== "true");
  const index = items.indexOf(event.target as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
  items[next]?.focus();
  items[next]?.click();
}
