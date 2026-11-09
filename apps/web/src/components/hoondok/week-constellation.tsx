import { StarIcon } from "@phosphor-icons/react/dist/ssr/Star";
import type { CSSProperties } from "react";
import { constellationLinks, STAR_POINTS } from "@/features/hoondok/sky";

// 이번 주 요일 (홈 "오늘의 하늘" 별자리, SCR-PWA-002). 월요일 시작 7칸. 빈 날은 점선 빈 별, 훈독한 날은 금색 별,
// 연속으로 이어진 날끼리만 금색 선으로 잇는다. 색은 하늘 시간대(.sky[data-sky])가 정한다.
// 연속일은 섹션 머리(`.sect__meta`)가 한 번만 말한다 — 별자리 옆에 같은 숫자를 다시 두지 않는다.
const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type WeekConstellationProps = {
  /** 0=일 … 6=토 */
  todayWeekday: number;
  /** 월요일부터 7개 */
  doneByDay?: readonly boolean[];
};

/** 별자리 선. 좁은 화면(별자리 상자)과 넓은 화면(하늘 전체) 좌표가 달라 두 벌을 그리고 CSS 가 하나만 보인다 */
function Lines({ links, layout }: { links: [number, number][]; layout: "narrow" | "wide" }) {
  return (
    <svg
      className={`week__lines week__lines--${layout}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {links.map(([from, to]) => (
        <line
          key={from}
          x1={STAR_POINTS[from][layout][0]}
          y1={STAR_POINTS[from][layout][1]}
          x2={STAR_POINTS[to][layout][0]}
          y2={STAR_POINTS[to][layout][1]}
        />
      ))}
    </svg>
  );
}

export function WeekConstellation({ todayWeekday, doneByDay = [] }: WeekConstellationProps) {
  const todayIndex = (todayWeekday + 6) % 7; // 월=0
  const links = constellationLinks(doneByDay);
  return (
    <div className="week">
      <Lines links={links} layout="narrow" />
      <Lines links={links} layout="wide" />
      <ol className="week__days" aria-label="이번 주 훈독">
        {DAY_LABELS.map((label, index) => {
          const point = STAR_POINTS[index];
          const isToday = index === todayIndex;
          return (
            <li
              key={label}
              className="week__day"
              style={
                {
                  "--nx": point.narrow[0],
                  "--ny": point.narrow[1],
                  "--wx": point.wide[0],
                  "--wy": point.wide[1],
                } as CSSProperties
              }
              aria-label={`${label}요일${doneByDay[index] ? " · 훈독 완료" : ""}`}
              data-done={doneByDay[index] ? "" : undefined}
              data-today={isToday ? "" : undefined}
              aria-current={isToday ? "date" : undefined}
            >
              <span className="week__ring" aria-hidden="true" />
              <StarIcon className="week__star" weight="fill" aria-hidden="true" />
              <span className="week__label" aria-hidden="true">
                {label}
                {isToday && <span className="week__today">오늘</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
