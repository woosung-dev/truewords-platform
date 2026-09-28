"use client";

// SCR-PWA-002 홈 "정성 기간" 카드. 진행 중이면 N일차 · 날짜 기준 막대 · 시작일 · 남은 날(+ 나의 각오),
// 막 마친 기간(API-HD-009 last_ended)이 있고 닫지 않았으면 마무리 카드, 둘 다 아니면 시트로 보내는 CTA.
// 읽은 날 수(`done_days`·`percent`)와 빠진 날 수(`missed_days`)는 화면에 쓰지 않는다 — 진행은 "N일차"로만 보인다 (DEC-PWA-023).
// 마무리 카드도 함께한 날 수·날짜 범위를 쓰지 않는다 — 둘을 같이 두면 빼기로 빠진 날이 드러난다.
// 비로그인 홈에서도 섹션과 CTA 는 그린다 — 정본 프로토타입 today 의 마크업 순서에 "정성 기간" 이 있고,
// 통째로 숨기면 비로그인 홈이 한 단계 얕아지며 기능의 존재 자체가 드러나지 않는다.
// 값을 지어내지는 않는다(REQ-PWA-013): 보여 주는 것은 시작 CTA 뿐이고 로그인 요구는 시트가 맡는다.
import { Lock } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import type { JeongseongLastEnded, JeongseongPeriodResponse } from "@/features/hoondok/jeongseong-api";
import { useAbandonJeongseong, useJeongseongCurrent } from "@/features/hoondok/use-jeongseong";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { dismissClosing, isClosingDismissed } from "../closing";
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

/** 나의 각오 — 내 메모 층(점선 상자 + "나만 봐요"). 본인 카드에만 그린다. */
function JeongseongVow({ text }: { text: string }) {
  return (
    <figure className="js-vow">
      <figcaption>
        <Lock size={14} aria-hidden="true" />
        나의 각오 · 나만 봐요
      </figcaption>
      <blockquote>{text}</blockquote>
    </figure>
  );
}

/** 마친 정성 — "정성 기간을 마쳤어요" + 주제 + 각오. 날 수·날짜 범위·0일 분기 없이 모두 같은 카드다. */
function JeongseongClosing({ ended, onDismiss }: { ended: JeongseongLastEnded; onDismiss: () => void }) {
  const titleId = useId();
  return (
    <article className="card js-close" aria-labelledby={titleId}>
      <h3 className="js-close__title" id={titleId}>
        정성 기간을 마쳤어요
      </h3>
      <p className="js-close__topic">{ended.topic}</p>
      {ended.resolution && <JeongseongVow text={ended.resolution} />}
      <div className="js-close__cta">
        <Link className="btn btn-primary" href={SHEET_HREF}>
          새 정성 시작하기
        </Link>
        <HoondokButton variant="ghost" onClick={onDismiss}>
          닫기
        </HoondokButton>
      </div>
    </article>
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
  const { data, isPending } = useJeongseongCurrent(Boolean(user));
  const abandon = useAbandonJeongseong();
  const [isConfirming, setIsConfirming] = useState(false);
  // 저장소 쓰기가 막혀도(사생활 모드) 이번 화면에서는 닫힌 채로 둔다
  const [closedId, setClosedId] = useState<string | null>(null);

  // 계정·정성 조회가 끝나기 전에는 그리지 않는다 — 시작 CTA 와 진행 카드가 번갈아 보이면 안 된다.
  if (isLoading || (user && isPending)) return null;

  const period = data?.period ?? null;
  const ended = period ? null : (data?.last_ended ?? null);
  if (ended && closedId !== ended.id && !isClosingDismissed(ended.id)) {
    return (
      <JeongseongSection>
        <JeongseongClosing
          ended={ended}
          onDismiss={() => {
            dismissClosing(ended.id);
            setClosedId(ended.id);
          }}
        />
      </JeongseongSection>
    );
  }

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
        {period.resolution && <JeongseongVow text={period.resolution} />}
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
