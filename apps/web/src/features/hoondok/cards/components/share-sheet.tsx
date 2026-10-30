"use client";

// SCR-PWA-024 건네기 시트 (PLAN-HD-012). 완성 카드(1:1 이미지 그대로)를 먼저 보이고 아래에서 고르기만 한다.
// 인사 한 줄·이름 보내기는 없다(결정 1) — 인사는 사용자가 카톡 대화방에서 직접 쓴다.
// 네 갈래: 카카오톡·다른 앱(Web Share, 파일 → 링크 → 클립보드 → 직접 표시) · 스토리 9:16 저장 · 사진 1:1 저장 · 글로 복사.
import { Copy, Download, Lock, MessageCircle, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { PREVIEW_CARDS } from "@/features/hoondok/preview/fixtures/cards";
import type { CardPublic } from "../api";
import { type CardShareResult, cardImagePath, cardLink, copyCardText, shareCard } from "../share";
import { BookmarkCard } from "./bookmark-card";

/** 공유 시트가 파일을 바로 받을 수 있도록 1:1 이미지를 미리 받아 둔다(iOS 제스처 만료 방지). 실패하면 링크만 보낸다. */
function usePreparedImage(cardId: string, enabled: boolean): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(cardImagePath(cardId, "square"), { signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (blob) setFile(new File([blob], "오늘의-책갈피.png", { type: blob.type || "image/png" }));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [cardId, enabled]);
  return enabled ? file : null;
}

export type ShareOutcome = CardShareResult | "copied" | "copy-failed";

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
  const isPreview = isHoondokPreviewEnabled() && PREVIEW_CARDS.some((item) => item.id === card.id);
  const file = usePreparedImage(card.id, !isPreview);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);

  // 예시 카드에는 공개 주소·공유 이미지가 없다. 실제 카드의 공유 동작과 섞지 않는다.
  if (isPreview) {
    return (
      <ReaderSheet title="건네기 미리보기" onClose={onClose}>
        <p className="hint">미리보기 카드예요. 사진 저장과 외부 공유는 준비 중이에요.</p>
        <div className="bmk-share">
          <BookmarkCard card={card} eyebrow="오늘의 책갈피" className="bm--full bmk-share__preview" />
          <p className="bmk-share__lock">
            <Lock size={16} aria-hidden="true" />
            출처({card.source_label})와 훈독 표시는 카드에 늘 함께 가요.
          </p>
          <div className="bmk-share__dests" aria-describedby="preview-share-notice">
            <button className="card bmk-dest" type="button" disabled>
              <span className="bmk-dest__ic bmk-dest__ic--kk" aria-hidden="true">
                <MessageCircle size={22} />
              </span>
              <span className="bmk-dest__bd">
                <b>카카오톡·다른 앱으로 보내기</b>
                <span>실제 카드에서 사용할 수 있어요</span>
              </span>
            </button>
            <button className="card bmk-dest" type="button" disabled>
              <span className="bmk-dest__ic" aria-hidden="true">
                <Smartphone size={22} />
              </span>
              <span className="bmk-dest__bd">
                <b>스토리·상태 사진 저장</b>
                <span>세로 사진(9:16)으로 저장해요</span>
              </span>
            </button>
            <div className="bmk-row2">
              <button className="btn btn-line" type="button" disabled>
                <Download size={20} aria-hidden="true" />
                사진 저장 1:1
              </button>
              <button className="btn btn-line" type="button" disabled>
                <Copy size={20} aria-hidden="true" />
                글로 복사
              </button>
            </div>
          </div>
        </div>
        <p className="notice" id="preview-share-notice">
          예시 카드는 이 화면에서만 볼 수 있어요. 아무것도 보내거나 저장하지 않아요.
        </p>
      </ReaderSheet>
    );
  }

  async function handleShare() {
    const link = cardLink(card.id);
    const result = await shareCard({ card, link, file });
    if (result === "none") setFallbackLink(link);
    onDone(result);
  }
  async function handleCopy() {
    const link = cardLink(card.id);
    const isCopied = await copyCardText(card, link);
    if (!isCopied) setFallbackLink(link);
    onDone(isCopied ? "copied" : "copy-failed");
  }

  return (
    <ReaderSheet title="건네기" onClose={onClose}>
      <div className="bmk-share">
        {/* 보내는 이미지 그대로 — 출처와 "훈독" 이 이미지에 인쇄되어 있다 */}
        <img
          className="bmk-share__pv"
          src={cardImagePath(card.id, "square")}
          width={1080}
          height={1080}
          alt={`건넬 책갈피 카드: ${card.text} — ${card.source_label}`}
        />
        <p className="bmk-share__lock">
          <Lock size={16} aria-hidden="true" />
          출처({card.source_label})와 훈독 표시는 카드에 늘 함께 가요.
        </p>
        <div className="bmk-share__dests">
          <button className="card bmk-dest" type="button" onClick={() => void handleShare()}>
            <span className="bmk-dest__ic bmk-dest__ic--kk" aria-hidden="true">
              <MessageCircle size={22} />
            </span>
            <span className="bmk-dest__bd">
              <b>카카오톡·다른 앱으로 보내기</b>
              <span>카드 사진과 링크를 함께 보내요</span>
            </span>
          </button>
          <a className="card bmk-dest" href={cardImagePath(card.id, "story")} download="오늘의-책갈피-세로.png">
            <span className="bmk-dest__ic" aria-hidden="true">
              <Smartphone size={22} />
            </span>
            <span className="bmk-dest__bd">
              <b>스토리·상태 사진 저장</b>
              <span>세로 사진(9:16)으로 저장해요</span>
            </span>
          </a>
          <div className="bmk-row2">
            <a className="btn btn-line" href={cardImagePath(card.id, "square")} download="오늘의-책갈피.png">
              <Download size={20} aria-hidden="true" />
              사진 저장 1:1
            </a>
            <button className="btn btn-line" type="button" onClick={() => void handleCopy()}>
              <Copy size={20} aria-hidden="true" />
              글로 복사
            </button>
          </div>
        </div>
        {fallbackLink && (
          <div className="bmk-share__link" role="status">
            <p>이 브라우저에서는 바로 보낼 수 없어요. 아래 주소를 길게 눌러 복사해 주세요.</p>
            <input readOnly value={fallbackLink} aria-label="책갈피 링크" onFocus={(event) => event.target.select()} />
          </div>
        )}
      </div>
    </ReaderSheet>
  );
}
