"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// P1-D + ADR-46 §C.5.2 — 답변 SNS 공유용 이미지 카드 (1080×1350, Instagram story 비율)
// 옵션 B (frontend html-to-image) 캡처 대상.
// 카드 내부는 web font 와 시스템 fallback 으로만 구성하여 외부 폰트 로딩 실패 시에도
// 캡처 결과가 깨지지 않도록 설계한다.

export type ShareImageTheme = "light" | "dark";

export interface ShareImageCardProps {
  /** 답변 핵심 1문장 (≤120자, 잘리면 "..." 부착) */
  highlight: string;
  /** 인용 메타 1줄 — 예: "347권 · 2001.07.03" */
  citationMeta: string;
  /** 질문 footer — 예: "사랑이 뭐예요?" */
  question: string;
  /** short URL (UTM 제외 또는 포함) */
  shareUrl: string;
  /** light(default) / dark */
  theme?: ShareImageTheme;
  /** 캡처용 ref */
  innerRef?: React.Ref<HTMLDivElement>;
  /** 디버그/스토리북 용 className 오버라이드 */
  className?: string;
}

const MAX_HIGHLIGHT_LENGTH = 120;

export function truncateHighlight(text: string, max = MAX_HIGHLIGHT_LENGTH): string {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

const themeStyles: Record<
  ShareImageTheme,
  {
    bg: string;
    fg: string;
    fgMuted: string;
    accent: string;
    border: string;
    quoteRule: string;
  }
> = {
  light: {
    // ADR-46 토큰: --bg #FFFBEB / --fg #1C1714 / --accent #B45309
    bg: "#FFFBEB",
    fg: "#1C1714",
    fgMuted: "#6B5D4F",
    accent: "#B45309",
    border: "#D4C4A8",
    quoteRule: "#B45309",
  },
  dark: {
    bg: "#1C1714",
    fg: "#E8DFD4",
    fgMuted: "#9C8B7A",
    accent: "#F59E0B",
    border: "#3D332B",
    quoteRule: "#F59E0B",
  },
};

export function ShareImageCard({
  highlight,
  citationMeta,
  question,
  shareUrl,
  theme = "light",
  innerRef,
  className,
}: ShareImageCardProps) {
  const palette = themeStyles[theme];
  const truncated = truncateHighlight(highlight);

  return (
    <div
      ref={innerRef}
      data-testid="share-image-card"
      data-theme={theme}
      role="img"
      aria-label={`TrueWords 공유 이미지 — ${question}`}
      className={cn(
        "relative flex flex-col overflow-hidden",
        // 1080 × 1350 고정 (Instagram story). transform: scale 로 미리보기에서만 축소.
        className,
      )}
      style={{
        width: 1080,
        height: 1350,
        backgroundColor: palette.bg,
        color: palette.fg,
        // Cormorant Garamond 가 없으면 Noto Serif KR → serif 로 graceful fallback
        fontFamily:
          '"Cormorant Garamond", "Noto Serif KR", "Iropke Batang", Georgia, serif',
        padding: "112px 96px",
        boxSizing: "border-box",
      }}
    >
      {/* 상단 로고 */}
      <header
        style={{
          fontSize: 48,
          fontWeight: 600,
          letterSpacing: "-0.5px",
          color: palette.accent,
          textAlign: "center",
        }}
      >
        TrueWords AI
      </header>

      {/* 가운데 정렬 — 핵심 인용 */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 48,
          textAlign: "center",
        }}
      >
        <blockquote
          style={{
            position: "relative",
            fontSize: 56,
            lineHeight: 1.45,
            fontWeight: 500,
            letterSpacing: "-0.5px",
            color: palette.fg,
            margin: 0,
            padding: "0 24px",
            maxWidth: 880,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: -32,
              left: -8,
              fontSize: 144,
              lineHeight: 1,
              color: palette.quoteRule,
              opacity: 0.35,
              fontFamily: "Georgia, serif",
            }}
          >
            “
          </span>
          {truncated}
        </blockquote>

        <div
          style={{
            fontSize: 28,
            color: palette.fgMuted,
            fontFamily:
              '"JetBrains Mono", "D2 Coding", ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: "0.5px",
          }}
        >
          — {citationMeta}
        </div>
      </main>

      {/* 푸터 — 질문 + URL */}
      <footer
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          textAlign: "center",
          borderTop: `1px solid ${palette.border}`,
          paddingTop: 40,
          fontFamily:
            '"Noto Sans KR", "Pretendard Variable", system-ui, -apple-system, sans-serif',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 28,
            color: palette.fg,
            fontWeight: 500,
          }}
        >
          {question} <span style={{ color: palette.fgMuted }}>— TrueWords가 답해드림</span>
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 24,
            color: palette.accent,
            fontFamily:
              '"JetBrains Mono", "D2 Coding", ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: "0.3px",
          }}
        >
          {displayUrl(shareUrl)}
        </p>
      </footer>
    </div>
  );
}

/** 공유 카드에 보일 URL 표기 — 프로토콜 제거 + 길면 잘라 표시 */
function displayUrl(url: string): string {
  if (!url) return "truewords.app";
  return url.replace(/^https?:\/\//i, "").slice(0, 64);
}
