// SCR-PWA-025 받은 사람 화면 (PLAN-HD-012). 로그인 없이 열리는 공개 화면이고 열람 수는 세지 않는다.
// 순서: 카드 → "원문에서 앞뒤 읽기"(주) → "훈독에서 매일 한 장 받기"(보조). 카톡 링크 카드는 아래 OG(2:1 이미지)로 그려진다.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCard } from "@/features/hoondok/cards/api";
import { BookmarkCard } from "@/features/hoondok/cards/components/bookmark-card";
import { cardImagePath, cardWordsHref } from "@/features/hoondok/cards/share";
import { isHoondokCardsEnabled } from "@/features/hoondok/flag";

type Props = { params: Promise<{ id: string }> };

const WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_URL || "http://localhost:3000";

/** 설명: 본문 앞부분(80자). 줄바꿈은 공백으로. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : flat;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isHoondokCardsEnabled()) return {};
  const { id } = await params;
  const card = await loadCard(id).catch(() => null);
  if (!card) return {};
  const title = `오늘의 책갈피 · ${card.work_title}`;
  const description = excerpt(card.text);
  const image = { url: cardImagePath(card.id, "link"), width: 800, height: 400, alt: `${card.source_label} · 훈독` };
  return {
    metadataBase: new URL(WEB_ORIGIN),
    title,
    description,
    openGraph: { type: "article", siteName: "훈독", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function HoondokCardPage({ params }: Props) {
  if (!isHoondokCardsEnabled()) notFound();
  const { id } = await params;
  const card = await loadCard(id);
  if (!card) notFound();
  return (
    <section className="col rcv">
      <BookmarkCard card={card} eyebrow="오늘의 책갈피" className="bm--full rcv__card" />
      <div className="rcv__actions">
        <Link className="btn btn-primary" href={cardWordsHref(card)}>
          원문에서 앞뒤 읽기
        </Link>
        <Link className="btn btn-line" href="/hoondok">
          훈독에서 매일 한 장 받기
        </Link>
      </div>
      <p className="notice">가입하지 않아도 이 책갈피와 원문은 볼 수 있어요</p>
    </section>
  );
}
