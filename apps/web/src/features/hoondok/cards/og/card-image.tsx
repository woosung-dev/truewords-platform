// 책갈피 공유 이미지 (PLAN-HD-012). next/og(Satori) 로 서버에서 그린다 — flexbox·절대 위치만, CSS 변수·grid 없음.
// 색은 hoondok.css 토큰과 같은 값을 여기에 한 번 더 적는다(Satori 는 CSS 변수를 읽지 못한다). 출처와 "훈독" 은 모든 형식에 늘 인쇄한다.
import type { ReactElement } from "react";
import type { CardPublic } from "../api";

export type ImageFormat = "link" | "square" | "story";

export const IMAGE_SIZE: Record<ImageFormat, { width: number; height: number }> = {
  link: { width: 800, height: 400 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
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

export type ImageAssets = { leaves: string; twig: string; cup: string };

/** 본문 길이 → 글자 크기(px). 원문은 줄이지 않고 글자만 작게 한다. */
export function imageQuoteSize(text: string, format: "square" | "story"): number {
  const length = Array.from(text).length;
  const steps = format === "story" ? [76, 66, 56, 48, 40] : [62, 54, 46, 38, 32];
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
        style={{ position: "absolute", left: 0, top: 0, opacity: 0.8 }}
        alt=""
      />
      <img src={assets.cup} width={300} height={212} style={{ position: "absolute", right: 24, bottom: 0 }} alt="" />
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

/** 1:1 · 9:16 저장용 카드 (시안 `.bm--sq` 와 세로 카드). 위 잎 그림자·리본 → 말씀 → 잔가지·컵 → 출처·훈독 띠. */
function CardImage({ card, assets, format }: { card: CardPublic; assets: ImageAssets; format: "square" | "story" }) {
  const { width, height } = IMAGE_SIZE[format];
  const isStory = format === "story";
  const pad = isStory ? 110 : 130;
  const quote = imageQuoteSize(card.text, format);
  const sceneHeight = isStory ? 400 : 240;
  const footHeight = isStory ? 110 : 84;
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
        width={isStory ? 560 : 500}
        height={isStory ? 679 : 606}
        style={{ position: "absolute", left: 0, top: 0, opacity: 0.85 }}
        alt=""
      />
      <Ribbon width={isStory ? 104 : 86} height={isStory ? 250 : 184} right={isStory ? 90 : 60} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: `${isStory ? 170 : 70}px ${pad}px 0`,
        }}
      >
        <div style={{ fontSize: isStory ? 36 : 32, color: C.ink2, letterSpacing: 1 }}>오늘의 책갈피</div>
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
          <div style={{ fontSize: isStory ? 34 : 30, color: C.ink2, marginTop: isStory ? 40 : 28 }}>
            — {card.source_label}
          </div>
        </div>
      </div>
      <div style={{ position: "relative", display: "flex", height: sceneHeight, width: "100%" }}>
        <img
          src={assets.twig}
          width={isStory ? 250 : 190}
          height={isStory ? 296 : 225}
          style={{ position: "absolute", left: isStory ? 40 : 30, bottom: sceneHeight * 0.12 }}
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
          width={isStory ? 520 : 380}
          height={isStory ? 368 : 269}
          style={{ position: "absolute", right: isStory ? 40 : 40, bottom: 0 }}
          alt=""
        />
      </div>
      <div
        style={{
          height: footHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${isStory ? 60 : 54}px`,
          background: "rgba(35,33,31,0.86)",
          color: "#ffffff",
          fontSize: isStory ? 34 : 28,
        }}
      >
        <div style={{ display: "flex", maxWidth: width - 260 }}>{card.source_label}</div>
        <div style={{ letterSpacing: 3 }}>훈독</div>
      </div>
    </div>
  );
}

export function cardImageElement(card: CardPublic, format: ImageFormat, assets: ImageAssets): ReactElement {
  return format === "link" ? (
    <LinkImage card={card} assets={assets} />
  ) : (
    <CardImage card={card} assets={assets} format={format} />
  );
}
