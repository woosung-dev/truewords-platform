// 책갈피 공유 이미지 (PLAN-HD-012, SCR-PWA-024). next/og(Satori) 로 서버에서 그린다 — flexbox·절대 위치만, CSS 변수·grid 없음.
// 색은 hoondok.css 토큰과 같은 값을 여기에 한 번 더 적는다(Satori 는 CSS 변수를 읽지 못한다). 출처와 "훈독" 은 모든 형식에 늘 인쇄한다.
// link(카톡 미리보기)·square 는 종이 카드 그대로, feed(4:5)·story(9:16) 는 사진 카드다. 사진은 public 의 JPEG 사본(Satori 는 webp 를 못 읽는다).
import type { ReactElement } from "react";
import type { CardPublic } from "../api";
import { bookName } from "../components/book";
import {
  bookColorIndex,
  type CardBackground,
  COLLAGE_PHOTOS,
  type CollageTheme,
  type ImageFormat,
  type ImageQuery,
  type PhotoBackground,
  type PhotoFormat,
  type SourceMode,
  sourceText,
} from "../look";

export type { ImageFormat };

export const IMAGE_SIZE: Record<ImageFormat, { width: number; height: number }> = {
  link: { width: 800, height: 400 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
};

// hoondok.css 토큰 값 (Satori 전용 사본)
const C = {
  paper: "#efe9e0",
  ink: "#23211f",
  ink2: "#5a5652",
  ink3: "#6f6a65",
  accent: "#c24721",
  heart: "#fbe0d3",
  table: "#d7c2ab",
  table2: "#c9b198",
};

// 사진 카드 색 (hoondok.css --espresso·--gold-2·--photo-paper·--book-1~6 사본)
const P = {
  espresso: "#241c16",
  gold: "#c29a5b",
  gold2: "#e3c48e",
  cream: "#f3ede3",
  paper: "#fbf8f2",
  ink: "#1e1914",
  ink3: "#857a6c",
  books: ["#2f4a3a", "#2b3a55", "#7a3a22", "#5a4632", "#4a3a5a", "#3e5656"],
};

export type ImageAssets = { leaves: string; twig: string; cup: string; photos: Record<PhotoBackground, string> };

/** 본문 길이 → 글자 크기(px). 원문은 줄이지 않고 글자만 작게 한다. */
export function imageQuoteSize(text: string, format: "square" | PhotoFormat): number {
  const length = Array.from(text).length;
  const steps =
    format === "story" ? [64, 58, 52, 46, 40] : format === "feed" ? [76, 66, 58, 50, 42] : [62, 54, 46, 38, 32];
  if (length <= 40) return steps[0];
  if (length <= 70) return steps[1];
  if (length <= 110) return steps[2];
  if (length <= 170) return steps[3];
  return steps[4];
}

function Ribbon({ width, height, right }: { width: number; height: number; right: number }) {
  const heart = width * 0.48;
  return (
    <div style={{ position: "absolute", top: 0, right, width, height, display: "flex" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <polygon
          points={`0,0 ${width},0 ${width},${height} ${width / 2},${height * 0.8} 0,${height}`}
          fill={C.accent}
        />
      </svg>
      <svg
        width={heart}
        height={heart}
        viewBox="0 0 24 24"
        style={{ position: "absolute", left: (width - heart) / 2, top: height * 0.4 - heart / 2 }}
        aria-hidden="true"
      >
        <path
          fill={C.heart}
          d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"
        />
      </svg>
    </div>
  );
}

/** 2:1 카톡 링크 미리보기 (시안 ⑦ `.og`): 제목·출처·훈독만. 본문은 링크 설명(og:description)이 보인다. */
// 카드 화면(cards.css .bm__leaves·.bm__cup)과 같은 가장자리 페이드 — 사진 경계가 네모로 보이지 않게
const LEAVES_MASK = "radial-gradient(130% 120% at 0 0, black 45%, transparent 78%)";
const CUP_MASK = "linear-gradient(90deg, transparent, black 18%, black 88%, transparent)";

function LinkImage({ card, assets }: { card: CardPublic; assets: ImageAssets }) {
  const { width, height } = IMAGE_SIZE.link;
  return (
    <div
      style={{ width, height, display: "flex", position: "relative", background: C.paper, fontFamily: "Pretendard" }}
    >
      <img
        src={assets.leaves}
        width={330}
        height={400}
        style={{ position: "absolute", left: 0, top: 0, opacity: 0.8, maskImage: LEAVES_MASK }}
        alt=""
      />
      <img
        src={assets.cup}
        width={300}
        height={212}
        style={{ position: "absolute", right: 24, bottom: 0, maskImage: CUP_MASK }}
        alt=""
      />
      <Ribbon width={56} height={124} right={64} />
      <div
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", width: 560 }}
      >
        <div style={{ fontSize: 58, color: C.ink, letterSpacing: -1 }}>오늘의 책갈피</div>
        <div style={{ fontSize: 28, color: C.ink2, marginTop: 14, lineHeight: 1.4 }}>{card.source_label}</div>
        <div style={{ fontSize: 26, color: C.accent, marginTop: 28, letterSpacing: 2 }}>훈독</div>
      </div>
    </div>
  );
}

/** 1:1 저장용 종이 카드 (시안 `.bm--sq`). 예전 링크 호환으로 남긴다. 위 잎 그림자·리본 → 말씀 → 잔가지·컵 → 출처·훈독 띠. */
function CardImage({ card, assets }: { card: CardPublic; assets: ImageAssets }) {
  const { width, height } = IMAGE_SIZE.square;
  const pad = 130;
  const quote = imageQuoteSize(card.text, "square");
  const sceneHeight = 240;
  const footHeight = 84;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        background: C.paper,
        fontFamily: "Pretendard",
        color: C.ink,
      }}
    >
      <img
        src={assets.leaves}
        width={500}
        height={606}
        style={{ position: "absolute", left: 0, top: 0, opacity: 0.85, maskImage: LEAVES_MASK }}
        alt=""
      />
      <Ribbon width={86} height={184} right={60} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: `${70}px ${pad}px 0`,
        }}
      >
        <div style={{ fontSize: 32, color: C.ink2, letterSpacing: 1 }}>오늘의 책갈피</div>
        <div style={{ width: 96, height: 2, background: C.ink3, opacity: 0.6, marginTop: 24 }} />
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: quote * 1.5,
              color: C.accent,
              alignSelf: "flex-start",
              height: quote * 0.9,
              lineHeight: 1,
            }}
          >
            “
          </div>
          <div
            style={{
              fontSize: quote,
              lineHeight: 1.6,
              textAlign: "center",
              letterSpacing: -0.5,
              wordBreak: "keep-all",
            }}
          >
            {card.text}
          </div>
          <div style={{ fontSize: 30, color: C.ink2, marginTop: 28 }}>{card.source_label}</div>
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", height: sceneHeight, width: "100%" }}>
        <img
          src={assets.twig}
          width={190}
          height={225}
          style={{ position: "absolute", left: 30, bottom: sceneHeight * 0.12 }}
          alt=""
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: sceneHeight * 0.24,
            backgroundImage: `linear-gradient(180deg, ${C.table}, ${C.table2})`,
          }}
        />
        <img
          src={assets.cup}
          width={380}
          height={269}
          style={{ position: "absolute", right: 40, bottom: 0, maskImage: CUP_MASK }}
          alt=""
        />
      </div>
      <div
        style={{
          height: footHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${54}px`,
          background: "rgba(35,33,31,0.86)",
          color: "#ffffff",
          fontSize: 28,
        }}
      >
        <div style={{ display: "flex", maxWidth: width - 260 }}>{card.source_label}</div>
        <div style={{ letterSpacing: 3 }}>훈독</div>
      </div>
    </div>
  );
}

// ---------- 사진 카드 (4:5 피드 · 9:16 스토리) ----------

// 사진 JPEG 는 1350×843(약 1.6:1). 세로 캔버스를 덮도록 높이에 맞춰 키우고 가운데를 보인다.
const PHOTO_RATIO = 1350 / 843;
const SHADE = "linear-gradient(0deg, rgba(14,10,7,0.86) 0%, rgba(14,10,7,0.52) 48%, rgba(14,10,7,0.1) 80%)";
const DIM = "linear-gradient(180deg, rgba(14,10,7,0.18), rgba(14,10,7,0.38))";
const SOLID_SHEEN = "linear-gradient(160deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.3) 100%)";

export function bookHex(workTitle: string): string {
  return P.books[bookColorIndex(workTitle) - 1];
}

function Backdrop({
  bg,
  workTitle,
  assets,
  width,
  height,
}: {
  bg: CardBackground;
  workTitle: string;
  assets: ImageAssets;
  width: number;
  height: number;
}) {
  if (bg === "book")
    return (
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          display: "flex",
          backgroundColor: bookHex(workTitle),
          backgroundImage: SOLID_SHEEN,
        }}
      />
    );
  const photoWidth = Math.round(height * PHOTO_RATIO);
  return (
    <img
      src={assets.photos[bg]}
      width={photoWidth}
      height={height}
      style={{ position: "absolute", top: 0, left: Math.round((width - photoWidth) / 2) }}
      alt=""
    />
  );
}

function QuoteMark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <path
        fill={color}
        d="M116,72v88a48.05,48.05,0,0,1-48,48,8,8,0,0,1,0-16,32,32,0,0,0,32-32v-8H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56h60A16,16,0,0,1,116,72ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Z"
      />
    </svg>
  );
}

/** 훈독 표시: 금색 책갈피 + "훈독" */
function Mark({ size, color }: { size: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: size, color, letterSpacing: 2 }}>
      <svg
        width={size * 0.9}
        height={size * 0.9}
        viewBox="0 0 256 256"
        style={{ marginRight: size * 0.3 }}
        aria-hidden="true"
      >
        <path
          fill={P.gold2}
          d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z"
        />
      </svg>
      훈독
    </div>
  );
}

function FeedImage({ card, look, assets }: { card: CardPublic; look: PhotoLook; assets: ImageAssets }) {
  const { width, height } = IMAGE_SIZE.feed;
  const isSolid = look.bg === "book";
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        position: "relative",
        background: P.espresso,
        fontFamily: "Pretendard",
        color: "#ffffff",
      }}
    >
      <Backdrop bg={look.bg} workTitle={card.work_title} assets={assets} width={width} height={height} />
      {!isSolid && (
        <div
          style={{ position: "absolute", left: 0, top: 0, width, height, display: "flex", backgroundImage: SHADE }}
        />
      )}
      <div style={{ position: "absolute", left: 86, top: 76, display: "flex" }}>
        <QuoteMark size={96} color="rgba(255,255,255,0.85)" />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          padding: "0 86px 70px",
        }}
      >
        <div
          style={{
            fontSize: imageQuoteSize(card.text, "feed"),
            lineHeight: 1.55,
            letterSpacing: -0.5,
            wordBreak: "keep-all",
            textShadow: "0 2px 24px rgba(0,0,0,0.3)",
          }}
        >
          {card.text}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            marginTop: 60,
            paddingTop: 40,
            borderTop: "2px solid rgba(255,255,255,0.24)",
          }}
        >
          <div
            style={{ display: "flex", maxWidth: 680, fontSize: 36, lineHeight: 1.45, color: "rgba(255,255,255,0.86)" }}
          >
            {sourceText(card, look.src)}
          </div>
          <Mark size={40} color="#ffffff" />
        </div>
      </div>
    </div>
  );
}

function StoryImage({ card, look, assets }: { card: CardPublic; look: PhotoLook; assets: ImageAssets }) {
  const { width, height } = IMAGE_SIZE.story;
  const isSolid = look.bg === "book";
  return (
    <div
      style={{ width, height, display: "flex", position: "relative", background: P.espresso, fontFamily: "Pretendard" }}
    >
      <Backdrop bg={look.bg} workTitle={card.work_title} assets={assets} width={width} height={height} />
      {!isSolid && (
        <div style={{ position: "absolute", left: 0, top: 0, width, height, display: "flex", backgroundImage: DIM }} />
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height: height - 120,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 97px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "97px 86px 86px",
            borderRadius: 76,
            background: isSolid ? "rgba(255,255,255,0.1)" : "rgba(251,248,242,0.9)",
            border: isSolid ? "2px solid rgba(255,255,255,0.2)" : "0",
            color: isSolid ? "#ffffff" : P.ink,
          }}
        >
          <QuoteMark size={96} color={P.gold} />
          <div
            style={{
              marginTop: 40,
              fontSize: imageQuoteSize(card.text, "story"),
              lineHeight: 1.6,
              letterSpacing: -0.5,
              wordBreak: "keep-all",
            }}
          >
            {card.text}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 54,
              fontSize: 38,
              lineHeight: 1.45,
              color: isSolid ? "rgba(255,255,255,0.78)" : P.ink3,
            }}
          >
            {sourceText(card, look.src)}
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 86,
          display: "flex",
          justifyContent: "center",
          textShadow: "0 2px 16px rgba(0,0,0,0.45)",
        }}
      >
        <Mark size={44} color="#ffffff" />
      </div>
    </div>
  );
}

type PhotoLook = { bg: CardBackground; src: SourceMode };

export function cardImageElement(card: CardPublic, query: ImageQuery, assets: ImageAssets): ReactElement {
  switch (query.format) {
    case "link":
      return <LinkImage card={card} assets={assets} />;
    case "square":
      return <CardImage card={card} assets={assets} />;
    case "feed":
      return <FeedImage card={card} look={query} assets={assets} />;
    case "story":
      return <StoryImage card={card} look={query} assets={assets} />;
  }
}

// ---------- 이번 달 모은 말씀 (콜라주) ----------

/** 칸 크기·본문 길이 → 글자 크기. 원문은 줄이지 않으므로 칸에 들어가도록 글자를 줄인다(22~52px). */
export function collageQuoteSize(text: string, box: { width: number; height: number }): number {
  const length = Math.max(1, Array.from(text).length);
  // 한글은 거의 1em 폭. 칸 넓이의 약 55%를 글자가 쓰고 줄 높이는 1.5em 이라 본다
  const size = Math.floor(Math.sqrt((box.width * box.height * 0.55) / (length * 1.5)));
  return Math.max(22, Math.min(52, size));
}

/** 칸 배치: 피드는 2열(3장이면 첫 장이 한 줄), 스토리는 한 줄에 한 장 */
export function collageRows(count: number, format: PhotoFormat): number[] {
  if (format === "story" || count <= 1) return Array.from({ length: count }, () => 1);
  if (count === 3) return [1, 2];
  return count === 2 ? [2] : [2, 2];
}

export function collageImageElement({
  cards,
  theme,
  format,
  month,
  assets,
}: {
  cards: CardPublic[];
  theme: CollageTheme;
  format: PhotoFormat;
  /** KST 달(1~12) */
  month: number;
  assets: ImageAssets;
}): ReactElement {
  const { width, height } = IMAGE_SIZE[format];
  const isNight = theme === "night";
  const padX = 64;
  const gap = 28;
  const headHeight = 150;
  const footHeight = 110;
  const top = format === "story" ? 120 : 76;
  const rows = collageRows(cards.length, format);
  const gridHeight = height - top - headHeight - footHeight - 40;
  const rowHeight = (gridHeight - gap * (rows.length - 1)) / rows.length;
  let index = 0;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        padding: `${top}px ${padX}px 40px`,
        backgroundColor: isNight ? P.espresso : P.cream,
        ...(isNight && {
          backgroundImage: "radial-gradient(90% 50% at 90% 0%, rgba(194,154,91,0.28), rgba(194,154,91,0) 60%)",
        }),
        color: isNight ? P.paper : P.ink,
        fontFamily: "Pretendard",
      }}
    >
      <div style={{ height: headHeight, display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 76, letterSpacing: -1.5 }}>{`${month}월에 모은 말씀`}</div>
        <div style={{ fontSize: 42, marginLeft: 26, color: isNight ? P.gold2 : P.ink3 }}>{`${cards.length}장`}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", height: gridHeight }}>
        {rows.map((columns, rowIndex) => {
          const rowCards = cards.slice(index, index + columns);
          const startIndex = index;
          index += columns;
          const tileWidth = (width - padX * 2 - gap * (columns - 1)) / columns;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: 줄 순서가 곧 정체다
              key={rowIndex}
              style={{ display: "flex", height: rowHeight, marginTop: rowIndex === 0 ? 0 : gap }}
            >
              {rowCards.map((card, column) => {
                const photo = COLLAGE_PHOTOS[(startIndex + column) % COLLAGE_PHOTOS.length];
                const photoWidth = Math.max(tileWidth, Math.round(rowHeight * PHOTO_RATIO));
                const box = { width: tileWidth - 72, height: rowHeight - 140 };
                return (
                  <div
                    key={card.id}
                    style={{
                      position: "relative",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      width: tileWidth,
                      height: rowHeight,
                      marginLeft: column === 0 ? 0 : gap,
                      padding: 36,
                      borderRadius: 40,
                      overflow: "hidden",
                      color: "#ffffff",
                    }}
                  >
                    <img
                      src={assets.photos[photo]}
                      width={photoWidth}
                      height={Math.round(photoWidth / PHOTO_RATIO)}
                      style={{ position: "absolute", top: 0, left: Math.round((tileWidth - photoWidth) / 2) }}
                      alt=""
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: tileWidth,
                        height: rowHeight,
                        display: "flex",
                        backgroundImage:
                          "linear-gradient(0deg, rgba(14,10,7,0.88) 0%, rgba(14,10,7,0.5) 60%, rgba(14,10,7,0.2) 100%)",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        fontSize: collageQuoteSize(card.text, box),
                        lineHeight: 1.5,
                        wordBreak: "keep-all",
                      }}
                    >
                      {card.text}
                    </div>
                    <div style={{ display: "flex", marginTop: 16, fontSize: 30, color: P.gold2 }}>{bookName(card)}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: footHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 34,
          color: isNight ? "rgba(251,248,242,0.66)" : P.ink3,
        }}
      >
        <div style={{ display: "flex" }}>나의 책갈피에서</div>
        <Mark size={38} color={isNight ? P.paper : P.ink} />
      </div>
    </div>
  );
}
