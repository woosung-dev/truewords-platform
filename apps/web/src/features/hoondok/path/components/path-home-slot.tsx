"use client";

// 오늘 훈독 홈의 정성 자리. 기존 홈 블록(children: 책갈피·오늘의 실천·정성 기간·함께 읽기)을 감싸고 상황별로 앞에 하나를 둔다.
// 플래그 OFF 면 children 만 — 지금 홈과 같다. 정성을 드리는 동안 오늘의 말씀은 지우지 않고 아래에 접어 둔다
// (하루에 읽을 것은 정성 장 하나로 안내한다). 조회 실패면 시작 카드도 접기도 하지 않는다 — 없다고 단정하지 않는다.
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { type ReactNode, useState } from "react";
import { usePathRun } from "../use-path-run";
import { PathClosingCard, PathHome, PathHomeSkeleton, PathStartCard } from "./path-home";

function PathFold({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className="path-fold" onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="path-fold__sum">
        <span className="path-fold__tx">
          <b>오늘의 말씀</b>
          <span>정성을 드리는 동안 여기 접어 두어요.</span>
        </span>
        <span className="path-fold__act" aria-hidden="true">
          {isOpen ? "접기" : "펼치기"}
          <CaretDownIcon size={20} />
        </span>
      </summary>
      <div className="path-fold__body">{children}</div>
    </details>
  );
}

export function PathHomeSlot({ children }: { children: ReactNode }) {
  const state = usePathRun();
  if (state.status === "off") return <>{children}</>;
  if (state.status === "anonymous" || state.status === "none")
    return (
      <>
        <PathStartCard />
        {children}
      </>
    );
  if (state.status === "loading")
    return (
      <>
        <PathHomeSkeleton />
        {children}
      </>
    );
  if (state.status === "error")
    return (
      <>
        <div className="path-alert path-alert--home" role="alert">
          <WarningCircleIcon size={20} aria-hidden="true" />
          <span className="path-alert__tx">정성 기록을 불러오지 못했어요.</span>
          <button type="button" className="btn btn-line path-alert__retry" onClick={state.retry}>
            다시 시도
          </button>
        </div>
        {children}
      </>
    );
  const { run } = state;
  if (run.status === "completed")
    return (
      <>
        <PathClosingCard run={run} />
        {children}
      </>
    );
  if (run.status !== "active") return <>{children}</>;
  return (
    <>
      <PathHome run={run} />
      <PathFold>{children}</PathFold>
    </>
  );
}

/** 히어로 "훈독하기" 버튼을 그릴지. 정성 중이면 오늘 읽을 것은 정성 장 하나라 그리지 않고, 확인 중이면 자리만 지킨다. */
export function useHeroReadButton(): "show" | "hold" | "hide" {
  const state = usePathRun();
  if (state.status === "loading") return "hold";
  if (state.status === "ready" && state.run.status === "active") return "hide";
  return "show";
}
