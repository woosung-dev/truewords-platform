"use client";

// 이번 달 모은 말씀 (SCR-PWA-026, 시안 p4 콜라주). 이번 달 받은 책갈피 중 4장까지 골라 한 장의 이미지로 건넨다.
// 미리보기는 서버 이미지(/c/collage/image) 그대로다. 링크 대신 이미지 파일로만 건네고(공유 시트가 파일을 못 받으면 사진 저장 안내),
// 건넴 기록(050)은 남기지 않는다 — 내 카드 갤러리는 카드 한 장 단위다. 책 이름과 훈독 표시는 늘 인쇄한다.
import { Check, Download, Lock } from "lucide-react";
import { useId, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import type { CardReceiptItem } from "../api";
import { bookColorIndex, COLLAGE_MAX, type CollageTheme, FORMAT_OPTIONS, type PhotoFormat } from "../look";
import { collageImagePath, photoFileName, shareImageFile } from "../share";
import { ChoiceGroup } from "./choice-group";
import { ImagePreview, PreparedShareButton, usePreparedImage } from "./share-sheet";

const THEME_OPTIONS: readonly { value: CollageTheme; label: string }[] = [
  { value: "paper", label: "밝은 종이" },
  { value: "night", label: "짙은 밤" },
];

export type CollageOutcome = "file" | "cancelled" | "none";

export function CollageSheet({
  items,
  month,
  onClose,
  onDone,
}: {
  /** 이번 달 받은 책갈피(최신순) */
  items: CardReceiptItem[];
  month: number;
  onClose: () => void;
  onDone: (outcome: CollageOutcome) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => items.slice(0, COLLAGE_MAX).map((item) => item.card.id));
  const [theme, setTheme] = useState<CollageTheme>("paper");
  const [format, setFormat] = useState<PhotoFormat>("feed");
  const [notice, setNotice] = useState<string | null>(null);
  const picksId = useId();
  // 칸 순서는 고른 순서가 아니라 목록 순서(최신순)다
  const ids = items.map((item) => item.card.id).filter((id) => selected.includes(id));
  const imageUrl = collageImagePath(ids, theme, format);
  const fileName = photoFileName(format, "collage");
  const prepared = usePreparedImage(imageUrl, fileName);

  function toggle(id: string) {
    if (selected.includes(id)) {
      if (selected.length === 1) return setNotice("한 장은 남겨 두어야 해요");
      setSelected(selected.filter((item) => item !== id));
    } else {
      if (selected.length >= COLLAGE_MAX) return setNotice(`${COLLAGE_MAX}장까지 담을 수 있어요`);
      setSelected([...selected, id]);
    }
    setNotice(null);
  }
  async function handleShare() {
    const result = await shareImageFile({ file: prepared.file, title: `${month}월에 모은 말씀` });
    if (result === "none") setNotice("이 브라우저에서는 바로 보낼 수 없어요. 사진 저장을 눌러 저장한 뒤 보내 주세요");
    onDone(result);
  }

  return (
    <ReaderSheet title="이번 달 모은 말씀" onClose={onClose}>
      <div className="pcs">
        <ImagePreview src={imageUrl} format={format} alt={`${month}월에 모은 말씀 ${ids.length}장을 담은 사진`} />
        <ChoiceGroup label="크기" value={format} options={FORMAT_OPTIONS} onChange={setFormat} />
        <ChoiceGroup label="바탕" value={theme} options={THEME_OPTIONS} onChange={setTheme} />
        <p className="pcs-lock">
          <Lock size={18} aria-hidden="true" />책 이름과 훈독 표시는 늘 함께 가요
        </p>
        <div className="pcs-ctl">
          <p className="pcs-ctl__lbl" id={picksId}>
            담을 말씀 고르기 ({ids.length}/{COLLAGE_MAX})
          </p>
          <ul className="pcs-picks" aria-labelledby={picksId}>
            {items.map((item) => {
              const isOn = selected.includes(item.card.id);
              return (
                <li key={item.card.id}>
                  <button
                    type="button"
                    className={`pcs-pick pc--book-${bookColorIndex(item.card.work_title)}`}
                    aria-pressed={isOn}
                    onClick={() => toggle(item.card.id)}
                  >
                    <i className="pcs-pick__chip" aria-hidden="true" />
                    <span className="pcs-pick__q">{item.card.text}</span>
                    <span className="pcs-pick__ck" aria-hidden="true">
                      <Check size={18} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="pcs-notice" role="status" aria-live="polite">
          {notice}
        </p>
        <div className="pcs-dock">
          <PreparedShareButton prepared={prepared} onShare={() => void handleShare()} />
          <a className="btn btn-line" href={imageUrl} download={fileName}>
            <Download size={20} aria-hidden="true" />
            사진 저장
          </a>
        </div>
      </div>
    </ReaderSheet>
  );
}
