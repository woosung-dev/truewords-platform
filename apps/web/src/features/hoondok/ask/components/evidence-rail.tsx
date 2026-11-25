"use client";

// 근거 말씀 목록(인용 레일)과 전문 시트 — 질문 상세·공개 질문이 같이 쓴다.
// 카드 테두리 대신 핵심 근거(.ask-key)처럼 왼쪽 선 하나로 인용을 묶고, 출처 줄이 말씀보다 먼저 온다 (REQ-PWA-012).
// 말씀을 누르거나 답 끝 근거 번호를 누르면 화면을 떠나지 않고 전문 시트가 올라온다 — 말씀 리더 AI 요약의 근거 미리보기와
// 같은 경험이다. 근거 글은 답과 함께 이미 받았으므로 시트는 따로 불러오지 않는다. 열림 상태는 지역 상태다.
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";

export type RailItem = {
  key: string;
  /** 저작물 이름(천성경 등). */
  label: string;
  text: string;
  /** 출처 둘째 줄 — 결측 항목 모음. 없으면 그리지 않는다. */
  meta?: string;
  /** 원문으로 갈 수 있으면 주소. 권리 확인 전·불가면 없다. */
  href?: string;
  /** href 가 없을 때 링크 자리에 둘 안내. */
  notice?: string;
};

/** 열린 근거 번호(0부터)를 들고 있다. 근거 번호(<sup>)와 목록이 같은 시트를 연다. */
export function useEvidenceSheet() {
  const [open, setOpen] = useState<number | null>(null);
  return { open, show: setOpen, close: () => setOpen(null) };
}

export function EvidenceRail({ items, onOpen }: { items: RailItem[]; onOpen: (index: number) => void }) {
  return (
    <ol className="ask-evl">
      {items.map((item, index) => (
        <li className="ask-ev" key={item.key}>
          <p className="ask-ev__src">
            <b className="ask-ev__no" aria-hidden="true">
              {index + 1}
            </b>
            <span className="ask-ev__work">{item.label}</span>
          </p>
          {item.meta && <p className="ask-ev__meta">{item.meta}</p>}
          <button
            type="button"
            className="ask-ev__quote"
            onClick={() => onOpen(index)}
            aria-label={`근거 ${index + 1} ${item.label} 말씀 전문 보기`}
          >
            <span className="scripture ask-ev__t">{item.text}</span>
          </button>
          {item.href ? (
            <Link className="ask-ev__go" href={item.href}>
              원문 보기
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          ) : (
            item.notice && <p className="ask-ev__notice">{item.notice}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** 답 끝 근거 번호. 숫자가 의미를 담으므로 색만으로 구분하지 않는다 (DES §2.2). */
export function EvidenceRefs({ items, onOpen }: { items: RailItem[]; onOpen: (index: number) => void }) {
  if (items.length === 0) return null;
  return (
    <p className="ask-refs">
      <span className="ask-refs__k">근거</span>
      {items.map((item, index) => (
        <button
          type="button"
          className="ask-ref"
          key={item.key}
          onClick={() => onOpen(index)}
          aria-label={`근거 ${index + 1} ${item.label} 말씀 보기`}
        >
          {index + 1}
        </button>
      ))}
    </p>
  );
}

export function EvidenceSheet({
  items,
  index,
  onMove,
  onClose,
}: {
  items: RailItem[];
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
}): ReactNode {
  const item = items[index];
  if (!item) return null;
  return (
    <ReaderSheet title={`근거 ${index + 1} · ${item.label}`} onClose={onClose}>
      <div className="ask-evs">
        {item.meta && <p className="ask-ev__meta">{item.meta}</p>}
        <p className="scripture ask-evs__t">{item.text}</p>
        {item.href ? (
          <Link className="ask-ev__go" href={item.href}>
            원문에서 앞뒤 읽기
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          item.notice && <p className="ask-ev__notice">{item.notice}</p>
        )}
        {items.length > 1 && (
          <nav className="ask-evs__nav" aria-label="근거 넘기기">
            <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0}>
              <ChevronLeft size={18} aria-hidden="true" />
              이전 근거
            </button>
            <span>
              {index + 1} / {items.length}
            </span>
            <button type="button" onClick={() => onMove(index + 1)} disabled={index === items.length - 1}>
              다음 근거
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </nav>
        )}
      </div>
    </ReaderSheet>
  );
}
