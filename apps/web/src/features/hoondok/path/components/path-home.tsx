"use client";

// 오늘 훈독 홈의 7일 정성 블록 — 시작 카드 · 정성 홈(오늘 읽을 장 · 이번 주 읽은 날 · 장 목록 · 끝나는 날 · 그만하기) ·
// 마침 카드 · 불러오는 중 · 돌아온 날 시트. 숫자는 서버 값만 쓴다(읽은 장 N/T). 쉰 날을 세는 "N일째"·퍼센트·막대는 없다.
// 부엉이는 다음 장 행 한 곳(reading 40)뿐이고, 오늘 읽은 뒤에도 그 자리에 그대로 둔다.
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { MinusIcon } from "@phosphor-icons/react/dist/ssr/Minus";
import Link from "next/link";
import { useId, useState } from "react";
import { HoondokMascot, WeekStrip } from "@/components/hoondok";
import { InlineConfirm } from "@/features/hoondok/personal/components/inline-confirm";
import type { PathRunView, PathStepSummary } from "../api";
import {
  minutesLabel,
  monthDayLabel,
  nextStepOf,
  slotLabel,
  stepWindow,
  todayWhatLine,
  weekDoneByDay,
  weekdayOf,
  withEul,
  withIeyo,
} from "../format";
import { dismissReturnSheet, isReturnSheetDismissed, shouldOfferReturn } from "../return-sheet";
import { useAbandonPathRun } from "../use-path-run";
import { PathSheet } from "./path-sheet";

export function PathStartCard() {
  const titleId = useId();
  return (
    <article className="card path-start" aria-labelledby={titleId}>
      <h2 className="path-start__title" id={titleId}>
        7일 정성으로 말씀을 읽어 보세요
      </h2>
      <p className="path-start__body">하루 몇 분, 언제 읽을지만 정하면 돼요.</p>
      <Link className="btn btn-line" href="/path">
        정성 시작하기
      </Link>
    </article>
  );
}

/** 마지막 장을 읽고 마침표를 아직 보지 않은 run. 부엉이는 마침표 화면에만 있다. */
export function PathClosingCard({ run }: { run: PathRunView }) {
  const titleId = useId();
  return (
    <article className="card path-start" aria-labelledby={titleId}>
      <h2 className="path-start__title" id={titleId}>
        {`${withEul(run.title)} 마쳤어요`}
      </h2>
      <Link className="btn btn-line" href="/path/done">
        마침 화면 보기
      </Link>
    </article>
  );
}

export function PathHomeSkeleton() {
  return (
    <div className="path-skel" aria-busy="true">
      <span className="wd-skel wd-skel--head" aria-hidden="true" />
      <span className="wd-skel path-skel__card" aria-hidden="true" />
      <span className="wd-skel path-skel__row" aria-hidden="true" />
      <span className="wd-skel path-skel__row" aria-hidden="true" />
      <span className="wd-skel path-skel__row" aria-hidden="true" />
    </div>
  );
}

function stepSub(step: PathStepSummary, readToday: boolean): string {
  if (step.state === "done") return "읽음";
  if (step.state === "withdrawn") return "지금은 열 수 없어요";
  if (step.state === "next") return readToday ? "내일 읽을 장" : "오늘 읽을 장";
  return minutesLabel(step.estimated_minutes);
}

export function PathStepList({ run }: { run: PathRunView }) {
  const rows = stepWindow(run.steps, run.next_step);
  const total = run.steps.length;
  const first = rows[0]?.day_index ?? 1;
  const last = rows.at(-1)?.day_index ?? total;
  return (
    <>
      <ol className="path-steps" aria-label={`${run.title} 장 목록`}>
        {rows.map((step) => {
          const isNext = step.state === "next";
          const sub = stepSub(step, run.read_today);
          return (
            <li
              key={step.day_index}
              className="path-step"
              data-state={step.state}
              aria-current={isNext ? "step" : undefined}
            >
              <span className="path-sr">{`${step.day_index}번째 장, ${step.title}, ${sub}`}</span>
              <span className="path-step__n" aria-hidden="true">
                {step.state === "done" ? (
                  <CheckIcon weight="bold" size={20} />
                ) : step.state === "withdrawn" ? (
                  <MinusIcon size={20} />
                ) : (
                  step.day_index
                )}
              </span>
              <span className="path-step__tx" aria-hidden="true">
                <span className="path-step__t">{step.title}</span>
                <span className="path-step__s">{sub}</span>
              </span>
              {isNext && <HoondokMascot pose="reading" size={40} />}
            </li>
          );
        })}
      </ol>
      {total > 7 && <p className="path-steps__range">{`${total}장 중 ${first}~${last}장`}</p>}
    </>
  );
}

/** 돌아온 날 시트 — 평소대로 읽기 / 나중에 두 가지뿐(1a). 쉰 날 수를 말하지 않고 부엉이도 두지 않는다. */
export function PathReturnSheet({ run, next }: { run: PathRunView; next: PathStepSummary }) {
  // run 은 브라우저에서만 조회되므로(서버 렌더에 없음) 첫 렌더에서 저장소를 읽어도 하이드레이션과 어긋나지 않는다
  const [isDismissed, setIsDismissed] = useState(() => isReturnSheetDismissed(run.id, run.today));
  if (isDismissed || !shouldOfferReturn(run)) return null;
  const close = () => {
    dismissReturnSheet(run.id, run.today);
    setIsDismissed(true);
  };
  return (
    <PathSheet title="쉬었다 오셔도 괜찮아요" onClose={close}>
      <p className="path-return__body">읽던 곳부터 하루 한 장씩 이어 읽으면 돼요.</p>
      <p className="path-return__next">{`${next.title} · ${minutesLabel(next.estimated_minutes)}`}</p>
      <div className="path-return__cta">
        <Link
          className="btn btn-primary"
          href={`/path/read/${next.day_index}`}
          onClick={() => dismissReturnSheet(run.id, run.today)}
        >
          평소대로 읽기
        </Link>
        <button type="button" className="btn btn-ghost" onClick={close}>
          나중에
        </button>
      </div>
    </PathSheet>
  );
}

export function PathHome({ run }: { run: PathRunView }) {
  const abandon = useAbandonPathRun();
  const next = nextStepOf(run);
  return (
    <section className="path-home" aria-labelledby="path-home-title">
      <div className="path-head">
        <h2 id="path-home-title" className="path-head__title">
          {run.title}
        </h2>
        <span className="path-head__count" aria-label={`읽은 장 ${run.total_steps}장 중 ${run.done_steps}장`}>
          {`읽은 장 ${run.done_steps}/${run.total_steps}`}
        </span>
      </div>

      <div className="card path-today">
        <p className="path-today__when">
          {next
            ? `${slotLabel(run.preferred_slot)} · ${minutesLabel(next.estimated_minutes)}`
            : slotLabel(run.preferred_slot)}
        </p>
        {run.read_today ? (
          <>
            <p className="path-today__done" role="status">
              <span className="path-today__ok" aria-hidden="true">
                <CheckIcon weight="bold" size={20} />
              </span>
              오늘 말씀을 읽었어요
            </p>
            {next && <p className="path-today__note">{`내일은 ${withIeyo(next.title)}.`}</p>}
          </>
        ) : next ? (
          <>
            <h3 className="path-today__what">{todayWhatLine(run, next)}</h3>
            {run.overdue && (
              <p className="path-today__note">
                {`남은 ${run.total_steps - run.done_steps}장을 이어 읽으시면 정성을 마쳐요.`}
              </p>
            )}
            <Link className="btn btn-primary path-today__go" href={`/path/read/${next.day_index}`}>
              읽기 시작
            </Link>
          </>
        ) : (
          <h3 className="path-today__what">지금 열 수 있는 장이 없어요</h3>
        )}
      </div>

      <div className="sect">
        <div className="sect__head">
          <h3 className="sect__title path-sect__title">이번 주 읽은 날</h3>
        </div>
        <WeekStrip
          startsOn="sun"
          label="이번 주 읽은 날"
          doneLabel="읽음"
          todayWeekday={weekdayOf(run.today)}
          doneByDay={weekDoneByDay(run.today, run.week_read_dates)}
        />
      </div>

      <PathStepList run={run} />
      {!run.overdue && <p className="path-end">{`끝나는 날 ${monthDayLabel(run.end_on)}`}</p>}
      <InlineConfirm
        openLabel="이 정성 그만하기"
        label="정성 그만하기 확인"
        message="그만해도 지금까지 읽은 기록은 지우지 않아요."
        confirmLabel="그만하기"
        openClassName="path-quit"
        onConfirm={() => abandon.mutate()}
      />
      {abandon.isError && (
        <p className="hint hint--alert" role="alert">
          그만하지 못했어요. 다시 시도해 주세요.
        </p>
      )}
      {next && <PathReturnSheet run={run} next={next} />}
    </section>
  );
}
