// 홈 모임 카드 1장 (PLAN-HD-010 §6 홈, 프로토타입 today `?together=default` 의 `a.card.together`).
// 오늘 완료자 수와 완료자 이니셜(서버가 최대 3개)만 보인다 — 전체 인원·안 읽은 사람은 그리지 않는다(D5).
// 모임 이름은 길거나 이모지여도 한 줄 말줄임으로 자르고, 뒤 문구는 다음 줄로 넘긴다(390px 가로 넘침 방지).
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { MyGroupItem } from "../groups-api";

type GroupJeongseong = MyGroupItem["jeongseongs"][number];

/** 진행 중인 정성인가 — 시작 전(upcoming)은 싣지 않는다. */
export function isActiveJeongseong(js: GroupJeongseong): boolean {
  return js.state === "active" && js.day_index !== null;
}

/** "{제목} N일차" 한 조각. */
export function jeongseongLabel(js: GroupJeongseong): string {
  return `${js.title} ${js.day_index}일차`;
}

/** 이 모임이 정한 진행 중 정성만 잇는다. 공식 정성은 모든 카드에 반복되므로 목록 위에 한 번만 싣는다(QA P2-R2-4). */
export function jeongseongLine(group: Pick<MyGroupItem, "jeongseongs">): string {
  return group.jeongseongs
    .filter((js) => !js.is_official && isActiveJeongseong(js))
    .map(jeongseongLabel)
    .join(" · ");
}

export function GroupCard({ group }: { group: MyGroupItem }) {
  const count = group.today_read_count;
  const js = jeongseongLine(group);
  // 완료자가 없으면 숫자를 쓰지 않는다 — "0명" 은 재촉처럼 읽힌다(D7)
  const sub = count > 0 ? js : ["오늘의 말씀을 함께 읽어요", js].filter(Boolean).join(" · ");
  const initials = group.readers_preview.slice(0, 3);

  return (
    <Link className="card together tg-gc" href={`/hoondok/groups/${encodeURIComponent(group.id)}`}>
      {initials.length > 0 && (
        <span className="avatars" aria-hidden="true">
          {initials.map((initial, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 이니셜은 서로 겹칠 수 있고(같은 성) 서버 순서 그대로 표시만 한다
            <span className="tg-av" key={index}>
              {initial}
            </span>
          ))}
        </span>
      )}
      <span className="together__bd">
        <b className="tg-gc__title">
          <span className="tg-gc__nm">{group.name}</span>
          {count > 0 && <span className="tg-gc__cnt"> · 오늘 {count}명이 함께 읽었어요</span>}
        </b>
        {sub && <span>{sub}</span>}
      </span>
      <ChevronRight className="tg-gc__go" size={20} aria-hidden="true" />
    </Link>
  );
}
