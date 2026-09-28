// 책갈피 이미지 (PLAN-HD-012): /hoondok/c/{id}/image?f=link|square|story → 800×400 · 1080×1080 · 1080×1920 PNG.
// link 는 카톡 링크 미리보기(og:image), square·story 는 저장·공유용. 라우트 핸들러는 hoondok layout 을 거치지 않으므로
// 플래그를 여기서 다시 본다. 글꼴은 self-host Pretendard TTF 서브셋(Satori 는 woff2 를 읽지 못한다), 사진은 public 의 PNG 사본.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { loadCard } from "@/features/hoondok/cards/api";
import {
  cardImageElement,
  IMAGE_SIZE,
  type ImageAssets,
  type ImageFormat,
} from "@/features/hoondok/cards/og/card-image";
import { isHoondokCardsEnabled, isHoondokEnabled } from "@/features/hoondok/flag";

const ASSET_DIR = path.join(process.cwd(), "public/hoondok/cards");
const FORMATS: readonly ImageFormat[] = ["link", "square", "story"];

// 글꼴·사진은 요청과 무관하므로 프로세스당 한 번 읽는다
let assetsPromise: Promise<{ font: Buffer; images: ImageAssets }> | null = null;
function loadAssets() {
  assetsPromise ??= (async () => {
    const dataUrl = async (name: string) =>
      `data:image/png;base64,${(await readFile(path.join(ASSET_DIR, name))).toString("base64")}`;
    const [font, leaves, twig, cup] = await Promise.all([
      readFile(path.join(ASSET_DIR, "Pretendard-Medium-1.3.9.subset.ttf")),
      dataUrl("leaves.png"),
      dataUrl("twig.png"),
      dataUrl("cup.png"),
    ]);
    return { font, images: { leaves, twig, cup } };
  })().catch((error: unknown) => {
    assetsPromise = null;
    throw error;
  });
  return assetsPromise;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokEnabled() || !isHoondokCardsEnabled()) return new Response("Not Found", { status: 404 });
  const requested = new URL(request.url).searchParams.get("f");
  const format = FORMATS.find((item) => item === requested) ?? "link";
  const { id } = await params;
  const card = await loadCard(id).catch(() => undefined);
  if (card === null) return new Response("Not Found", { status: 404 });
  if (card === undefined) return new Response("Upstream Error", { status: 502 });
  const { font, images } = await loadAssets();
  return new ImageResponse(cardImageElement(card, format, images), {
    ...IMAGE_SIZE[format],
    fonts: [{ name: "Pretendard", data: font, weight: 500, style: "normal" }],
    // 카드 본문은 바뀌지 않는다(admin 도 수정 불가). 중지(retired)는 한 시간 안에 링크 미리보기에서도 사라진다.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
