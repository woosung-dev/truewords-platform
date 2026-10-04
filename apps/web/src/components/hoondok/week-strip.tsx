import { Check } from "lucide-react";

// 요일 스트립 (DES-PWA-003 §2.11 · 홈 "이번 주"). 월요일 시작 7칸.
// 연속일은 섹션 머리(`.sect__meta`)가 한 번만 말한다 — 스트립 옆에도 두면 같은 숫자가 두 번 보이고,
// 로그인 여부에 따라 요일 원이 쓸 폭이 달라져 원 크기가 바뀐다.
// 완료는 색이 아니라 체크 아이콘이 1차 신호다(DES §3.3). 완료한 칸은 체크만 보이고 요일 글자와 "완료" 는
// 보조기기가 읽는다. 완료하지 않은 칸은 원 없이 글자만 둔다 — 빈 원은 빠진 날을 세게 만든다 (DEC-PWA-023).
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type WeekStripProps = {
  /** 0=일 … 6=토 */
  todayWeekday: number;
  /** 월요일부터 7개 */
  doneByDay?: readonly boolean[];
};

export function WeekStrip({ todayWeekday, doneByDay = [] }: WeekStripProps) {
  const todayIndex = (todayWeekday + 6) % 7; // 월=0
  return (
    <div className="week">
      <ol className="week__days" aria-label="이번 주 훈독">
        {DAY_LABELS.map((label, index) => {
          const isDone = Boolean(doneByDay[index]);
          const isToday = index === todayIndex;
          return (
            <li
              key={label}
              className="week__day"
              data-done={isDone ? "" : undefined}
              data-today={isToday ? "" : undefined}
              aria-current={isToday ? "date" : undefined}
            >
              {isDone && <Check size={14} strokeWidth={3} aria-hidden="true" />}
              <span className={isDone ? "sr-only" : undefined}>{label}</span>
              {isToday && <span className="sr-only"> 오늘</span>}
              {isDone && <span className="sr-only"> 완료</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
