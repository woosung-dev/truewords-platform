// SCR-PWA-023 오늘의 책갈피 받기·읽기 (PLAN-HD-012). 아침 알림(훈독하기)의 url 이 이 화면이다.
// 플래그 OFF 면 404 대신 홈으로 보낸다 — 알림을 누른 사용자가 빈 화면을 보지 않게(계획 §4).
import { BookOpenText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadTodayCard } from "@/features/hoondok/cards/api";
import { BookmarkScreen } from "@/features/hoondok/cards/components/bookmark-screen";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";
import { formatKstDate } from "@/features/hoondok/today";

export default async function HoondokBookmarkPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  if (!isHoondokCardsEnabled()) redirect("/hoondok");
  const [card, query] = await Promise.all([loadTodayCard(), searchParams]);
  const today = formatKstDate().iso;
  if (!card)
    return (
      <section className="col">
        <div className="card">
          <div className="empty" role="status">
            <span className="empty__ic" aria-hidden="true">
              <BookOpenText size={26} />
            </span>
            <h2 className="empty__title">오늘 꽂힌 책갈피가 없어요</h2>
            <p className="empty__body">내일 아침 다시 찾아와 주세요. 말씀 서고에서 원문은 언제든 읽을 수 있어요.</p>
            <p className="gd-cta">
              <Link className="btn btn-line btn--sm" href="/hoondok/library">
                말씀 서고로
              </Link>
            </p>
          </div>
        </div>
      </section>
    );
  // 날짜가 바뀌면 카드도 바뀌므로 key 로 화면 상태를 새로 시작한다
  return <BookmarkScreen key={`${today}:${card.id}`} card={card} today={today} from={query.from} />;
}
