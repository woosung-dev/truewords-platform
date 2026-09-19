import { Flame } from "lucide-react";

// 요일 스트립 (DES-PWA-003 §2.11 · 홈 "이번 주"). 월요일 시작 7칸 + 연속일.
// Phase 1 은 완료 데이터가 없어 오늘 표시만 한다. 완료·연속일은 Phase 2 summary 로 채운다.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type WeekStripProps = {
  /** 0=일 … 6=토 */
  todayWeekday: number;
  /** 월요일부터 7개. Phase 1 은 전부 false */
  doneByDay?: readonly boolean[];
  streakDays?: number;
};

export function WeekStrip({ todayWeekday, doneByDay = [], streakDays = 0 }: WeekStripProps) {
  const todayIndex = (todayWeekday + 6) % 7; // 월=0
  return (
    <div className="week">
      <ol className="week__days" aria-label="이번 주 훈독">
        {DAY_LABELS.map((label, index) => (
          <li
            key={label}
            className="week__day"
            data-done={doneByDay[index] ? "" : undefined}
            data-today={index === todayIndex ? "" : undefined}
            aria-current={index === todayIndex ? "date" : undefined}
          >
            {label}
          </li>
        ))}
      </ol>
      <span className="week__streak">
        <Flame size={16} aria-hidden="true" />
        연속 <b>{streakDays}</b>일
      </span>
    </div>
  );
}
