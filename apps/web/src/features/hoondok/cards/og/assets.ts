// 이미지 라우트 공용 자산 (단건 카드·콜라주). 글꼴은 self-host Pretendard TTF 서브셋(Satori 는 woff2 를 읽지 못한다),
// 그림은 public 의 PNG·JPEG 사본(Satori 는 webp 를 읽지 못한다). 요청과 무관하므로 프로세스당 한 번 읽는다.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PHOTO_BACKGROUNDS, type PhotoBackground } from "../look";
import type { ImageAssets } from "./card-image";

const ASSET_DIR = path.join(process.cwd(), "public/hoondok/cards");

let assetsPromise: Promise<{ font: Buffer; images: ImageAssets }> | null = null;

export function loadImageAssets() {
  assetsPromise ??= (async () => {
    const dataUrl = async (name: string, type: string) =>
      `data:${type};base64,${(await readFile(path.join(ASSET_DIR, name))).toString("base64")}`;
    const [font, leaves, twig, cup, ...photos] = await Promise.all([
      readFile(path.join(ASSET_DIR, "Pretendard-Medium-1.3.9.subset.ttf")),
      dataUrl("leaves.png", "image/png"),
      dataUrl("twig.png", "image/png"),
      dataUrl("cup.png", "image/png"),
      ...PHOTO_BACKGROUNDS.map((bg) => dataUrl(`bg-${bg}.jpg`, "image/jpeg")),
    ]);
    const photoMap = Object.fromEntries(PHOTO_BACKGROUNDS.map((bg, index) => [bg, photos[index]])) as Record<
      PhotoBackground,
      string
    >;
    return { font, images: { leaves, twig, cup, photos: photoMap } };
  })().catch((error: unknown) => {
    assetsPromise = null;
    throw error;
  });
  return assetsPromise;
}

export const IMAGE_FONTS = (font: Buffer) => [
  { name: "Pretendard", data: font, weight: 500 as const, style: "normal" as const },
];
