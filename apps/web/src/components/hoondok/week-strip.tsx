// 요일 스트립 (DES-PWA-003 §2.11 · 홈 "이번 주"). 월요일 시작 7칸.
// 연속일은 섹션 머리(`.sect__meta`)가 한 번만 말한다 — 스트립 옆에도 두면 같은 숫자가 두 번 보이고,
// 로그인 여부에 따라 요일 원이 쓸 폭이 달라져 원 크기가 바뀐다.
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
    </div>
  );
}
