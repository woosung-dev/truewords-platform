"use client";

// SCR-PWA-024 사진 카드로 건네기 (시안 p4 스튜디오). 미리보기는 서버가 그린 이미지 그대로다(보내는 것 = 보이는 것).
// 고르기: 크기(4:5 카톡·피드 / 9:16 스토리) · 바탕(사진 4장 + 책 색) · 출처 표시(자세히 / 책 이름만). 출처와 훈독 표시는 늘 인쇄한다.
// 갈래: 카카오톡·다른 앱(Web Share, 파일 → 링크 → 클립보드 → 직접 표시) · 사진 저장 · 글로 복사. 인사 한 줄은 없다(결정 1).
// 고른 모양은 건넬 때 이 기기에 카드별로 남겨 내 카드 갤러리의 "그대로 다시 건네기" 가 같은 모양으로 연다.
import { Copy, Download, Lock, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import type { CardPublic } from "../api";
import {
  BACKGROUND_LABEL,
  bookColorIndex,
  CARD_BACKGROUNDS,
  type CardLook,
  defaultLook,
  type PhotoFormat,
  photoSrc,
  type SourceMode,
} from "../look";
import { type CardShareResult, cardLink, copyCardText, photoCardImagePath, photoFileName, shareCard } from "../share";
import { readCardLook, writeCardLook } from "../storage";
import { ChoiceGroup } from "./choice-group";

/**
 * 공유 시트가 파일을 바로 받을 수 있도록 지금 고른 이미지를 미리 받아 둔다(iOS 제스처 만료 방지).
 * 고르기를 바꾸면 새로 받고, 받기 전이거나 실패하면 null — 그때는 링크만 보낸다.
 */
export function usePreparedImage(url: string, name: string): File | null {
  const [prepared, setPrepared] = useState<{ url: string; file: File } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (blob) setPrepared({ url, file: new File([blob], name, { type: blob.type || "image/png" }) });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url, name]);
  return prepared?.url === url ? prepared.file : null;
}

/** 서버 이미지 미리보기. 불러오는 동안은 같은 비율의 자리, 실패하면 다시 시도 */
export function ImagePreview({ src, alt, format }: { src: string; alt: string; format: PhotoFormat }) {
  const [state, setState] = useState<{ src: string; status: "loading" | "ready" | "error"; attempt: number }>({
    src,
    status: "loading",
    attempt: 0,
  });
  const current = state.src === src ? state : { src, status: "loading" as const, attempt: 0 };
  return (
    <div className={`pcs-pv pcs-pv--${format}`} data-status={current.status} aria-busy={current.status === "loading"}>
      {current.status === "error" ? (
        <div className="pcs-pv__err" role="status">
          <p>미리보기를 불러오지 못했어요</p>
          <button
            className="btn btn-line btn--sm"
            type="button"
            onClick={() => setState({ src, status: "loading", attempt: current.attempt + 1 })}
          >
            다시 시도
          </button>
        </div>
      ) : (
        <img
          key={`${src}#${current.attempt}`}
          src={src}
          alt={alt}
          width={1080}
          height={format === "story" ? 1920 : 1350}
          onLoad={() => setState({ src, status: "ready", attempt: current.attempt })}
          onError={() => setState({ src, status: "error", attempt: current.attempt })}
        />
      )}
    </div>
  );
}

export type ShareOutcome = CardShareResult | "copied" | "copy-failed";

const FORMAT_OPTIONS: readonly { value: PhotoFormat; label: string }[] = [
  { value: "feed", label: "4:5 카톡·피드" },
  { value: "story", label: "9:16 스토리" },
];
const SOURCE_OPTIONS: readonly { value: SourceMode; label: string }[] = [
  { value: "full", label: "자세히" },
  { value: "book", label: "책 이름만" },
];

export function ShareSheet({
  card,
  onClose,
  onDone,
}: {
  card: CardPublic;
  onClose: () => void;
  /** 결과마다 한 번. 건넴 표시(050)·토스트는 부르는 쪽이 정한다 */
  onDone: (outcome: ShareOutcome) => void;
}) {
  // 처음 열 때 이 카드에 마지막으로 고른 모양(없으면 카드별 기본 사진·4:5·자세히)
  const [look, setLook] = useState<CardLook>(() => readCardLook(card.id) ?? defaultLook(card.id));
  const imageUrl = photoCardImagePath(card.id, look);
  const fileName = photoFileName(look.format);
  const file = usePreparedImage(imageUrl, fileName);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const book = bookColorIndex(card.work_title);

  function change(next: Partial<CardLook>) {
    setLook((previous) => ({ ...previous, ...next }));
  }
  async function handleShare() {
    const link = cardLink(card.id);
    const result = await shareCard({ card, link, file });
    if (result === "none") setFallbackLink(link);
    if (result !== "cancelled" && result !== "none") writeCardLook(card.id, look);
    onDone(result);
  }
  async function handleCopy() {
    const link = cardLink(card.id);
    const isCopied = await copyCardText(card, link);
    if (isCopied) writeCardLook(card.id, look);
    else setFallbackLink(link);
    onDone(isCopied ? "copied" : "copy-failed");
  }

  return (
    <ReaderSheet title="사진 카드로 건네기" onClose={onClose}>
      <div className="pcs">
        <ImagePreview
          src={imageUrl}
          format={look.format}
          alt={`건넬 사진 카드: ${card.text} (${look.src === "book" ? "책 이름" : card.source_label})`}
        />
        <ChoiceGroup
          label="크기"
          value={look.format}
          options={FORMAT_OPTIONS}
          onChange={(format) => change({ format })}
        />
        <ChoiceGroup
          label="바탕"
          variant="swatch"
          value={look.bg}
          onChange={(bg) => change({ bg })}
          options={CARD_BACKGROUNDS.map((bg) => ({
            value: bg,
            label: BACKGROUND_LABEL[bg],
            visual:
              bg === "book" ? (
                <i className={`pcs-swatch__i pc--book-${book}`} aria-hidden="true" />
              ) : (
                <i className="pcs-swatch__i" aria-hidden="true" style={{ backgroundImage: `url(${photoSrc(bg)})` }} />
              ),
          }))}
        />
        <ChoiceGroup label="출처 표시" value={look.src} options={SOURCE_OPTIONS} onChange={(src) => change({ src })} />
        <p className="pcs-lock">
          <Lock size={18} aria-hidden="true" />
          출처와 훈독 표시는 카드에 늘 함께 가요
        </p>
        {fallbackLink && (
          <div className="bmk-share__link" role="status">
            <p>이 브라우저에서는 바로 보낼 수 없어요. 아래 주소를 길게 눌러 복사해 주세요.</p>
            <input readOnly value={fallbackLink} aria-label="책갈피 링크" onFocus={(event) => event.target.select()} />
          </div>
        )}
        <div className="pcs-dock">
          <button className="pc-cta" type="button" onClick={() => void handleShare()}>
            카카오톡·다른 앱으로 건네기
            <span className="pc-cta__ic" aria-hidden="true">
              <MessageCircle size={22} />
            </span>
          </button>
          <div className="bmk-row2">
            <a
              className="btn btn-line"
              href={imageUrl}
              download={fileName}
              onClick={() => writeCardLook(card.id, look)}
            >
              <Download size={20} aria-hidden="true" />
              사진 저장
            </a>
            <button className="btn btn-line" type="button" onClick={() => void handleCopy()}>
              <Copy size={20} aria-hidden="true" />
              글로 복사
            </button>
          </div>
        </div>
      </div>
    </ReaderSheet>
  );
}
