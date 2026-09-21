"use client";
import { useSyncExternalStore } from "react";
import { formatKstDate } from "./today";

function subscribe(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    clearTimeout(timer);
    const today = formatKstDate().iso;
    const tomorrow = new Date(`${today}T00:00:00+09:00`).getTime() + 86_400_000;
    timer = setTimeout(
      () => {
        onChange();
        schedule();
      },
      Math.max(1, tomorrow - Date.now()),
    );
  };
  const refresh = () => {
    onChange();
    schedule();
  };
  schedule();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

/** 열린 화면도 KST 자정과 백그라운드 복귀 때 새 날짜의 캐시·완료 상태를 읽는다. */
export function useKstDate(): string {
  return useSyncExternalStore(
    subscribe,
    () => formatKstDate().iso,
    () => formatKstDate().iso,
  );
}
