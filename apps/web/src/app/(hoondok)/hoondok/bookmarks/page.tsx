// SCR-PWA-026 나의 책갈피 (PLAN-HD-012). 나의 정원 탭 소속. 받은 책갈피 / 건넨 책갈피(?filter=shared).
import { notFound } from "next/navigation";
import { BookmarksScreen } from "@/features/hoondok/cards/components/bookmarks-screen";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";

export default async function HoondokBookmarksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  if (!isHoondokCardsEnabled()) notFound();
  const { filter } = await searchParams;
  return <BookmarksScreen initialFilter={filter === "shared" ? "shared" : "received"} />;
}
