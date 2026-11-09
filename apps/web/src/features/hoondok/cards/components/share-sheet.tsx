"use client";

// SCR-PWA-024 사진 카드로 건네기 (시안 p4 스튜디오). 미리보기는 서버가 그린 이미지 그대로다(보내는 것 = 보이는 것).
// 고르기: 크기(4:5 카톡·피드 / 9:16 스토리) · 바탕(사진 4장 + 책 색) · 출처 표시(자세히 / 책 이름만). 출처와 훈독 표시는 늘 인쇄한다.
// 갈래: 카카오톡·다른 앱(Web Share, 파일 → 링크 → 클립보드 → 직접 표시) · 사진 저장 · 글로 복사. 인사 한 줄은 없다(결정 1).
// 고른 모양은 건넬 때 이 기기에 카드별로 남겨 내 카드 갤러리의 "그대로 다시 건네기" 가 같은 모양으로 연다.
import { Copy, Download, Loader2, Lock, MessageCircle } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import type { CardPublic } from "../api";
import {
  BACKGROUND_LABEL,
  bookColorIndex,
  CARD_BACKGROUNDS,
  type CardLook,
  defaultLook,
  FORMAT_OPTIONS,
  type PhotoFormat,
  photoSrc,
  type SourceMode,
} from "../look";
import { type CardShareResult, cardLink, copyCardText, photoCardImagePath, photoFileName, shareCard } from "../share";
import { readCardLook, writeCardLook } from "../storage";
import { ChoiceGroup } from "./choice-group";

export type PreparedImage = {
  /** 받아 둔 이미지 파일. 준비 중이거나 실패면 null */
  file: File | null;
  status: "loading" | "ready" | "error";
  retry: () => void;
};

/**
 * 공유 시트가 파일을 바로 받을 수 있도록 지금 고른 이미지를 미리 받아 둔다. 누른 뒤에 받으면
 * iOS 의 사용자 동작 유효 시간이 지나 공유 시트가 열리지 않으므로, 준비가 끝날 때까지 보내기 버튼을 막는다.
 * 고르기를 바꾸면 새로 받는다.
 */
export function usePreparedImage(url: string, name: string): PreparedImage {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; file: File | null } | null>(null);
  const key = `${url}#${name}#${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`image ${response.status}`))))
      .then((blob) => setResult({ key, file: new File([blob], name, { type: blob.type || "image/png" }) }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, file: null });
      });
    return () => controller.abort();
  }, [key, url, name]);
  const current = result?.key === key ? result : null;
  return {
    file: current?.file ?? null,
    status: current === null ? "loading" : current.file ? "ready" : "error",
    retry: () => setAttempt((value) => value + 1),
  };
}

/** 보내기 버튼. 이미지가 준비될 때까지 "사진 준비 중" 으로 막고, 실패하면 다시 받기를 보인다 */
export function PreparedShareButton({ prepared, onShare }: { prepared: PreparedImage; onShare: () => void }) {
  return (
    <>
      {prepared.status === "error" && (
        <div className="pcs-prep-err" role="status">
          <p>사진을 준비하지 못했어요</p>
          <button className="btn btn-line btn--sm" type="button" onClick={prepared.retry}>
            다시 준비하기
          </button>
        </div>
      )}
      <button
        className="pc-cta"
        type="button"
        disabled={prepared.status !== "ready"}
        aria-busy={prepared.status === "loading"}
        onClick={onShare}
      >
        {prepared.status === "loading" ? "사진 준비 중" : "카카오톡·다른 앱으로 건네기"}
        <span className="pc-cta__ic" aria-hidden="true">
          {prepared.status === "loading" ? <Loader2 size={22} className="pc-cta__spin" /> : <MessageCircle size={22} />}
        </span>
      </button>
    </>
  );
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

const TOAST: Partial<Record<ShareOutcome, string>> = {
  file: "책갈피를 건넸어요",
  link: "책갈피를 건넸어요",
  clipboard: "말씀과 출처·링크를 복사했어요. 대화방에 붙여 넣어 주세요",
  copied: "말씀과 출처·링크를 글로 복사했어요",
};

/** 건넨 셈인 결과(건넴 표시 050 대상) */
export function isGivenOutcome(outcome: ShareOutcome): boolean {
  return outcome === "file" || outcome === "link" || outcome === "clipboard" || outcome === "copied";
}

/** 결과 토스트 문구. 로그인 사용자가 보내면(복사 제외) 나의 책갈피에 남았다고 덧붙인다 */
export function shareToastMessage(outcome: ShareOutcome, isRecorded: boolean): string | null {
  const message = TOAST[outcome];
  if (!message) return null;
  return isRecorded && isGivenOutcome(outcome) && outcome !== "copied"
    ? `${message} · 나의 책갈피에 남았어요`
    : message;
}

/** 토스트 한 줄. 시트(모달)가 열려 있으면 시트 안에 그려야 보인다 — ShareSheet 의 toast 로 넘긴다 */
export function ShareToast({ message }: { message: string | null }) {
  return (
    <p className="bmk-toast" role="status" aria-live="polite" data-on={message ? "1" : undefined}>
      {message}
    </p>
  );
}

const SOURCE_OPTIONS: readonly { value: SourceMode; label: string }[] = [
  { value: "full", label: "자세히" },
  { value: "book", label: "책 이름만" },
];

export function ShareSheet({
  card,
  onClose,
  onDone,
  toast,
}: {
  card: CardPublic;
  onClose: () => void;
  /** 결과마다 한 번. 건넴 표시(050)·토스트는 부르는 쪽이 정한다 */
  onDone: (outcome: ShareOutcome) => void;
  /** 시트 안에 그릴 토스트(ShareToast) */
  toast?: ReactNode;
}) {
  // 처음 열 때 이 카드에 마지막으로 고른 모양(없으면 카드별 기본 사진·4:5·자세히)
  const [look, setLook] = useState<CardLook>(() => readCardLook(card.id) ?? defaultLook(card.id));
  const imageUrl = photoCardImagePath(card.id, look);
  const fileName = photoFileName(look.format);
  const prepared = usePreparedImage(imageUrl, fileName);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);
  const book = bookColorIndex(card.work_title);

  function change(next: Partial<CardLook>) {
    setLook((previous) => ({ ...previous, ...next }));
  }
  async function handleShare() {
    const link = cardLink(card.id);
    const result = await shareCard({ card, link, file: prepared.file });
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
    <ReaderSheet title="사진 카드로 건네기" onClose={onClose} toast={toast}>
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
          <PreparedShareButton prepared={prepared} onShare={() => void handleShare()} />
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
