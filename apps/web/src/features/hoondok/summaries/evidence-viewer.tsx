"use client";

// 근거 원문 미리보기 — 요약 화면을 떠나지 않고 근거 단락을 본다.
// 넓은 화면(1024px~)은 본문 옆 비모달 패널, 좁은 화면은 하단 시트(ReaderSheet)다. 내용은 둘이 같다.
// 원문은 서버가 잘라 준다(API-HD: /hoondok/ai-summaries/{id}/evidence/{n}). 번호가 찍힌 천성경은 말씀 from–to 만(exact),
// 번호가 없는 평화경은 근거가 시작하는 원문 단락이라 "근처"라고 알린다.
import { useQuery } from "@tanstack/react-query";
import type { SummaryEvidence } from "@truewords/api-client-ts/types";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { wordsHref } from "../library/api";
import { ReaderSheet } from "../library/components/reader-sheet";
import { aiSummaryKey } from "../query-keys";
import { summariesAPI } from "./api";

/** 미리보기로 열 수 있는 근거 — 단락 위치가 연결된 것만. 나머지는 지금처럼 원문 뷰로 이동한다.
 *  index 는 요약의 근거 목록 전체에서의 순번(0부터)으로, 원문 API 경로에 쓴다. */
export type PreviewableEvidence = SummaryEvidence & { chunk_index: number; chunk_id: string; index: number };
export function previewableEvidence(evidence: SummaryEvidence[]): PreviewableEvidence[] {
  return evidence.flatMap((e, index) => (e.chunk_index != null && e.chunk_id ? [{ ...e, chunk_index: e.chunk_index, chunk_id: e.chunk_id, index }] : []));
}

export function rangeLabel(from: number, to: number) {
  return from === to ? `${from}` : `${from}–${to}`;
}

const WIDE = "(min-width: 1024px)";
/** 넓은 화면 여부. matchMedia 가 없는 환경(서버·jsdom)은 좁은 화면(시트)으로 본다. */
function subscribeWide(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** 열린 근거 번호(0부터)를 주소 `?ev=N`(1부터)과 맞춘다. 뒤로가기는 패널·시트만 닫는다.
 *  beforeChange 는 열림 상태가 바뀌기 직전(옛 화면이 그대로일 때) 불린다 — 스크롤 위치 보정용. */
export function useEvidenceParam(count: number, beforeChange: () => void = () => {}) {
  const [open, setOpen] = useState<number | null>(null);
  // 이 화면에서 pushState 로 만든 기록이 있으면 닫을 때 history.back() 으로 되돌린다(기록이 쌓이지 않게).
  const pushed = useRef(false);
  // 부모가 매 렌더 새로 만드는 콜백이라 ref 로 최신 값만 들고 있는다(popstate 구독을 다시 걸지 않게)
  const before = useRef(beforeChange);
  useEffect(() => {
    before.current = beforeChange;
  });
  useEffect(() => {
    const read = () => {
      const raw = new URLSearchParams(window.location.search).get("ev");
      const n = raw && /^\d+$/.test(raw) ? Number(raw) - 1 : -1;
      before.current();
      setOpen(n >= 0 && n < count ? n : null);
      if (!raw) pushed.current = false;
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [count]);
  const urlWith = (index: number | null) => {
    const url = new URL(window.location.href);
    if (index === null) url.searchParams.delete("ev");
    else url.searchParams.set("ev", String(index + 1));
    return `${url.pathname}${url.search}${url.hash}`;
  };
  return {
    open,
    show(index: number) {
      before.current();
      if (open === null) {
        window.history.pushState(null, "", urlWith(index));
        pushed.current = true;
      } else window.history.replaceState(null, "", urlWith(index));
      setOpen(index);
    },
    close() {
      before.current();
      setOpen(null);
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      } else window.history.replaceState(null, "", urlWith(null));
    },
  };
}

type ViewerProps = {
  summaryId: string;
  volume: string;
  unit: string;
  evidence: PreviewableEvidence[];
  index: number;
  onMove: (index: number) => void;
  onClose: () => void;
};

function EvidenceContent({ summaryId, volume, unit, evidence, index, onMove }: Omit<ViewerProps, "onClose">) {
  const item = evidence[index];
  const source = useQuery({
    queryKey: [...aiSummaryKey(summaryId), "evidence", item.index],
    queryFn: ({ signal }) => summariesAPI.evidence(summaryId, item.index, signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
  return <>
    <p className="sum-ev__claim">{item.claim}</p>
    {source.data && !source.data.exact && <p className="sum-ev__note">{unit} {item.from} 근처 원문이에요. 정확한 범위는 원문에서 확인해 주세요.</p>}
    <div className="sum-ev__text" aria-busy={source.isPending}>
      {source.isError ? <p className="sum-ev__err" role="status">원문을 불러오지 못했어요. 원문 뷰에서 확인해 주세요.</p>
        : source.data?.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {source.isPending && <span className="sum-ev__skel" aria-label="원문을 불러오고 있어요"><i /><i /><i /></span>}
    </div>
    <Link className="sum-ev__open" href={wordsHref(volume, item.chunk_id)}>원문에서 앞뒤 읽기 <ChevronRight size={16} aria-hidden="true" /></Link>
    {evidence.length > 1 && <nav className="sum-ev__nav" aria-label="근거 넘기기">
      <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0}><ChevronLeft size={18} aria-hidden="true" />이전 근거</button>
      <span>{index + 1} / {evidence.length}</span>
      <button type="button" onClick={() => onMove(index + 1)} disabled={index === evidence.length - 1}>다음 근거<ChevronRight size={18} aria-hidden="true" /></button>
    </nav>}
  </>;
}

/** 넓은 화면 — 배경을 막지 않는 옆 패널. Esc 로 닫고 ←/→ 로 근거를 넘긴다. */
function EvidencePanel(props: ViewerProps) {
  const { unit, evidence, index, onMove, onClose } = props;
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const item = evidence[index];
  // 닫히면 패널을 연 링크로 포커스를 돌려준다(시트는 ReaderSheet 가 같은 일을 한다)
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  // 열거나 다른 근거로 바꾸면 제목으로 포커스를 옮겨 화면 낭독기가 새 내용을 읽게 한다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 근거가 바뀔 때마다 옮긴다
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [index]);
  // 비모달이라 포커스가 본문에 있어도 Esc 로 닫는다(열린 시트·대화상자가 있으면 그쪽이 먼저 받는다)
  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) onClose();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [onClose]);
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // 버튼·링크 위에서만 방향키를 쓴다 — 본문 글자 선택 중의 방향키는 브라우저에 맡긴다
    if (event.target instanceof HTMLButtonElement || event.target === titleRef.current) {
      if (event.key === "ArrowLeft" && index > 0) onMove(index - 1);
      if (event.key === "ArrowRight" && index < evidence.length - 1) onMove(index + 1);
    }
  }
  return <aside className="sum-ev sum-ev--panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
    <header className="sum-ev__head">
      <h2 id={titleId} ref={titleRef} tabIndex={-1}>{unit} {rangeLabel(item.from, item.to)}</h2>
      <button type="button" className="sum-ev__close" onClick={onClose} aria-label="원문 미리보기 닫기"><X size={20} aria-hidden="true" /></button>
    </header>
    <EvidenceContent key={props.index} {...props} />
  </aside>;
}

/** 좁은 화면 — 하단 시트. 배경막·Esc·포커스 가둠·닫힌 뒤 포커스 복귀는 ReaderSheet(<dialog>)가 맡는다. */
function EvidenceSheet(props: ViewerProps) {
  const item = props.evidence[props.index];
  return <ReaderSheet title={`${props.unit} ${rangeLabel(item.from, item.to)}`} onClose={props.onClose}>
    <div className="sum-ev sum-ev--sheet"><EvidenceContent key={props.index} {...props} /></div>
  </ReaderSheet>;
}

export function EvidenceViewer(props: ViewerProps & { wide: boolean }) {
  const { wide, ...rest } = props;
  return wide ? <EvidencePanel {...rest} /> : <EvidenceSheet {...rest} />;
}
