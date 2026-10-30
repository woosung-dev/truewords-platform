"use client";

// 맞춤 첫 말씀 질문 흐름 (/hoondok/start): 환영 → 질문 1 관심 주제 → 질문 2 요즘 마음 → 질문 3 읽는 때(선택) → 첫 말씀.
// 단계는 이 화면의 상태이고 주소에 답을 싣지 않는다. 단계가 바뀌면 새 제목(h2)으로 포커스를 옮기고 document.title 을 고친다.
// 답은 첫 말씀으로 넘어갈 때 이 기기에만 저장한다(storage.ts). 서버·분석·오류 수집으로 보내지 않는다.
import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { HOONDOK_FAVICON_SVG } from "../../pwa";
import {
  CRISIS_MOOD_ID,
  countLimitedMoods,
  INTEREST_OPTIONS,
  interestLabel,
  MAX_MOODS,
  MOOD_OPTIONS,
  moodLabel,
  READING_LENGTH_OPTIONS,
  READING_TIME_OPTIONS,
  toggleMood,
} from "../options";
import { firstWordTitle } from "../pick";
import { usePersonalAnswers, usePersonalCard } from "../use-personal";
import { ChoiceRadioGroup, ChoiceRow } from "./choice-row";
import { CrisisNotice } from "./crisis-notice";
import { FirstWordBody, FirstWordReason } from "./first-word";

type Step = "welcome" | "interests" | "moods" | "reading" | "result";

const DOCUMENT_TITLES: Record<Step, string> = {
  welcome: "시작하기",
  interests: "질문 1 / 3",
  moods: "질문 2 / 3",
  reading: "질문 3 / 3",
  result: "첫 말씀",
};

const PHOTO = "/hoondok/photos/onboarding-sunlit-field.webp";
// 저장 안내 문장은 화면마다 같은 한 문장이다(DESIGN-PLAN §8-8). 바꾸는 곳은 질문 3 막대 힌트가 알린다
const STORE_LINE = "고른 답은 이 기기에만 저장돼요";
const BETA_NOTICE = "독립 운영 베타";

type Draft = {
  interests: string[];
  /** 위기 선택지("많이 힘들어요")를 포함할 수 있다 — 저장할 때 오늘 날짜 표시로 바뀐다 */
  moods: string[];
  readingTime: string | null;
  readingLength: string | null;
};

const EMPTY_DRAFT: Draft = { interests: [], moods: [], readingTime: null, readingLength: null };

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
}

function Brand() {
  return (
    <div className="onb__brand">
      <img src={HOONDOK_FAVICON_SVG} alt="" width={32} height={32} />
      훈독
    </div>
  );
}

function StoreLine({ className = "" }: { className?: string }) {
  return (
    <p className={`onb-why onb-why--store ${className}`}>
      <Lock size={20} aria-hidden="true" />
      <span>{STORE_LINE}</span>
    </p>
  );
}

function AsideFoot({ hasStoreLine = true }: { hasStoreLine?: boolean }) {
  return (
    <div className="onb__foot only-pc">
      {hasStoreLine && <StoreLine />}
      <p className="notice">{BETA_NOTICE}</p>
    </div>
  );
}

/** 지금까지 고른 이름(읽기 전용 칩). 위기 선택지는 칩으로 다시 보여 주지 않는다. */
function PickedChips({ labels }: { labels: string[] }) {
  return (
    <ul className="chips">
      {labels.map((label) => (
        <li key={label} className="onb-chip">
          {label}
        </li>
      ))}
    </ul>
  );
}

function pickedLabels(draft: Draft, withMoods: boolean): string[] {
  const interests = draft.interests.map(interestLabel);
  const moods = withMoods ? draft.moods.filter((id) => id !== CRISIS_MOOD_ID).map(moodLabel) : [];
  return [...interests, ...moods].filter((label): label is string => Boolean(label));
}

type StepHeaderProps = {
  index: 1 | 2 | 3;
  onBack: () => void;
  backLabel: string;
  onSkip?: () => void;
};

/** [뒤로 44] [진행 막대 + "1 / 3"] [건너뛰기]. 질문 3은 고르지 않아도 되는 질문이라 라벨에 "선택" 을 붙인다. */
function StepHeader({ index, onBack, backLabel, onSkip }: StepHeaderProps) {
  const isOptional = index === 3;
  return (
    <div className="onb-step">
      <button type="button" className="onb-step__back" aria-label={backLabel} onClick={onBack}>
        <ArrowLeft size={22} aria-hidden="true" />
      </button>
      <div
        className="onb-step__prog"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={index}
        aria-valuetext={`질문 3개 중 ${index}번째${isOptional ? ", 고르지 않아도 되는 질문" : ""}`}
      >
        <span className="onb-step__track">
          <span className="onb-step__fill" style={{ width: `${(index / 3) * 100}%` }} />
        </span>
        <span className="onb-step__label" aria-hidden="true">
          {index} / 3{isOptional ? " · 선택" : ""}
        </span>
      </div>
      {onSkip ? (
        <button type="button" className="onb-step__skip" onClick={onSkip}>
          건너뛰기
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function Title({ titleRef, children }: { titleRef: RefObject<HTMLHeadingElement | null>; children: ReactNode }) {
  return (
    <h2 className="onb-title" tabIndex={-1} ref={titleRef}>
      {children}
    </h2>
  );
}

/** 하단 행동 막대 — 질문 화면 셋이 같은 높이 · 같은 자리에 주 버튼을 둔다. 개수 문구는 바뀔 때마다 읽어 준다. */
function ActionBar({
  count,
  hint,
  isWarn,
  children,
}: {
  count: string;
  hint: string;
  isWarn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="onb-bar">
      <div className="onb-bar__info">
        <span className="onb-bar__count" aria-live="polite" data-warn={isWarn || undefined}>
          {count}
        </span>
        <span className="onb-bar__hint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

export function StartFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const { answers, save } = usePersonalAnswers();
  const { user } = useCurrentUser();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const hasMoved = useRef(false);

  useEffect(() => {
    const previous = document.title;
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    document.title = `${DOCUMENT_TITLES[step]} · 훈독`;
    if (!hasMoved.current) return;
    // 단계 전환은 애니메이션 없이 교체하고 새 제목으로 포커스를 옮긴다(스크린 리더가 새 질문부터 읽는다)
    window.scrollTo(0, 0);
    titleRef.current?.focus();
  }, [step]);

  function go(next: Step) {
    hasMoved.current = true;
    setStep(next);
  }

  function begin() {
    // 이 기기에 남은 답이 있으면 이어서 고친다
    setDraft({
      interests: answers.interests,
      moods: answers.isCrisis ? [...answers.moods, CRISIS_MOOD_ID] : answers.moods,
      readingTime: answers.readingTime,
      readingLength: answers.readingLength,
    });
    go("interests");
  }

  function finish(next: Draft) {
    setDraft(next);
    save(next);
    go("result");
  }

  const isCrisis = draft.moods.includes(CRISIS_MOOD_ID);
  const pickInput = useMemo(
    () => ({ interests: draft.interests, moods: draft.moods.filter((id) => id !== CRISIS_MOOD_ID), isCrisis }),
    [draft.interests, draft.moods, isCrisis],
  );

  if (step === "welcome") {
    return (
      <div className="onb onb-welcome">
        <div className="onb__aside">
          <div className="onb-welcome__photo">
            <img src={PHOTO} alt="" width={1440} height={960} />
          </div>
        </div>
        <div className="onb__main">
          <div className="onb-welcome__body">
            <Brand />
            <Title titleRef={titleRef}>먼저 세 가지만 여쭐게요</Title>
            <p className="onb-lede">답에 맞춰 첫 말씀과 오늘 훈독에 꽂아 둘 장을 골라 드려요.</p>
            <dl className="onb-asks">
              <div className="onb-asks__row">
                <dt>관심 주제</dt>
                <dd>자주 펼치고 싶은 말씀의 주제</dd>
              </div>
              <div className="onb-asks__row">
                <dt>요즘 마음</dt>
                <dd>지금 마음에 가까운 말, 두 개까지</dd>
              </div>
              <div className="onb-asks__row">
                <dt>읽는 때</dt>
                <dd>
                  주로 읽는 때와 길이 <span className="badge">선택</span>
                </dd>
              </div>
            </dl>
            <p className="onb-why onb-asks-not">소속 교회와 직분은 묻지 않아요.</p>
            <StoreLine />
            <div className="onb-welcome__cta">
              <button type="button" className="btn btn-primary btn--pc-auto" onClick={begin}>
                시작하기
              </button>
              <Link className="onb-text-btn" href="/hoondok">
                질문 없이 시작하기
              </Link>
            </div>
            <p className="notice">{BETA_NOTICE}</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === "interests") {
    const count = draft.interests.length;
    return (
      <div className="onb">
        <div className="onb__aside">
          <Brand />
          <StepHeader index={1} backLabel="처음 화면으로" onBack={() => go("welcome")} />
          <div className="onb__intro">
            <Title titleRef={titleRef}>어떤 말씀을 자주 펼치고 싶으세요?</Title>
            <p className="onb-lede">고른 주제에 맞춰 첫 말씀과 오늘의 책갈피를 꽂아 둘게요.</p>
          </div>
          <div className="onb__pic only-pc">
            <img src={PHOTO} alt="" width={1440} height={960} loading="lazy" />
          </div>
          <AsideFoot />
        </div>
        <div className="onb__main">
          <div className="onb-choices onb-choices--pc-two" role="group" aria-label="관심 주제">
            {INTEREST_OPTIONS.map((option) => (
              <ChoiceRow
                key={option.id}
                role="checkbox"
                isChecked={draft.interests.includes(option.id)}
                label={option.label}
                description={option.description}
                onSelect={() => setDraft((d) => ({ ...d, interests: toggle(d.interests, option.id) }))}
              />
            ))}
          </div>
          <StoreLine className="only-m" />
          <div className="onb__spacer" />
          <ActionBar
            count={count === 0 ? "하나 이상 고르면 넘어갈 수 있어요" : `${count}개 골랐어요`}
            hint="여러 개 골라도 돼요"
          >
            <button type="button" className="btn btn-primary" disabled={count === 0} onClick={() => go("moods")}>
              다음
            </button>
          </ActionBar>
        </div>
      </div>
    );
  }

  if (step === "moods") {
    const limited = countLimitedMoods(draft.moods);
    const isAtLimit = limited >= MAX_MOODS;
    const regular = MOOD_OPTIONS.filter((o) => o.id !== CRISIS_MOOD_ID);
    const crisis = MOOD_OPTIONS.find((o) => o.id === CRISIS_MOOD_ID);
    const setMood = (id: string) => setDraft((d) => ({ ...d, moods: toggleMood(d.moods, id) }));
    return (
      <div className="onb">
        <div className="onb__aside">
          <Brand />
          <StepHeader
            index={2}
            backLabel="이전 질문"
            onBack={() => go("interests")}
            // 건너뛰면 이 질문의 답만 비운다. 위기 안내는 안전을 위해 남긴다
            onSkip={() => {
              setDraft((d) => ({ ...d, moods: d.moods.filter((id) => id === CRISIS_MOOD_ID) }));
              go("reading");
            }}
          />
          <div className="onb__intro">
            <Title titleRef={titleRef}>요즘 마음은 어떠세요?</Title>
            <p className="onb-lede">
              지금 마음에 가까운 말을 두 개까지 골라 주세요. 그 마음에 닿는 단락을 먼저 보여 드려요.
            </p>
          </div>
          <section className="onb-picked only-pc" aria-labelledby="onb-sofar-2">
            <div className="onb-picked__h">
              <h3 id="onb-sofar-2">지금까지 고르신 답</h3>
            </div>
            <PickedChips labels={pickedLabels(draft, false)} />
          </section>
          <AsideFoot />
        </div>
        <div className="onb__main">
          <div className="onb-choices onb-choices--md-two" role="group" aria-label="요즘 마음">
            {regular.map((option) => {
              const isChecked = draft.moods.includes(option.id);
              return (
                <ChoiceRow
                  key={option.id}
                  role="checkbox"
                  isChecked={isChecked}
                  isDisabled={isAtLimit && !isChecked}
                  label={option.label}
                  onSelect={() => setMood(option.id)}
                />
              );
            })}
            {crisis && (
              <div className="onb-choices__apart">
                <p className="onb-choices__apart-t">이 마음은 개수와 상관없이 고를 수 있어요</p>
                <ChoiceRow
                  role="checkbox"
                  isChecked={isCrisis}
                  label={crisis.label}
                  onSelect={() => setMood(crisis.id)}
                />
                {isCrisis && <CrisisNotice id="onb-q2-crisis" />}
              </div>
            )}
          </div>
          <StoreLine className="only-m" />
          <div className="onb__spacer" />
          <ActionBar
            count={
              isAtLimit
                ? "두 개까지 고를 수 있어요"
                : limited === 0
                  ? "고르지 않아도 넘어갈 수 있어요"
                  : `${limited}개 골랐어요`
            }
            hint={isAtLimit ? "하나를 풀면 다른 것을 고를 수 있어요" : "두 개까지"}
            isWarn={isAtLimit}
          >
            <button type="button" className="btn btn-primary" onClick={() => go("reading")}>
              다음
            </button>
          </ActionBar>
        </div>
      </div>
    );
  }

  if (step === "reading") {
    const time = READING_TIME_OPTIONS.find((o) => o.id === draft.readingTime);
    const length = READING_LENGTH_OPTIONS.find((o) => o.id === draft.readingLength);
    const summary = [time?.label, length && `${length.label} ${length.description}`].filter(Boolean).join(", ");
    return (
      <div className="onb">
        <div className="onb__aside">
          <Brand />
          <StepHeader
            index={3}
            backLabel="이전 질문"
            onBack={() => go("moods")}
            onSkip={() => finish({ ...draft, readingTime: null, readingLength: null })}
          />
          <div className="onb__intro">
            <Title titleRef={titleRef}>주로 언제 읽으세요?</Title>
            <p className="onb-lede">고르신 때와 길이에 맞춰 오늘 훈독 분량을 정해요. 알림은 켜지지 않아요.</p>
          </div>
          <section className="onb-picked only-pc" aria-labelledby="onb-sofar-3">
            <div className="onb-picked__h">
              <h3 id="onb-sofar-3">지금까지 고르신 답</h3>
            </div>
            <PickedChips labels={pickedLabels(draft, true)} />
          </section>
          <AsideFoot />
        </div>
        <div className="onb__main">
          <section className="onb-group" aria-labelledby="onb-g-time">
            <h3 className="onb-group__title" id="onb-g-time">
              읽는 때
            </h3>
            <ChoiceRadioGroup
              className="onb-choices onb-choices--pc-two"
              labelledBy="onb-g-time"
              options={READING_TIME_OPTIONS}
              value={draft.readingTime}
              onChange={(readingTime) => setDraft((d) => ({ ...d, readingTime }))}
            />
          </section>
          <section className="onb-group" aria-labelledby="onb-g-length">
            <h3 className="onb-group__title" id="onb-g-length">
              한 번에 읽는 길이
            </h3>
            <ChoiceRadioGroup
              className="onb-choices onb-choices--pc-two"
              labelledBy="onb-g-length"
              options={READING_LENGTH_OPTIONS}
              value={draft.readingLength}
              onChange={(readingLength) => setDraft((d) => ({ ...d, readingLength }))}
            />
          </section>
          <StoreLine className="only-m" />
          <div className="onb__spacer" />
          <ActionBar count={summary || "고르지 않아도 돼요"} hint="나의 정원에서 바꿀 수 있어요">
            <button type="button" className="btn btn-primary" onClick={() => finish(draft)}>
              첫 말씀 보기
            </button>
          </ActionBar>
        </div>
      </div>
    );
  }

  return (
    <ResultStep
      titleRef={titleRef}
      input={pickInput}
      name={user?.display_name}
      labels={pickedLabels(draft, true)}
      onBack={() => go("reading")}
      onEdit={() => go("interests")}
    />
  );
}

function ResultStep({
  titleRef,
  input,
  name,
  labels,
  onBack,
  onEdit,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
  input: { interests: string[]; moods: string[]; isCrisis: boolean };
  name: string | null | undefined;
  labels: string[];
  onBack: () => void;
  onEdit: () => void;
}) {
  const state = usePersonalCard(input);
  // 겹치는 장이 없어 오늘 편성 카드로 돌아갔으면 "고른" 말씀이라고 부르지 않는다
  const title = state.status === "ready" && state.isFallback ? "오늘 말씀부터 드릴게요" : firstWordTitle(name);
  const picked = (id: string) => (
    <section className="onb-picked" aria-labelledby={id}>
      <div className="onb-picked__h">
        <h3 id={id}>고르신 답</h3>
        <button type="button" className="onb-text-btn onb-text-btn--accent" onClick={onEdit}>
          답 바꾸기
        </button>
      </div>
      {labels.length > 0 ? <PickedChips labels={labels} /> : <p className="onb-why">고르신 답이 없어요</p>}
    </section>
  );
  return (
    <div className="onb onb-result">
      <div className="onb__aside">
        <Brand />
        <div className="onb-step">
          <button type="button" className="onb-step__back" aria-label="이전 질문" onClick={onBack}>
            <ArrowLeft size={22} aria-hidden="true" />
          </button>
          <span className="onb-step__label">첫 말씀</span>
          <span />
        </div>
        {/* 모바일은 한 열이라 위기 안내를 단계 머리 바로 아래, 제목·까닭보다 먼저 둔다. PC 는 오른쪽 열 맨 위(FirstWordBody) */}
        {input.isCrisis && (
          <div className="only-m">
            <CrisisNotice id="onb-result-crisis-m" />
          </div>
        )}
        <div className="onb__intro">
          <Title titleRef={titleRef}>{title}</Title>
          <FirstWordReason state={state} />
        </div>
        <div className="only-pc">{picked("onb-picked-pc")}</div>
        <AsideFoot hasStoreLine={false} />
      </div>
      <div className="onb__main">
        <FirstWordBody state={state} isCrisis={input.isCrisis} />
        <div className="only-m">
          {picked("onb-picked-m")}
          <StoreLine />
        </div>
        <div className="onb__spacer" />
        <ActionBar count="매일 이런 장이 홈에 꽂혀요" hint="">
          <Link className="btn btn-line" href="/hoondok">
            오늘 훈독으로
          </Link>
        </ActionBar>
      </div>
    </div>
  );
}
