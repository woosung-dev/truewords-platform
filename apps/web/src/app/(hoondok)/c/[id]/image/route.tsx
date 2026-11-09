// 책갈피 이미지 (PLAN-HD-012, SCR-PWA-024): /c/{id}/image?f=link|square|story|feed[&bg=…&src=full|book]
// → 800×400 · 1080×1080 · 1080×1920 · 1080×1350 PNG. link 는 카톡 링크 미리보기(og:image), 나머지는 저장·공유용.
// 쿼리는 look.ts 허용 목록으로만 읽는다(쿼리 없는 주소 = link). 라우트 핸들러는 hoondok layout 을 거치지 않으므로 플래그를 여기서 다시 본다.
import { ImageResponse } from "next/og";
import { loadCard } from "@/features/hoondok/cards/api";
import { parseImageQuery } from "@/features/hoondok/cards/look";
import { IMAGE_FONTS, loadImageAssets } from "@/features/hoondok/cards/og/assets";
import { cardImageElement, IMAGE_SIZE } from "@/features/hoondok/cards/og/card-image";
import { isHoondokCardsEnabled, isHoondokEnabled } from "@/features/hoondok/flag";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokEnabled() || !isHoondokCardsEnabled()) return new Response("Not Found", { status: 404 });
  const query = parseImageQuery(new URL(request.url).searchParams);
  const { id } = await params;
  const card = await loadCard(id).catch(() => undefined);
  if (card === null) return new Response("Not Found", { status: 404 });
  if (card === undefined) return new Response("Upstream Error", { status: 502 });
  const { font, images } = await loadImageAssets();
  return new ImageResponse(cardImageElement(card, query, images), {
    ...IMAGE_SIZE[query.format],
    fonts: IMAGE_FONTS(font),
    // 카드 본문은 바뀌지 않는다(admin 도 수정 불가). 중지(retired)는 한 시간 안에 링크 미리보기에서도 사라진다.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
