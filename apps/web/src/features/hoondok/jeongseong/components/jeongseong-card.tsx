"use client";

// SCR-PWA-002 홈 "정성 기간" 카드. 진행 중이면 N일차 · 날짜 기준 막대 · 시작일 · 남은 날, 없으면 시트로 보내는 CTA.
// 읽은 날 수(`done_days`·`percent`)와 빠진 날 수(`missed_days`)는 화면에 쓰지 않는다 — 진행은 "N일차"로만 보인다 (DEC-PWA-023).
// 비로그인 홈에서도 섹션과 CTA 는 그린다 — 정본 프로토타입 today 의 마크업 순서에 "정성 기간" 이 있고,
// 통째로 숨기면 비로그인 홈이 한 단계 얕아지며 기능의 존재 자체가 드러나지 않는다.
// 값을 지어내지는 않는다(REQ-PWA-013): 보여 주는 것은 시작 CTA 뿐이고 로그인 요구는 시트가 맡는다.
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import type { JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { useAbandonJeongseong, useJeongseong } from "@/features/hoondok/use-jeongseong";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { formatMonthDay, jeongseongDayProgress } from "../format";

const SHEET_HREF = "/hoondok?sheet=jeongseong";

/** 머리 줄 배지 — 진행 중이면 "N일차", 시작 전이면 "시작 전 · M월 D일부터". 홈 카드와 정원이 함께 쓴다. */
export function JeongseongDayBadge({ period }: { period: JeongseongPeriodResponse }) {
  const progress = jeongseongDayProgress(period);
  if (!progress) return <span className="badge">{`시작 전 · ${formatMonthDay(period.started_on)}부터`}</span>;
  return <span className="badge badge--accent">{`${progress.day}일차`}</span>;
}

/**
 * 날짜 기준 막대(일차 / 기간) + "M월 D일에 시작했어요 · N일 남았어요". 시작 전이면 그리지 않는다.
 * 막대 길이가 읽은 날 수와 무관해 빠진 날이 길이로도 드러나지 않는다 (DEC-PWA-023). 홈 카드와 정원이 함께 쓴다.
 */
export function JeongseongProgress({ period }: { period: JeongseongPeriodResponse }) {
  const progress = jeongseongDayProgress(period);
  if (!progress) return null;
  return (
    <>
      <div
        className="progress"
        role="progressbar"
        aria-label={`${period.duration_days}일 정성 중 ${progress.day}일차`}
        aria-valuenow={progress.day}
        aria-valuemin={0}
        aria-valuemax={period.duration_days}
      >
        <i className="progress__fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="hint">
        <span>{`${formatMonthDay(period.started_on)}에 시작했어요`}</span>
        <span>{progress.remainingDays === 0 ? "오늘이 마지막 날이에요" : `${progress.remainingDays}일 남았어요`}</span>
      </p>
    </>
  );
}

function JeongseongSection({ children }: { children: ReactNode }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">정성 기간</h2>
      </div>
      {children}
    </div>
  );
}

export function JeongseongCard() {
  const { user, isLoading } = useCurrentUser();
  const { data: period, isPending } = useJeongseong(Boolean(user));
  const abandon = useAbandonJeongseong();
  const [isConfirming, setIsConfirming] = useState(false);

  // 계정·정성 조회가 끝나기 전에는 그리지 않는다 — 시작 CTA 와 진행 카드가 번갈아 보이면 안 된다.
  if (isLoading || (user && isPending)) return null;

  if (!period) {
    return (
      <JeongseongSection>
        <div className="card js-invite">
          <p className="js-invite__title">정성 기간 만들기</p>
          <p className="js-invite__body">7·21·40일 중 골라 매일 훈독을 이어가요</p>
          <Link className="btn btn-line btn--sm" href={SHEET_HREF}>
            정성 시작하기
          </Link>
        </div>
      </JeongseongSection>
    );
  }

  return (
    <JeongseongSection>
      <div className="card">
        <div className="js-card__top">
          <p className="js-card__title">
            {period.duration_days}일 정성 · {period.topic}
          </p>
          <JeongseongDayBadge period={period} />
        </div>
        <JeongseongProgress period={period} />
        <div className="js-card__cta">
          {isConfirming ? (
            <>
              <span className="js-card__ask">이 정성을 그만할까요?</span>
              <HoondokButton variant="ghost" isSmall isLoading={abandon.isPending} onClick={() => abandon.mutate()}>
                네, 그만할래요
              </HoondokButton>
              <HoondokButton variant="line" isSmall onClick={() => setIsConfirming(false)}>
                취소
              </HoondokButton>
            </>
          ) : (
            <HoondokButton variant="ghost" isSmall onClick={() => setIsConfirming(true)}>
              그만하기
            </HoondokButton>
          )}
        </div>
      </div>
    </JeongseongSection>
  );
}
