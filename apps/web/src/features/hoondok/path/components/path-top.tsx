"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type TopAction = { label: string; href: string } | { label: string; onClick: () => void };

function Action({ action }: { action: TopAction | null | undefined }) {
  if (!action) return <span />;
  if ("href" in action)
    return (
      <Link className="path-top__btn" href={action.href}>
        {action.label}
      </Link>
    );
  return (
    <button type="button" className="path-top__btn" onClick={action.onClick}>
      {action.label}
    </button>
  );
}

/** 정성 화면 머리: [닫기·이전 48] [가운데 글자·진행] [건너뛰기]. 아이콘 대신 글자 버튼이다(어르신이 뜻을 바로 읽게). */
export function PathTop({ left, center, right }: { left: TopAction; center?: ReactNode; right?: TopAction | null }) {
  return (
    <div className="path-top">
      <Action action={left} />
      <div className="path-top__mid">{center}</div>
      <Action action={right} />
    </div>
  );
}

/** 시작 단계 진행(1 / 3 — 분량 · 때 · 정성 고르기). 기존 질문 흐름과 같은 얇은 막대다. */
export function PathProgress({ index, total }: { index: number; total: number }) {
  return (
    <div
      className="onb-step__prog path-top__prog"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={index}
      aria-valuetext={`${total}단계 중 ${index}단계`}
    >
      <span className="onb-step__track">
        <span className="onb-step__fill" style={{ width: `${(index / total) * 100}%` }} />
      </span>
      <span className="onb-step__label path-top__label" aria-hidden="true">
        {index} / {total}
      </span>
    </div>
  );
}
