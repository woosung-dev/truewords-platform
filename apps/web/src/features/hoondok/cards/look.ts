// 사진 카드 모양 (SCR-PWA-024 사진 카드로 건네기, 이번 달 모은 말씀). 화면(DOM)과 이미지 라우트(Satori)가 함께 쓰는 순수 모듈이다.
// 이미지 주소의 쿼리는 여기 허용 목록으로만 읽는다 — 목록 밖 값은 기본값으로 바꾸고 그대로 쓰지 않는다.
import type { CardPublic } from "./api";
import { bookName } from "./components/book";

/** 바탕: 사진 4장 + 책 색. 사진 파일은 화면용 webp(public/hoondok/photos)와 이미지 라우트용 JPEG(public/hoondok/cards/bg-*.jpg) 두 벌이다 */
export const PHOTO_BACKGROUNDS = ["field", "sunlit", "lake", "orchard"] as const;
export type PhotoBackground = (typeof PHOTO_BACKGROUNDS)[number];
export const CARD_BACKGROUNDS = [...PHOTO_BACKGROUNDS, "book"] as const;
export type CardBackground = (typeof CARD_BACKGROUNDS)[number];

export const BACKGROUND_LABEL: Record<CardBackground, string> = {
  field: "들판",
  sunlit: "햇살",
  lake: "호수",
  orchard: "과수원",
  book: "책 색",
};

/** 화면용 사진(webp) 이름 */
export const PHOTO_FILE: Record<PhotoBackground, string> = {
  field: "home-morning-field",
  sunlit: "onboarding-sunlit-field",
  lake: "challenge-lake-dawn",
  orchard: "sermon-orchard-dusk",
};

export function photoSrc(bg: PhotoBackground): string {
  return `/hoondok/photos/${PHOTO_FILE[bg]}.webp`;
}

/** 비율: 4:5 카톡·피드(1080×1350) / 9:16 스토리(1080×1920) */
export const PHOTO_FORMATS = ["feed", "story"] as const;
export type PhotoFormat = (typeof PHOTO_FORMATS)[number];

/** 출처 표시: 자세히(출처 전체) / 책 이름만. 빼기는 없다 — 출처와 훈독 표시는 늘 인쇄한다 */
export const SOURCE_MODES = ["full", "book"] as const;
export type SourceMode = (typeof SOURCE_MODES)[number];

/** 출처 줄: 자세히 = source_label, 책 이름만 = 책 이름(편·권 포함) */
export function sourceText(card: Pick<CardPublic, "source_label" | "work_title" | "volume">, src: SourceMode): string {
  return src === "book" ? bookName(card) : card.source_label;
}

export type CardLook = { format: PhotoFormat; bg: CardBackground; src: SourceMode };

/** 책 색 6가지(hoondok.css --book-1~6, og/card-image.tsx 의 사본). 같은 책은 어느 화면에서나 같은 색이다 */
export const BOOK_COLOR_COUNT = 6;

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return value;
}

/** 1~6 */
export function bookColorIndex(workTitle: string): number {
  return (hash(workTitle.trim()) % BOOK_COLOR_COUNT) + 1;
}

/** 카드마다 정해진 기본 사진. 처음 보는 카드도 늘 같은 바탕으로 열린다 */
export function defaultBackground(cardId: string): PhotoBackground {
  return PHOTO_BACKGROUNDS[hash(cardId) % PHOTO_BACKGROUNDS.length];
}

export function defaultLook(cardId: string): CardLook {
  return { format: "feed", bg: defaultBackground(cardId), src: "full" };
}

function pick<T extends string>(allowed: readonly T[], value: string | null | undefined, fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}

/** 이미지 라우트 형식. link·square 는 예전 그대로이고 story 는 사진 패널, feed 는 새 4:5 사진 카드다 */
export const IMAGE_FORMATS = ["link", "square", "story", "feed"] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

export type ImageQuery = { format: "link" | "square" } | { format: PhotoFormat; bg: CardBackground; src: SourceMode };

/** /c/{id}/image 쿼리. f 가 없거나 모르는 값이면 link(카톡 미리보기). 사진 형식의 bg 기본값은 들판, src 기본값은 자세히 */
export function parseImageQuery(params: URLSearchParams): ImageQuery {
  const format = pick(IMAGE_FORMATS, params.get("f"), "link");
  if (format === "link" || format === "square") return { format };
  return {
    format,
    bg: pick(CARD_BACKGROUNDS, params.get("bg"), PHOTO_BACKGROUNDS[0]),
    src: pick(SOURCE_MODES, params.get("src"), "full"),
  };
}

/** 저장된 모양(기기 localStorage) 검증. 하나라도 목록 밖이면 null */
export function toLook(value: unknown): CardLook | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const format = PHOTO_FORMATS.find((item) => item === record.format);
  const bg = CARD_BACKGROUNDS.find((item) => item === record.bg);
  const src = SOURCE_MODES.find((item) => item === record.src);
  return format && bg && src ? { format, bg, src } : null;
}

// ---------- 이번 달 모은 말씀 (콜라주) ----------

export const COLLAGE_MAX = 4;
export const COLLAGE_THEMES = ["paper", "night"] as const;
export type CollageTheme = (typeof COLLAGE_THEMES)[number];
export type CollageQuery = { ids: string[]; theme: CollageTheme; format: PhotoFormat };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /c/collage/image 쿼리. ids 는 쉼표로 잇고 UUID 꼴만, 겹치면 하나로, 앞에서 4장까지만 받는다 */
export function parseCollageQuery(params: URLSearchParams): CollageQuery {
  const ids: string[] = [];
  for (const raw of (params.get("ids") ?? "").split(",")) {
    const id = raw.trim().toLowerCase();
    if (UUID.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === COLLAGE_MAX) break;
  }
  return {
    ids,
    theme: pick(COLLAGE_THEMES, params.get("theme"), "paper"),
    format: pick(PHOTO_FORMATS, params.get("f"), "feed"),
  };
}

/** 콜라주 칸마다 돌려 쓰는 사진 순서 */
export const COLLAGE_PHOTOS: readonly PhotoBackground[] = ["field", "lake", "orchard", "sunlit"];
