// 이번 달 모은 말씀 (SCR-PWA-026 콜라주): /c/collage/image?ids=a,b,c,d&theme=paper|night&f=feed|story → PNG.
// 정적 폴더 collage 가 동적 [id] 보다 먼저 맞는다. ids 는 공개 카드 id(UUID) 4장까지이고 비공개·없는 카드는 빼고 그린다.
// 받은 기록과 무관한 공개 카드만 그리므로 로그인 없이 열린다. 링크 대신 이미지 파일로만 건넨다.
import { ImageResponse } from "next/og";
import { loadCard } from "@/features/hoondok/cards/api";
import { parseCollageQuery } from "@/features/hoondok/cards/look";
import { IMAGE_FONTS, loadImageAssets } from "@/features/hoondok/cards/og/assets";
import { collageImageElement, IMAGE_SIZE } from "@/features/hoondok/cards/og/card-image";
import { isHoondokCardsEnabled, isHoondokEnabled } from "@/features/hoondok/flag";
import { formatKstDate } from "@/features/hoondok/today";

export async function GET(request: Request) {
  if (!isHoondokEnabled() || !isHoondokCardsEnabled()) return new Response("Not Found", { status: 404 });
  const { ids, theme, format } = parseCollageQuery(new URL(request.url).searchParams);
  if (ids.length === 0) return new Response("Bad Request", { status: 400 });
  const loaded = await Promise.all(ids.map((id) => loadCard(id).catch(() => undefined)));
  if (loaded.some((card) => card === undefined)) return new Response("Upstream Error", { status: 502 });
  const cards = loaded.filter((card) => card != null);
  if (cards.length === 0) return new Response("Not Found", { status: 404 });
  const month = Number(formatKstDate().iso.slice(5, 7));
  const { font, images } = await loadImageAssets();
  return new ImageResponse(collageImageElement({ cards, theme, format, month, assets: images }), {
    ...IMAGE_SIZE[format],
    fonts: IMAGE_FONTS(font),
    // 제목의 달이 바뀌므로 짧게 둔다
    headers: { "Cache-Control": "public, max-age=600" },
  });
}
