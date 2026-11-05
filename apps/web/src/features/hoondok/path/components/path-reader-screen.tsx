"use client";

// /path/read/[day] — 숨 고르기(3초 자동, 건너뛰기) → 본문 → 다 읽었어요 → 마침(구절 고르기 / 오늘 훈독으로).
// "다 읽었어요"를 누르는 순간 읽은 날이 남는다 — 마침 화면에서 아무것도 남기지 않아도 된다.
// 마지막 장을 마치면 마침표(/path/done)로 간다. 부엉이는 이 화면 어디에도 없다.
// 한 줄 남기기는 1a 에 없다: 완료 요청 뒤 note 만 덧붙이는 API 가 없어서다(같은 장 재요청은 기존 값을 돌려준다).
import { BookOpenTextIcon } from "@phosphor-icons/react/dist/ssr/BookOpenText";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr/Check";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { WifiSlashIcon } from "@phosphor-icons/react/dist/ssr/WifiSlash";
import { ApiError } from "@truewords/api-client-ts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { HoondokButton } from "@/components/hoondok";
import { findWholeChunkHighlight, highlightInput, wholeChunkRange } from "@/features/hoondok/library/highlight-range";
import { useHighlights, useHighlightWriter } from "@/features/hoondok/library/use-reading";
import { ChoiceRadioGroup } from "@/features/hoondok/personal/components/choice-row";
import { useHoondokScreenTitle } from "@/features/hoondok/screen-title";
import { onboardingHref } from "@/features/identity/gate";
import type { PathRunView, PathStepContentResponse, PathStepSummary } from "../api";
import { minutesLabel } from "../format";
import { isUnauthorizedError, pathErrorCode, useCompletePathStep, usePathRun, usePathStep } from "../use-path-run";
import { PathTop } from "./path-top";

type Stage = "breath" | "read" | "finish" | "pick" | "withdrawn";
/** 읽기 전용으로 연 까닭 — 이미 읽은 장 · 오늘 다른 장을 이미 읽음 */
type ReadOnly = "done" | "already" | null;

const BREATH_MS = 3000;
const CLOSE = { label: "닫기", href: "/" } as const;

function decide(run: PathRunView, day: number): { stage: Stage; readOnly: ReadOnly } | { redirect: string } {
  if (run.status === "completed") return { redirect: "/path/done" };
  if (run.status !== "active") return { redirect: "/" };
  const step = run.steps.find((s) => s.day_index === day);
  if (!step) return { redirect: "/" };
  if (step.state === "withdrawn") return { stage: "withdrawn", readOnly: null };
  // 새로고침해도 오늘 읽은 장이면 마침 단계로 연다
  if (step.state === "done")
    return step.completed_on === run.today ? { stage: "finish", readOnly: null } : { stage: "read", readOnly: "done" };
  if (day !== run.next_step) return { redirect: run.next_step ? `/path/read/${run.next_step}` : "/" };
  if (run.read_today) return { stage: "read", readOnly: "already" };
  return { stage: "breath", readOnly: null };
}

function useFocusTitle(dep: unknown) {
  const ref = useRef<HTMLHeadingElement>(null);
  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    window.scrollTo(0, 0);
    ref.current?.focus();
  }, [dep]);
  return ref;
}

function ReadSkeleton() {
  return (
    <div className="path-read-skel" aria-busy="true">
      <span className="wd-skel wd-skel--meta" aria-hidden="true" />
      <span className="wd-skel wd-skel--head" aria-hidden="true" />
      <span className="wd-skel wd-skel--verse" aria-hidden="true" />
      <span className="wd-skel wd-skel--verse" aria-hidden="true" />
      <span className="wd-skel wd-skel--verse" aria-hidden="true" />
    </div>
  );
}

function Breath({ step, onDone }: { step: PathStepSummary; onDone: () => void }) {
  // 본문을 미리 불러오며 다시 그려져도 3초 타이머가 처음부터 다시 시작하지 않게 마지막 콜백만 본다
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  // 주소로 들어온 첫 화면이라 제목으로 포커스를 옮기지 않는다(본문으로 넘어갈 때 옮긴다)
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), BREATH_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <PathTop left={CLOSE} right={{ label: "건너뛰기", onClick: onDone }} />
      <div className="path-breath">
        <div className="path-breath__circle" aria-hidden="true" />
        <h2 className="onb-title">숨을 한 번 고르고 시작해요</h2>
        <p className="path-breath__sub">{`${step.title} · ${minutesLabel(step.estimated_minutes)}`}</p>
        <p className="path-breath__note">3초 뒤 말씀이 열려요.</p>
      </div>
    </>
  );
}

function Withdrawn({ run, day }: { run: PathRunView; day: number }) {
  // 다음 장은 서버가 정한 next_step 뿐이다. 이 장 자신이 다음 장이면 건너뛸 길이 없어 홈으로만 보낸다
  const next = run.next_step !== null && run.next_step !== day ? run.next_step : null;
  return (
    <>
      <PathTop left={CLOSE} />
      <div className="empty path-empty">
        <span className="empty__ic" aria-hidden="true">
          <BookOpenTextIcon size={26} />
        </span>
        <h2 className="empty__title path-empty__title">이 장은 지금 열 수 없어요</h2>
        <p className="path-empty__body">이 장은 읽은 장으로 세지 않아요. 다음 장으로 이어 읽으실 수 있어요.</p>
        <div className="path-cta">
          {next && (
            <Link className="btn btn-primary" href={`/path/read/${next}`}>
              다음 장 읽기
            </Link>
          )}
          <Link className={next ? "btn btn-ghost" : "btn btn-line"} href="/">
            오늘 훈독으로
          </Link>
        </div>
      </div>
    </>
  );
}

function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const isOffline = !(error instanceof ApiError) || (typeof navigator !== "undefined" && !navigator.onLine);
  return (
    <>
      <PathTop left={CLOSE} />
      <div className="empty path-empty" role="alert">
        <span className="empty__ic" aria-hidden="true">
          {isOffline ? <WifiSlashIcon size={26} /> : <WarningCircleIcon size={26} />}
        </span>
        <h2 className="empty__title path-empty__title">
          {isOffline ? "인터넷이 연결되지 않았어요" : "말씀을 불러오지 못했어요"}
        </h2>
        <p className="path-empty__body">
          {isOffline ? "연결되면 다시 시도를 눌러 주세요." : "잠시 뒤 다시 시도해 주세요."}
        </p>
        <div className="path-cta">
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            다시 시도
          </button>
          {!isOffline && (
            <Link className="btn btn-ghost" href="/">
              오늘 훈독으로
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

function Finish({
  step,
  doneSteps,
  totalSteps,
  saved,
  onPick,
}: {
  step: PathStepSummary;
  doneSteps: number;
  totalSteps: number;
  saved: boolean;
  onPick: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <>
      <PathTop left={CLOSE} />
      <div className="path-finish">
        <h2 className="onb-title" tabIndex={-1} ref={titleRef}>
          오늘 말씀을 읽었어요
        </h2>
        <p className="path-finish__sub">{`${step.title} · 읽은 장 ${doneSteps}/${totalSteps}`}</p>
        <p className="path-finish__note">마음에 남은 게 있으면 남겨 두세요. 없어도 괜찮아요.</p>
        {saved && (
          <p className="path-finish__saved" role="status">
            <CheckIcon weight="bold" size={20} aria-hidden="true" /> 구절을 남겼어요.
          </p>
        )}
        <div className="path-cta">
          <button type="button" className="btn btn-line" onClick={onPick}>
            마음에 남은 구절 고르기
          </button>
          <Link className="btn btn-line" href="/">
            오늘 훈독으로
          </Link>
        </div>
      </div>
    </>
  );
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

function Pick({
  content,
  onBack,
  onSaved,
}: {
  content: PathStepContentResponse;
  onBack: () => void;
  onSaved: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [chunkId, setChunkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { items } = useHighlights(content.volume, true);
  const writer = useHighlightWriter(content.volume, () => setError("구절을 남기지 못했어요. 다시 눌러 주세요."));
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const options = content.chunks.map((chunk) => ({
    id: chunk.chunk_id,
    label: excerpt(chunk.display_text),
    description: findWholeChunkHighlight(items, chunk) ? "남긴 구절" : "",
  }));

  function save() {
    const chunk = content.chunks.find((c) => c.chunk_id === chunkId);
    const range = chunk ? wholeChunkRange(chunk) : null;
    if (!chunk || !range) return;
    setError(null);
    // 이미 칠한 단락이면 새로 만들지 않는다
    if (findWholeChunkHighlight(items, chunk)) {
      onSaved();
      return;
    }
    writer.create.mutate(highlightInput(content.volume, range, 1), { onSuccess: onSaved });
  }

  return (
    <>
      <PathTop left={{ label: "이전", onClick: onBack }} />
      <div className="onb__intro">
        <h2 className="onb-title" id={titleId} tabIndex={-1} ref={titleRef}>
          마음에 남은 구절을 골라 주세요
        </h2>
        <p className="onb-lede">고른 구절은 형광펜으로 칠해 두고, 정성을 마칠 때 모아 보여 드려요.</p>
      </div>
      <ChoiceRadioGroup
        className="onb-choices path-picks"
        labelledBy={titleId}
        options={options}
        value={chunkId}
        onChange={setChunkId}
      />
      <div className="onb__spacer" />
      <div className="onb-bar path-bar--solo">
        {error && (
          <p className="path-bar__msg" role="alert">
            <WarningCircleIcon size={20} aria-hidden="true" />
            {error}
          </p>
        )}
        <HoondokButton disabled={!chunkId} isLoading={writer.create.isPending} onClick={save}>
          이 구절 남기기
        </HoondokButton>
      </div>
    </>
  );
}

export function PathReaderScreen({ day }: { day: number }) {
  const router = useRouter();
  const state = usePathRun();
  const run = state.status === "ready" ? state.run : null;
  const result = run ? decide(run, day) : null;
  const redirect =
    state.status === "anonymous"
      ? onboardingHref(`/path/read/${day}`)
      : state.status === "none" || state.status === "off"
        ? "/"
        : result && "redirect" in result
          ? result.redirect
          : null;
  useHoondokScreenTitle(run?.title ?? null);
  useEffect(() => {
    if (!redirect) return;
    if (state.status === "anonymous") window.location.assign(redirect);
    else router.replace(redirect);
  }, [redirect, state.status, router]);

  if (state.status === "error")
    return (
      <section className="col col--read path">
        <LoadFailed error={null} onRetry={state.retry} />
      </section>
    );
  if (!run || !result || "redirect" in result)
    return (
      <section className="col col--read path">
        <PathTop left={CLOSE} />
        <ReadSkeleton />
      </section>
    );
  // 처음 판정한 단계를 Reader 가 지닌다 — 완료 뒤 run 이 새로 와도 화면 단계가 튀지 않는다
  return <Reader key={day} run={run} day={day} initial={result} />;
}

function Reader({
  run,
  day,
  initial,
}: {
  run: PathRunView;
  day: number;
  initial: { stage: Stage; readOnly: ReadOnly };
}) {
  const router = useRouter();
  const [decision, setDecision] = useState(initial);
  const [doneSteps, setDoneSteps] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<{ text: string; isAlready?: boolean } | null>(null);
  const complete = useCompletePathStep();
  const stage = decision.stage;
  // 숨 고르기 동안 본문을 미리 불러 둔다
  const stepQuery = usePathStep(run.id, day, stage !== "withdrawn");
  const readTitleRef = useFocusTitle(stage === "read" ? "read" : null);

  const step = run.steps.find((s) => s.day_index === day) ?? null;
  const content = stepQuery.data ?? null;

  useEffect(() => {
    if (!step) return;
    const titles: Partial<Record<Stage, string>> = {
      breath: "숨 고르기",
      read: step.title,
      finish: "오늘 말씀을 읽었어요",
      pick: "구절 고르기",
      withdrawn: "열 수 없는 장",
    };
    const previous = document.title;
    document.title = `${titles[stage] ?? step.title} · 훈독`;
    return () => {
      document.title = previous;
    };
  }, [stage, step]);

  useEffect(() => {
    if (stepQuery.error && isUnauthorizedError(stepQuery.error))
      window.location.assign(onboardingHref(`/path/read/${day}`));
  }, [stepQuery.error, day]);

  if (!step)
    return (
      <section className="col col--read path">
        <PathTop left={CLOSE} />
        <ReadSkeleton />
      </section>
    );

  const setStage = (next: Stage) => setDecision({ ...decision, stage: next });

  if (stage === "withdrawn" || content?.status === "withdrawn")
    return (
      <section className="col col--read path">
        <Withdrawn run={run} day={day} />
      </section>
    );

  if (stage === "breath")
    return (
      <section className="col col--read path">
        <Breath step={step} onDone={() => setStage("read")} />
      </section>
    );

  if (stage === "finish")
    return (
      <section className="col col--read path">
        <Finish
          step={step}
          doneSteps={doneSteps ?? run.done_steps}
          totalSteps={run.total_steps}
          saved={saved}
          onPick={() => setStage("pick")}
        />
      </section>
    );

  if (!content)
    return (
      <section className="col col--read path">
        {stepQuery.isError ? (
          <LoadFailed error={stepQuery.error} onRetry={() => void stepQuery.refetch()} />
        ) : (
          <>
            <PathTop left={CLOSE} />
            <ReadSkeleton />
          </>
        )}
      </section>
    );

  if (stage === "pick")
    return (
      <section className="col col--read path path-flow">
        <Pick
          content={content}
          onBack={() => setStage("finish")}
          onSaved={() => {
            setSaved(true);
            setStage("finish");
          }}
        />
      </section>
    );

  function markRead() {
    setMessage(null);
    complete.mutate(day, {
      onSuccess: (res) => {
        if (res.run.status === "completed") {
          router.replace("/path/done");
          return;
        }
        setDoneSteps(res.run.done_steps);
        setStage("finish");
      },
      onError: (error) => {
        if (isUnauthorizedError(error)) {
          window.location.assign(onboardingHref(`/path/read/${day}`));
          return;
        }
        const code = pathErrorCode(error);
        if (code === "STEP_OUT_OF_ORDER") router.replace("/");
        else if (code === "ALREADY_READ_TODAY")
          setMessage({ text: "오늘은 이미 한 장을 읽으셨어요. 이 장은 다음에 이어 읽어요.", isAlready: true });
        else setMessage({ text: "기록을 남기지 못했어요. 연결을 확인하고 다시 눌러 주세요." });
      },
    });
  }

  const readOnly = decision.readOnly ?? (message?.isAlready ? "already" : null);
  const barText =
    readOnly === "done"
      ? "읽은 장이에요."
      : readOnly === "already"
        ? "오늘은 이미 한 장을 읽으셨어요. 이 장은 다음에 이어 읽어요."
        : (message?.text ?? null);

  return (
    <section className="col col--read path path-flow">
      <PathTop left={CLOSE} center={<span className="path-top__t">{run.title}</span>} />
      <p className="path-read__meta">{minutesLabel(content.estimated_minutes)}</p>
      <h2 className="lede path-read__title" tabIndex={-1} ref={readTitleRef}>
        {content.title}
      </h2>
      <div className="path-read__body">
        {content.chunks.map((chunk) => (
          <p className="verse" key={chunk.chunk_id}>
            <span className="verse__tx">{chunk.display_text}</span>
          </p>
        ))}
      </div>
      <div className="onb__spacer" />
      <div className="onb-bar path-bar--solo">
        {barText && (
          <p className={readOnly === "done" ? "path-bar__msg path-bar__msg--calm" : "path-bar__msg"} role="status">
            {readOnly !== "done" && <WarningCircleIcon size={20} aria-hidden="true" />}
            {barText}
          </p>
        )}
        {readOnly ? (
          <Link className="btn btn-line" href="/">
            오늘 훈독으로
          </Link>
        ) : (
          <HoondokButton isLoading={complete.isPending} onClick={markRead}>
            다 읽었어요
          </HoondokButton>
        )}
      </div>
    </section>
  );
}
