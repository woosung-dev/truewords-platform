"use client";

// 원문 뷰 읽기 크롬(세그먼트·듣기 바·하단 독)을 스크롤 방향에 따라 접고 되살린다.
// 상태는 React state 가 아니라 root 의 data 속성(data-chrome·data-stuck)이고 모양·모션은 CSS 가 맡는다 —
// 스크롤마다 긴 원문 화면을 다시 그리지 않기 위해서다. ≥1024px 에서는 CSS 가 이 속성을 무시한다.
import { type RefObject, useEffect } from "react";

/** 한 방향으로 이만큼 움직여야 바뀐다 — 손가락 떨림이나 관성 끝의 작은 역방향에 깜빡이지 않게 */
const TRAVEL = 10;
/** 본문 끝 근처에서는 늘 보인다 — 구간 끝 버튼과 독을 찾으러 다시 올릴 필요가 없게 */
const END_ZONE = 48;

export function useReadingChrome(
  rootRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  chromeRef: RefObject<HTMLElement | null>,
  isReady: boolean,
) {
  useEffect(() => {
    const root = rootRef.current;
    const anchor = anchorRef.current;
    const chrome = chromeRef.current;
    if (!isReady || !root || !anchor || !chrome) return;

    // 크롬은 앱바 바로 아래에 붙는다. 앱바 높이는 제목 길이·글자 크기에 따라 달라 실제 값을 잰다.
    const appbar = root.closest(".app__main")?.querySelector<HTMLElement>(".appbar") ?? null;
    const measure = () => {
      if (appbar) root.style.setProperty("--wd-chrome-top", `${appbar.offsetHeight}px`);
    };
    measure();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (appbar) resize?.observe(appbar);

    let lastY = window.scrollY;
    let travel = 0;
    let frame = 0;
    const setHidden = (isHidden: boolean) => {
      root.dataset.chrome = isHidden ? "hidden" : "shown";
    };

    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;
      // 앵커가 붙는 자리보다 아래에 있으면 크롬은 아직 제자리다 — 숨길 대상이 아니다
      const stickyTop = Number.parseFloat(getComputedStyle(chrome).top) || 0;
      const isResting = anchor.getBoundingClientRect().top >= stickyTop - 1;
      if (isResting) root.removeAttribute("data-stuck");
      else root.dataset.stuck = "";
      if (delta === 0) return;
      if (delta > 0 !== travel > 0) travel = 0;
      travel += delta;
      const isNearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - END_ZONE;
      if (isResting || isNearEnd || travel < -TRAVEL) setHidden(false);
      else if (travel > TRAVEL) setHidden(true);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // 키보드 초점이 접힌 크롬·독으로 들어오면 되살린다 — 보이지 않는 곳에 초점이 머물지 않게
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest(".wd-chrome, .wd-dock")) setHidden(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.removeEventListener("focusin", onFocus);
      resize?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [rootRef, anchorRef, chromeRef, isReady]);
}
