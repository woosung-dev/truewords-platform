"use client";

// SCR-PWA-002 홈 "정성 기간" 카드. 진행 중이면 남은 날·진행·밀린 날 + 진행 바, 없으면 시트로 보내는 CTA.
// 비로그인 홈에서도 섹션과 CTA 는 그린다 — 정본 프로토타입 today 의 마크업 순서에 "정성 기간" 이 있고,
// 통째로 숨기면 비로그인 홈이 한 단계 얕아지며 기능의 존재 자체가 드러나지 않는다.
// 값을 지어내지는 않는다(REQ-PWA-013): 보여 주는 것은 시작 CTA 뿐이고 로그인 요구는 시트가 맡는다.
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { useAbandonJeongseong, useJeongseong } from "@/features/hoondok/use-jeongseong";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { formatMonthDay, formatReminder } from "../format";

const SHEET_HREF = "/hoondok?sheet=jeongseong";

function JeongseongSection({ badge, children }: { badge?: string; children: ReactNode }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">정성 기간</h2>
        {badge && <span className="sect__meta">{badge}</span>}
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

  const { progress } = period;
  const reminder = formatReminder(period.reminder_time);
  const badge = progress.state === "upcoming" ? `시작 전 · ${formatMonthDay(period.started_on)}부터` : undefined;

  return (
    <JeongseongSection badge={badge}>
      <div className="card">
        <p className="js-card__title">
          {period.duration_days}일 새벽 정성 · {period.topic}
        </p>
        <div className="stats">
          <div>
            <b className="stats__n stats__n--accent">D-{progress.remaining_days}</b>
            <span className="stats__lab">남은 날</span>
          </div>
          <div>
            <b className="stats__n">{progress.done_days}</b>
            <span className="stats__lab">진행한 날</span>
          </div>
          <div>
            <b className="stats__n">{progress.missed_days}</b>
            <span className="stats__lab">밀린 날</span>
          </div>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-label="정성 진행률"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i className="progress__fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <p className="hint">
          <span>
            {progress.done_days} / {period.duration_days}일
          </span>
          {reminder && <span>매일 오전 {reminder}</span>}
        </p>
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
