"use client";

// 나의 책갈피 부채꼴 (SCR-PWA-026, 시안 p4 `.fan`). 책등을 누르면 그 책에서 받은 카드가 부채꼴로 펼쳐진다.
// 카드를 눌러(또는 방향키로) 고르고 "이 말씀 건네기" 로 사진 카드 시트를 연다. Esc·배경막·포커스 가둠은 <dialog> 가 맡는다.
// 부채꼴에는 최근 7장까지만 놓는다 — 그보다 많으면 겹쳐 읽을 수 없다. 나머지는 아래 목록에 있다.
import { Share2 } from "lucide-react";
import { type CSSProperties, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";
import type { CardPublic, CardReceiptItem } from "../api";
import { defaultBackground } from "../look";
import { readCardLook } from "../storage";
import { PhotoCard } from "./photo-card";

export const FAN_MAX = 7;

export function FanDialog({
  title,
  items,
  onShare,
  onClose,
}: {
  title: string;
  /** 그 책에서 받은 책갈피(최신순) */
  items: CardReceiptItem[];
  onShare: (card: CardPublic) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const shown = items.slice(0, FAN_MAX);
  const [selectedId, setSelectedId] = useState(shown[0]?.card.id ?? "");
  const selected = shown.find((item) => item.card.id === selectedId) ?? shown[0];

  // 열 때 누른 책등을 기억했다가 닫으면 그 자리로 포커스를 돌려준다(ReaderSheet 와 같은 규칙)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    const opener = document.activeElement;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      queueMicrotask(() => {
        if (!dialog.isConnected && opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
  }, []);

  function handleBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === dialogRef.current) onClose();
  }

  const step = shown.length > 4 ? 9 : 12;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 배경막 클릭 닫기의 키보드 대응은 <dialog> 의 Esc 와 닫기 버튼이다
    <dialog className="bks-fan" ref={dialogRef} aria-labelledby={titleId} onClose={onClose} onClick={handleBackdrop}>
      <div className="bks-fan__in">
        <p className="bks-fan__eye">{items.length}장 모았어요</p>
        <h2 className="bks-fan__title" id={titleId}>
          {title}
        </h2>
        <p className="bks-fan__hint">카드를 눌러 고르세요</p>
        <div
          className="bks-fan__stage"
          role="radiogroup"
          aria-label="건넬 카드 고르기"
          onKeyDown={handleSegmentKeyDown}
        >
          {shown.map((item, index) => {
            const isOn = item.card.id === selected?.card.id;
            const style = {
              "--r": `${(index - (shown.length - 1) / 2) * step}deg`,
              zIndex: isOn ? shown.length + 1 : index + 1,
              animationDelay: `${index * 50}ms`,
            } as CSSProperties;
            return (
              // biome-ignore lint/a11y/useSemanticElements: 카드 그림을 담은 고르기 버튼이라 input radio 로 그릴 수 없다
              <button
                key={item.card.id}
                type="button"
                role="radio"
                aria-checked={isOn}
                tabIndex={isOn ? 0 : -1}
                aria-label={item.card.text}
                className="bks-fan__card"
                style={style}
                onClick={() => setSelectedId(item.card.id)}
              >
                <PhotoCard
                  card={item.card}
                  bg={readCardLook(item.card.id)?.bg ?? defaultBackground(item.card.id)}
                  src="book"
                  isDecorative
                />
              </button>
            );
          })}
        </div>
        <p className="bks-fan__q">{selected?.card.text}</p>
        {items.length > shown.length && (
          <p className="bks-fan__more">그 밖의 {items.length - shown.length}장은 아래 목록에 있어요</p>
        )}
        <div className="bks-fan__acts">
          <button
            className="pc-cta pc-cta--gold"
            type="button"
            disabled={!selected}
            onClick={() => selected && onShare(selected.card)}
          >
            이 말씀 건네기
            <span className="pc-cta__ic" aria-hidden="true">
              <Share2 size={22} />
            </span>
          </button>
          <button className="bks-fan__close" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </dialog>
  );
}
