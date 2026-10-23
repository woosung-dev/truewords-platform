"use client";

// /hoondok/pray — 마음 한 장 (기본값 9). ① 마음 고르기 ② 맞춘 말씀 ③ 한 줄 적기(기기에만) ④ 건네기.
// 건네기는 기존 책갈피 공유 시트로 말씀 카드만 보낸다. 한 줄은 서버·모임으로 보내지 않는다(모임 게시는 후속 결정).
// 이 화면에서 고른 마음은 저장된 답(질문 흐름·관심사 바꾸기)을 바꾸지 않는다. 그 순간의 마음이라 카드 고르기에만 쓴다.
// "많이 힘들어요"를 고르면 말씀보다 위기 안내가 먼저다(맞춘 말씀 화면 맨 위).
import { Check, Info, Lock } from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CardPublic } from "../../cards/api";
import { type ShareOutcome, ShareSheet } from "../../cards/components/share-sheet";
import { useKstDate } from "../../use-kst-date";
import { CRISIS_MOOD_ID, MOOD_OPTIONS } from "../options";
import { FALLBACK_REASON } from "../pick";
import { NOTE_MAX_LENGTH } from "../storage";
import { usePersonalCard, usePersonalNote } from "../use-personal";
import { CrisisNotice } from "./crisis-notice";
import { FirstWordBody, FirstWordReason } from "./first-word";

type Step = "mood" | "card" | "note" | "share" | "done";

const STEP_LABEL: Record<Exclude<Step, "done">, string> = {
  mood: "1 / 4 · 마음",
  card: "2 / 4 · 말씀",
  note: "3 / 4 · 한 줄",
  share: "4 / 4 · 건네기",
};

const SHARE_STATUS: Partial<Record<ShareOutcome, string>> = {
  clipboard: "말씀과 출처·링크를 복사했어요. 대화방에 붙여 넣어 주세요",
  copied: "말씀과 출처·링크를 글로 복사했어요",
  "copy-failed": "복사하지 못했어요. 시트에 보이는 링크를 직접 보내 주세요",
};

function StepHead({
  step,
  title,
  lede,
  titleRef,
}: {
  step: Exclude<Step, "done">;
  title: string;
  lede?: string;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="ps-head">
      <p className="ps-head__step">{STEP_LABEL[step]}</p>
      <h2 className="ps-head__t" ref={titleRef} tabIndex={-1}>
        {title}
      </h2>
      {lede && <p className="ps-head__lede">{lede}</p>}
    </div>
  );
}

/** 하단 행동 막대. 보조 행동(글자 버튼)이 있으면 split — 보조는 왼쪽, 주 버튼은 오른쪽 */
function Bar({ children, isSplit = true }: { children: React.ReactNode; isSplit?: boolean }) {
  return <div className={isSplit ? "ps-bar ps-bar--split" : "ps-bar"}>{children}</div>;
}

// 마음 한 장의 0점 폴백 까닭. 질문 흐름(FALLBACK_REASON)과 같은 문장에서 "주제"만 "마음"으로 바꾼다
const PRAY_FALLBACK_REASON = FALLBACK_REASON.replace("고르신 주제에", "고르신 마음에");

function CardStep({
  mood,
  onCard,
  titleRef,
}: {
  mood: string;
  onCard: (card: CardPublic | null) => void;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const isCrisis = mood === CRISIS_MOOD_ID;
  const input = useMemo(() => ({ interests: [], moods: isCrisis ? [] : [mood], isCrisis }), [mood, isCrisis]);
  const state = usePersonalCard(input);
  const card = state.status === "ready" ? state.card : null;
  useEffect(() => onCard(card), [card, onCard]);
  const isFallback = state.status === "ready" && state.isFallback;
  // 겹치는 장이 없어 오늘 편성 카드로 돌아갔으면 "맞춘" 말씀이라고 부르지 않는다(질문 흐름 ResultStep 과 같은 규칙)
  const title = isFallback ? "오늘 말씀부터 드릴게요" : "지금 마음에 맞춘 말씀이에요";
  // 위기 안내는 까닭·말씀보다 먼저 둔다
  return (
    <>
      <StepHead step="card" title={title} titleRef={titleRef} />
      {isCrisis && <CrisisNotice id="ps-card-crisis" />}
      {state.status === "ready" && !state.isFallback && <FirstWordReason state={state} />}
      {state.status === "ready" && state.isFallback && state.card && (
        <p className="onb-why onb-result__why">
          <Info size={20} aria-hidden="true" />
          <span>{PRAY_FALLBACK_REASON}</span>
        </p>
      )}
      <FirstWordBody state={state} isCrisis={false} />
    </>
  );
}

/** 마음 9개 라디오 칩. Tab 은 고른 칩(없으면 첫 칩)에만 멈추고 화살표로 옮기며 고른다(APG radio group, 질문 3 ChoiceRadioGroup 과 같다). */
function MoodRadios({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const current = MOOD_OPTIONS.findIndex((o) => o.id === value);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = current < 0 ? 0 : (current + step + MOOD_OPTIONS.length) % MOOD_OPTIONS.length;
    onChange(MOOD_OPTIONS[next].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  }
  return (
    <div className="chips" role="radiogroup" aria-label="지금 마음" ref={ref} onKeyDown={handleKeyDown}>
      {MOOD_OPTIONS.map((o, index) => {
        const isOn = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={isOn}
            tabIndex={index === Math.max(current, 0) ? 0 : -1}
            className="chip-btn ps-chip"
            onClick={() => onChange(o.id)}
          >
            {isOn && <Check size={18} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PrayScreen() {
  const today = useKstDate();
  const [step, setStep] = useState<Step>("mood");
  const [mood, setMood] = useState<string | null>(null);
  const [card, setCard] = useState<CardPublic | null>(null);
  const [text, setText] = useState("");
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const { save: saveNote } = usePersonalNote();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hasMoved = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 단계가 바뀔 때마다 새 제목으로 옮긴다
  useEffect(() => {
    if (!hasMoved.current) return;
    // 단계 전환은 애니메이션 없이 바꾸고 새 제목으로 포커스를 옮긴다
    window.scrollTo(0, 0);
    titleRef.current?.focus();
  }, [step]);

  function go(next: Step) {
    hasMoved.current = true;
    setStatus(null);
    setStep(next);
  }

  function saveAndGo(next: Step) {
    saveNote({ date: today, cardId: card?.id ?? null, text });
    go(next);
  }

  function handleShareDone(outcome: ShareOutcome) {
    if (outcome === "file" || outcome === "link") {
      setIsSheetOpen(false);
      go("done");
      return;
    }
    setStatus(SHARE_STATUS[outcome] ?? null);
  }

  const hasNote = text.trim().length > 0;

  if (step === "mood")
    return (
      <section className="col ps-form">
        <StepHead
          step="mood"
          title="지금 마음은 어떠세요?"
          lede="기도 뒤나 하루를 마칠 때 한 장 받아 보세요. 마음 하나를 고르면 그에 맞는 말씀을 드려요."
          titleRef={titleRef}
        />
        <MoodRadios value={mood} onChange={setMood} />
        {mood === CRISIS_MOOD_ID && <CrisisNotice id="ps-mood-crisis" />}
        <Bar isSplit={false}>
          <p className="ps-bar__t">고른 마음은 이 기기에만 남아요</p>
          <button type="button" className="btn btn-primary" disabled={!mood} onClick={() => go("card")}>
            말씀 받기
          </button>
        </Bar>
      </section>
    );

  if (step === "card" && mood)
    return (
      <section className="col ps-form">
        <CardStep mood={mood} onCard={setCard} titleRef={titleRef} />
        <Bar>
          <Link className="btn btn-ghost" href="/hoondok">
            여기서 마치기
          </Link>
          <button type="button" className="btn btn-primary" disabled={!card} onClick={() => go("note")}>
            한 줄 적기
          </button>
        </Bar>
      </section>
    );

  if (step === "note")
    return (
      <section className="col ps-form">
        <StepHead step="note" title="말씀을 읽고 떠오른 한 줄을 적어 보세요" titleRef={titleRef} />
        <div className="ps-memo">
          <div className="ps-memo__h">
            <label htmlFor="ps-note">내 메모</label>
            <span className="badge">나만 봄</span>
          </div>
          <textarea
            id="ps-note"
            className="my-note"
            rows={4}
            maxLength={NOTE_MAX_LENGTH}
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-describedby="ps-note-count ps-note-store"
          />
          <p className="ps-memo__count" id="ps-note-count">
            {text.length} / {NOTE_MAX_LENGTH}
          </p>
        </div>
        <p className="onb-why onb-why--store" id="ps-note-store">
          <Lock size={20} aria-hidden="true" />
          <span>적은 한 줄은 이 기기에만 남아요</span>
        </p>
        <Bar>
          <button type="button" className="btn btn-ghost" onClick={() => go("share")}>
            적지 않고 넘어가기
          </button>
          <button type="button" className="btn btn-primary" disabled={!hasNote} onClick={() => saveAndGo("share")}>
            다음
          </button>
        </Bar>
      </section>
    );

  if (step === "share" && card)
    return (
      <section className="col ps-form">
        <StepHead
          step="share"
          title="이 말씀을 건넬까요?"
          lede="말씀 카드만 건네요. 적은 한 줄은 이 기기에 남아요."
          titleRef={titleRef}
        />
        <article className="card malssum onb-word" aria-label={`${card.source_label} 단락`}>
          <div className="src-line">
            <div className="src">{card.source_label}</div>
          </div>
          <p className="scripture">{card.text}</p>
        </article>
        <p className="ps-bar__t ps-status" role="status" aria-live="polite">
          {status}
        </p>
        <Bar>
          <button type="button" className="btn btn-ghost" onClick={() => go("done")}>
            건네지 않고 마치기
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setIsSheetOpen(true)}>
            건네기
          </button>
        </Bar>
        {isSheetOpen && <ShareSheet card={card} onClose={() => setIsSheetOpen(false)} onDone={handleShareDone} />}
      </section>
    );

  // 마침 (또는 카드 없이 들어온 단계는 처음으로)
  if (step !== "done") {
    return (
      <section className="col ps-form">
        <button type="button" className="btn btn-line" onClick={() => go("mood")}>
          처음부터 다시
        </button>
      </section>
    );
  }
  return (
    <section className="col ps-form ps-done">
      <h2 className="ps-head__t" ref={titleRef} tabIndex={-1}>
        오늘 마음 한 장을 마쳤어요
      </h2>
      <p className="ps-head__lede">
        {hasNote ? "적은 한 줄은 이 기기에만 남았어요." : "말씀은 원문에서 언제든 다시 읽을 수 있어요."}
      </p>
      <Link className="btn btn-primary" href="/hoondok">
        오늘 훈독으로
      </Link>
    </section>
  );
}
