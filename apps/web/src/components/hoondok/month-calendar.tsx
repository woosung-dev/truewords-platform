import type { WeekDay } from "@truewords/api-client-ts/types";
import { Check } from "lucide-react";
import { monthGrid } from "@/features/hoondok/kst";

// 월 달력 (DES-PWA-003 §2.6 · SCR-PWA-014). 데이터를 스스로 읽지 않는 순수 표시 컴포넌트다.
// 완료는 색이 아니라 체크 아이콘이 1차 신호다(DES §3.3). 칸은 비상호작용이므로 표가 아니라 목록으로 노출하고
// 칸마다 "9월 8일 오늘 완료" 같은 전체 문장 레이블을 준다. "쉼"(주 1회 면제)은 아직 데이터가 없어 그리지 않는다.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type MonthCalendarProps = {
  /** `YYYY-MM` (KST). kstMonthKey 가 만든 값 */
  month: string;
  /** 그 달의 날들 (1일부터 일수만큼). API-HD-010 `days[]` */
  days: WeekDay[];
  /** 오늘 KST `YYYY-MM-DD`. 오늘 칸 표시와 미래 칸 흐림의 기준이다 */
  today: string;
};

/** `2026-09` → `2026년 9월`. Intl 을 쓰지 않아 서버·클라이언트가 같은 문자열을 낸다. */
export function monthLabel(month: string): string {
  return `${Number(month.slice(0, 4))}년 ${Number(month.slice(5, 7))}월`;
}

/** `9월 8일 완료` · `9월 10일 오늘 아직` — 색을 못 보는 사람에게도 칸 하나가 전체 문장이다. */
function cellLabel(date: string, isDone: boolean, isToday: boolean): string {
  const day = `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
  return `${day} ${isToday ? "오늘 " : ""}${isDone ? "완료" : "아직"}`;
}

/** 상태 원. isTiny 는 범례용 축소판이다. */
function CalendarDot({ isDone, isTiny }: { isDone: boolean; isTiny?: boolean }) {
  const classes = ["gd-cal__dot", isDone ? "gd-cal__dot--done" : "", isTiny ? "gd-cal__dot--tiny" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {isDone && <Check size={14} />}
    </span>
  );
}

export function MonthCalendar({ month, days, today }: MonthCalendarProps) {
  const { leadingBlanks, cells } = monthGrid(month, days);
  const label = monthLabel(month);

  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">{label}</h2>
        <span className="sect__meta">훈독 완료한 날</span>
      </div>
      <div className="card">
        <div className="gd-cal__head" aria-hidden="true">
          {DAY_LABELS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <ol className="gd-cal__grid" aria-label={`${label} 훈독 기록`}>
          {Array.from({ length: leadingBlanks }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 1일 앞 빈 칸은 내용이 없고 순서만 있다
            <li key={`pad-${index}`} className="gd-cal__pad" aria-hidden="true" />
          ))}
          {cells.map((cell) => {
            const isToday = cell.date === today;
            return (
              <li
                key={cell.date}
                className="gd-cal__day"
                data-done={cell.done ? "" : undefined}
                data-today={isToday ? "" : undefined}
                data-future={cell.date > today ? "" : undefined}
                aria-label={cellLabel(cell.date, cell.done, isToday)}
              >
                <CalendarDot isDone={cell.done} />
                <b>{Number(cell.date.slice(8, 10))}</b>
              </li>
            );
          })}
        </ol>
        <p className="gd-cal__legend">
          <span>
            <CalendarDot isDone isTiny />
            완료
          </span>
          <span>
            <CalendarDot isDone={false} isTiny />
            아직
          </span>
        </p>
      </div>
    </div>
  );
}
