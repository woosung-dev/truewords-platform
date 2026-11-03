"use client";

// 질문·답변 상세 — 제목·날짜 → 답한 모델(변경) → 핵심 근거 → 답 → 근거 말씀 → 저장·공유·다시 → 공개 → 이어서 한 질문들
// → 관련 질문 → 하단 고정 "이어서 질문하기"(같은 session_id 로 잇는다).
// 원본은 계정에 보관된 대화(`GET /hoondok/me/asks/{session_id}`)다. 지금 답을 받는 중인 질문만 메모리(live.ts)에서 그린다 —
// 새 질문은 임시 주소(`/hoondok/ask/live-…`)로 열렸다가 답이 끝나 대화 id 를 받으면 그 주소로 바꿔 낀다.
// 근거 게이트(AC-017-01·04): sources 가 0건이면 답을 보이지 않고 "확인할 수 없음" 으로 끝낸다. 이어서 한 턴도 같다.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { MyAskDetail, MyAskTurn, Source } from "@truewords/api-client-ts/types";
import { ArrowUp, ChevronRight, MessageCircleQuestion, PenLine, RotateCcw, Share2, Sparkles, Star } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { isHoondokMascotEnabled } from "@/features/hoondok/flag";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type AnswerMode, ASK_ERROR_MESSAGE, ASK_QUESTION_MAX, type AskErrorKind, askLength } from "../ask-stream";
import { ASKS_KEY, askDetailKey, asksAPI, isSessionId } from "../asks-api";
import { askFullDate, SOURCE_RANK_UNKNOWN, sourceFields, sourceLabel } from "../format";
import { useClearLegacyAskItems } from "../legacy";
import {
  EMPTY_LIVE_ASKS,
  type LiveAsk,
  type LivePublicOutcome,
  type LiveStatus,
  liveAsksOf,
  readLiveAsks,
  retryLiveAsk,
  startLiveAsk,
  stopLiveAsk,
  subscribeLiveAsks,
} from "../live";
import { type AnswerChoice, answeredByLabel, answerModeInfo } from "../modes";
import { PUBLIC_STATUS_LABEL, publicQuestionsAPI } from "../public-api";
import { AskLoginGate, AskQuotaNote, DAILY_LIMIT_DONE, useAskQuota } from "./ask-gate";
import { askNewReturnHref, keepDraft } from "./ask-new";
import { ModeSheet } from "./mode-sheet";

// react-markdown(unified·micromark) 은 답이 있을 때만 받는다 — 대기·근거 없음 화면의 첫 로드 JS 에서 뺀다.
const AnswerMarkdown = dynamic(() => import("./answer-markdown").then((module) => module.AnswerMarkdown));

// 서버가 관련 질문을 주지 않을 때의 고정 문장 `[가정]`. 누르면 이어서 질문하기 칸을 채우기만 하고 보내지 않는다.
const FOLLOWUPS = ["이 말씀의 배경이 궁금해요", "오늘 어떻게 실천할 수 있나요", "비슷한 말씀이 더 있나요"] as const;

const GATE_MESSAGE = "근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요";
// 사용자가 스스로 멈춘 것은 실패가 아니지만, 다시 물어볼 길은 오류 카드(입력 보존 + 다시 시도)와 같다.
const STOPPED_MESSAGE = "질문을 그만뒀어요. 다시 시도하면 처음부터 찾아요";
const BLOCKED_MESSAGE = "이 답은 공개할 수 없어요. 마음 돌봄·위기 안내로 답했거나 근거를 다시 확인할 수 없는 답이에요.";
const SHARE_VISIBLE_MS = 2200;
/** 횟수를 다 써서 막힌 버튼이 이유를 가리키는 안내 id. */
const QUOTA_REASON_ID = "ask-quota-reason";
/** 제목을 3줄로 접는 기준 `[가정]` — 글자 수·줄 수로 어림한다(390px 에서 3줄 ≈ 60~70자). */
const LONG_TITLE_CHARS = 70;

type PublicStatus = MyAskTurn["public_status"];

/** 화면이 그리는 한 차례. 서버 기록과 받는 중인 질문을 같은 모양으로 맞춘다. */
type ViewTurn = {
  key: string;
  question: string;
  status: LiveStatus;
  answer: string;
  sources: Source[];
  resolvedMode?: AnswerMode;
  followups: string[];
  disclaimer?: string;
  messageId?: string;
  publicId?: string | null;
  publicStatus?: PublicStatus;
  createdAt: string;
  /** 받는 중인 질문이면 그 임시 id — 그만두기·다시 시도에 쓴다. */
  liveKey?: string;
  errorKind?: AskErrorKind;
  isStopped?: boolean;
};

function fromServer(turn: MyAskTurn): ViewTurn {
  // 근거 0건으로 끝난 답도 계정에 남는다 — 게이트를 다시 적용한다
  const hasSources = turn.sources.length > 0;
  return {
    key: turn.message_id,
    question: turn.question,
    status: hasSources ? "answered" : "no-sources",
    answer: hasSources ? turn.answer_md : "",
    sources: turn.sources,
    resolvedMode: turn.answer_mode,
    followups: turn.suggested_followups.filter((text) => text.trim().length > 0).slice(0, 3),
    messageId: turn.message_id,
    publicId: turn.public_id,
    publicStatus: turn.public_status,
    createdAt: turn.created_at,
  };
}

function fromLive(entry: LiveAsk): ViewTurn {
  const result = entry.result;
  const isAnswered = entry.status === "answered" && result;
  return {
    key: entry.key,
    question: entry.question,
    status: entry.status,
    answer: isAnswered ? result.answer : "",
    sources: isAnswered ? result.sources : [],
    resolvedMode: result?.resolvedMode,
    followups: isAnswered ? result.followups : [],
    disclaimer: result?.disclaimer,
    messageId: result?.messageId,
    createdAt: entry.createdAt,
    liveKey: entry.key,
    errorKind: entry.errorKind,
    isStopped: entry.isStopped,
  };
}

/** 서버 기록 + 아직 서버 목록에 없는 받는 중·끝난 질문(같은 대화). 서버에 도착한 답은 서버 쪽만 남긴다. */
function mergeTurns(detail: MyAskDetail | undefined, live: readonly LiveAsk[], sessionId: string): ViewTurn[] {
  const server = detail?.turns.map(fromServer) ?? [];
  const known = new Set(server.map((turn) => turn.messageId));
  const pending = live
    .filter((entry) => entry.sessionId === sessionId && !(entry.result && known.has(entry.result.messageId)))
    .map(fromLive)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return [...server, ...pending];
}

function AskMissing({ body }: { body: string }) {
  return (
    <section className="col col--read">
      <div className="empty">
        <span className="empty__ic">
          <MessageCircleQuestion size={26} aria-hidden="true" />
        </span>
        <h2 className="empty__title">질문을 찾을 수 없어요</h2>
        <p className="empty__body">{body}</p>
        <Link className="btn btn-line ql-empty__cta" href="/hoondok/ask?tab=mine">
          내 질문으로
        </Link>
      </div>
    </section>
  );
}

/** 답을 기다리는 카드 — 회전 1종(1.2s)으로 진행 중임을 알리고 그만둘 길을 함께 둔다 (DES §1.5) */
function AskWaiting({ onStop }: { onStop?: () => void }) {
  return (
    <div className="ask-wait" role="status" aria-busy="true">
      {/* 부엉이는 메시지 위에 쌓는다 — 스피너·부엉이·문장이 한 줄에 서면 390px 에서 문장이 끊긴다 */}
      <HoondokMascot pose="search" size={56} motion="breathe" />
      <p className="ask-wait__msg">
        <span className="ask-spinner" aria-hidden="true" />
        근거 말씀을 찾고 있어요. 잠시만 기다려 주세요.
      </p>
      {isHoondokMascotEnabled() && <p className="ask-wait__sub">찾은 말씀 안에서만 설명해요.</p>}
      {onStop && (
        <HoondokButton variant="line" isSmall onClick={onStop}>
          그만두기
        </HoondokButton>
      )}
    </div>
  );
}

/** 실패 카드. 하루 횟수를 다 썼으면 다시 시도 대신 안내만, 로그인이 풀렸으면 로그인 링크를 둔다. */
function AskFailed({ turn, onRetry, returnTo }: { turn: ViewTurn; onRetry?: () => void; returnTo: string }) {
  const kind = turn.errorKind ?? "failed";
  const message = turn.isStopped ? STOPPED_MESSAGE : ASK_ERROR_MESSAGE[kind];
  return (
    <div className="card ask-fail" role="status">
      <p className="ask-fail__msg">{message}</p>
      {kind === "auth" ? (
        <Link className="btn btn-line btn--sm" href={onboardingHref(returnTo)}>
          로그인하기
        </Link>
      ) : kind === "blocked" ? (
        // 같은 문장을 새 질문 화면에 채워 고칠 수 있게 한다(문장은 주소가 아닌 이 탭의 sessionStorage 로 넘긴다)
        <Link className="btn btn-line btn--sm" href={askNewReturnHref("auto")} onClick={() => keepDraft(turn.question)}>
          고쳐서 다시 묻기
        </Link>
      ) : (
        kind !== "daily-limit" &&
        kind !== "forbidden" &&
        onRetry && (
          <HoondokButton variant="line" isSmall onClick={onRetry}>
            다시 시도
          </HoondokButton>
        )
      )}
    </div>
  );
}

function AskNoSources() {
  return (
    <div className="card ask-fail" role="status">
      <HoondokMascot pose="search" size={56} />
      <p className="ask-fail__msg">{GATE_MESSAGE}</p>
      {isHoondokMascotEnabled() && <p className="ask-fail__sub">책 이름이나 핵심 낱말을 넣으면 찾기 쉬워요.</p>}
    </div>
  );
}

/** 원문을 열 수 있는 근거인지 — 권리 목록에서 전문 공개가 허용된 권만 링크를 단다. */
function useOriginalLink(enabled: boolean) {
  const rights = useQuery({
    queryKey: ["hoondok", "library"],
    queryFn: libraryAPI.list,
    enabled,
    retry: false,
    staleTime: 0,
  });
  return {
    isPending: rights.isPending,
    canOpen: (source: Source) =>
      !rights.isError &&
      Boolean(rights.data?.items.some((work) => work.volume === source.volume && work.scope_full_text)),
  };
}

function AnswerNote({ answer, sources, disclaimer }: { answer: string; sources: Source[]; disclaimer?: string }) {
  return (
    <div className="ai-note">
      <div className="ai-note__lab">
        <Sparkles size={14} aria-hidden="true" />
        AI 설명 · 공식 해설 아님
      </div>
      <AnswerMarkdown answer={answer} />
      {/* 근거 번호는 답 끝에 한 번만 붙인다 `[가정]` — 문장 단위 인용 위치는 모델이 주지 않는다 */}
      {sources.length > 0 && (
        <p className="ai-note__body">
          {sources.map((_, order) => (
            <sup className="ask-ref" key={`ref-${order + 1}`}>
              {order + 1}
            </sup>
          ))}
        </p>
      )}
      {disclaimer && <p className="ai-note__micro">{disclaimer}</p>}
    </div>
  );
}

function EvidenceList({ sources, original }: { sources: Source[]; original: ReturnType<typeof useOriginalLink> }) {
  return (
    <>
      {sources.map((source, order) => (
        <article className="card ask-ev" key={source.chunk_id || `${order}-${source.volume}`}>
          {/* 말씀보다 출처가 먼저 온다 (REQ-PWA-012). 모르는 칸은 비우지 않고 "확인되지 않음" 으로 적는다 */}
          <div className="src">
            <b className="ask-ev__no">{order + 1}</b>
            {sourceFields(source).map((field) => (
              <Fragment key={field.id}>
                <span className="src__dot" />
                <span className={field.isUnknown ? "src__unknown" : undefined}>{field.text}</span>
              </Fragment>
            ))}
            <span className="badge badge--dashed">{SOURCE_RANK_UNKNOWN}</span>
          </div>
          <p className="scripture">{source.text}</p>
          {original.canOpen(source) ? (
            <Link className="btn btn-line btn--sm" href={wordsHref(source.volume, source.chunk_id)}>
              원문 보기
            </Link>
          ) : (
            <p className="notice">
              {original.isPending ? "원문 공개 권한을 확인하고 있어요" : "이 근거의 원문 공개 권한을 확인할 수 없어요"}
            </p>
          )}
        </article>
      ))}
    </>
  );
}

/** 긴 질문 제목은 3줄로 접고 펼치기를 둔다 — 단락 인용 질문이 첫 화면을 다 차지하지 않게(여정 테스트 P2). */
function AskTitle({ question }: { question: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = question.length > LONG_TITLE_CHARS || question.split("\n").length > 3;
  return (
    <>
      <h2 className={`ask-q${isLong && !isExpanded ? " ask-q--clamp" : ""}`}>{question}</h2>
      {isLong && (
        <button
          className="ask-q__more"
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((value) => !value)}
        >
          {isExpanded ? "질문 접기" : "질문 전체 보기"}
        </button>
      )}
    </>
  );
}

export function AskDetail({ id }: { id: string }) {
  useClearLegacyAskItems();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const isLoggedIn = Boolean(user);
  const isSession = isSessionId(id);
  // 받는 중인 질문은 지금 로그인한 계정 것만 — 공용 기기에서 계정이 바뀐 뒤 앞 사람의 비공개 질문이 보이지 않게
  const live = liveAsksOf(
    useSyncExternalStore(subscribeLiveAsks, readLiveAsks, () => EMPTY_LIVE_ASKS),
    user?.id,
  );
  const detail = useQuery({
    queryKey: askDetailKey(id),
    queryFn: ({ signal }) => asksAPI.detail(id, signal),
    enabled: isLoggedIn && isSession,
    retry: false,
  });
  const quota = useAskQuota(isLoggedIn);
  const [shareTick, setShareTick] = useState(0);
  const [isModeSheetOpen, setIsModeSheetOpen] = useState(false);
  const [followup, setFollowup] = useState("");
  const followupRef = useRef<HTMLInputElement>(null);
  const lastTurnRef = useRef<HTMLElement>(null);
  const turnCountRef = useRef<number | null>(null);

  const liveEntry = isSession ? undefined : live.find((entry) => entry.key === id);
  const turns: ViewTurn[] = isSession ? mergeTurns(detail.data, live, id) : liveEntry ? [fromLive(liveEntry)] : [];
  const first = turns[0];
  const rest = turns.slice(1);
  const isBusy = turns.some((turn) => turn.status === "pending");
  const hasAnswered = turns.some((turn) => turn.status === "answered");
  const original = useOriginalLink(hasAnswered);
  const settle = () => void queryClient.invalidateQueries({ queryKey: ASKS_KEY });

  // 새 질문이 대화 id 를 받으면(답이 끝나면) 그 주소로 바꿔 낀다 — 새로 고쳐도 계정 기록으로 다시 열린다.
  const nextSession = liveEntry && liveEntry.status !== "pending" ? liveEntry.sessionId : undefined;
  useEffect(() => {
    if (nextSession) router.replace(`/hoondok/ask/${nextSession}`);
  }, [nextSession, router]);

  useEffect(() => {
    if (shareTick === 0) return;
    const timer = window.setTimeout(() => setShareTick(0), SHARE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [shareTick]);

  // 이어서 질문을 보내면 새 턴으로 내려간다. 처음 열 때(기존 턴)는 움직이지 않는다.
  useEffect(() => {
    if (turnCountRef.current !== null && rest.length > turnCountRef.current) {
      lastTurnRef.current?.scrollIntoView({ block: "start" });
    }
    turnCountRef.current = rest.length;
  }, [rest.length]);

  const saveMutation = useMutation({
    mutationFn: (saved: boolean) => asksAPI.setSaved(id, saved),
    onSuccess: (next) => {
      queryClient.setQueryData(askDetailKey(id), next);
      void queryClient.invalidateQueries({ queryKey: ASKS_KEY });
    },
  });

  if (!isLoggedIn && !isUserLoading) {
    return (
      <section className="col col--read">
        <AskLoginGate
          title="로그인하면 볼 수 있어요"
          body="질문과 답은 내 계정에만 보관돼요. 질문한 계정으로 로그인해 주세요."
          returnTo={isSession ? `/hoondok/ask/${id}` : "/hoondok/ask?tab=mine"}
        />
      </section>
    );
  }
  if (!first) {
    if (isSession && (isUserLoading || detail.isPending)) {
      return (
        <section className="col col--read">
          <p className="ask-state" role="status" aria-busy="true">
            질문을 불러오고 있어요
          </p>
        </section>
      );
    }
    if (isSession && detail.isError && !(detail.error instanceof ApiError && detail.error.status === 404)) {
      return (
        <section className="col col--read">
          <div className="ask-state" role="status">
            <p>질문을 불러오지 못했어요.</p>
            <button className="btn btn-line btn--sm" type="button" onClick={() => void detail.refetch()}>
              다시 시도
            </button>
          </div>
        </section>
      );
    }
    if (!isSession && isUserLoading) return <section className="col col--read" />;
    return (
      <AskMissing
        body={
          isSession
            ? "지웠거나 다른 계정의 질문이에요. 질문은 질문한 계정에서만 볼 수 있어요."
            : "답을 받던 화면을 다시 열었다면 내 질문에서 찾아 주세요."
        }
      />
    );
  }

  const returnTo = isSession ? `/hoondok/ask/${id}` : "/hoondok/ask?tab=mine";
  const keySource = first.sources[0];
  const lastAnswered = [...turns].reverse().find((turn) => turn.status === "answered");
  const followups = lastAnswered?.followups ?? [];
  const related = followups.length > 0 ? followups : FOLLOWUPS;
  const modeInfo = first.resolvedMode ? answerModeInfo(first.resolvedMode) : null;
  const ModeIcon = modeInfo?.icon;
  const isAnswered = first.status === "answered";
  const canFollowUp = isSession && Boolean(first.messageId);
  const saved = detail.data?.saved ?? false;
  const createdAt = detail.data?.created_at ?? first.createdAt;
  const followText = followup.trim();
  const followLength = askLength(followup);
  const isFollowTooLong = followLength > ASK_QUESTION_MAX;
  const liveOfFirst = live.find((entry) => entry.result?.messageId === first.messageId);

  function retry(turn: ViewTurn) {
    if (turn.liveKey) retryLiveAsk(turn.liveKey, settle);
  }

  /** 같은 질문을 (다른) 모델로 새로 묻는다 — 새 대화라 공개 신청은 따라가지 않는다. */
  function askAgain(choice: AnswerChoice | undefined) {
    if (!first || quota.isExhausted) return;
    if (!user) return;
    const key = startLiveAsk(
      { ownerId: user.id, question: first.question, answerMode: choice && choice !== "auto" ? choice : undefined },
      settle,
    );
    router.push(`/hoondok/ask/${key}`);
  }

  function handleFollowup(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !followText || !canFollowUp || isBusy || isFollowTooLong || quota.isExhausted) return;
    startLiveAsk({ ownerId: user.id, question: followText, sessionId: id }, settle);
    setFollowup("");
  }

  async function handleShare() {
    if (!first) return;
    const text = `${first.question}\n\n${first.answer}`.trim();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: first.question, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareTick((tick) => tick + 1);
    } catch {
      // 사용자가 공유 시트를 닫았거나 클립보드 권한이 없으면 조용히 둔다
    }
  }

  return (
    <section className={`col col--read ask-detail${canFollowUp ? " ask-detail--follow" : ""}`}>
      <AskTitle question={first.question} />
      <div className="ask-q__meta">
        <span className="ask-q__date">{askFullDate(createdAt)}</span>
        {saved && <span className="badge">저장됨</span>}
        {first.publicStatus && (
          <span className={`badge ${first.publicStatus === "published" ? "badge--accent" : "badge--line"}`}>
            {PUBLIC_STATUS_LABEL[first.publicStatus]}
          </span>
        )}
      </div>

      {/* 횟수를 다 썼으면 막힌 버튼(변경·다시 묻기) 가까이에 이유를 둔다 — 버튼이 aria-describedby 로 가리킨다 */}
      {quota.isExhausted && (
        <p id={QUOTA_REASON_ID} className="ask-quota ask-quota--out">
          {DAILY_LIMIT_DONE}
        </p>
      )}

      {isAnswered && modeInfo && ModeIcon && (
        <div className="card ask-model">
          <p className="ask-model__k">이 모델이 답변했어요</p>
          <div className="ask-model__row">
            <span className="ask-model__ic" aria-hidden="true">
              <ModeIcon size={20} />
            </span>
            <span className="ask-model__bd">
              <b>{modeInfo.label}</b>
              <span>{modeInfo.description}</span>
            </span>
            <button
              className="btn btn-line btn--sm"
              type="button"
              aria-haspopup="dialog"
              aria-label="답변 모델 변경"
              aria-describedby={quota.isExhausted ? QUOTA_REASON_ID : undefined}
              disabled={quota.isExhausted}
              onClick={() => setIsModeSheetOpen(true)}
            >
              변경
            </button>
          </div>
        </div>
      )}

      {first.status === "pending" && (
        <AskWaiting onStop={first.liveKey ? () => stopLiveAsk(first.liveKey as string) : undefined} />
      )}
      {first.status === "error" && <AskFailed turn={first} onRetry={() => retry(first)} returnTo={returnTo} />}
      {first.status === "no-sources" && <AskNoSources />}
      {first.status === "no-sources" && (
        <div className="sect">
          <div className="ask-acts">
            <HoondokButton
              variant="line"
              isSmall
              disabled={quota.isExhausted}
              aria-describedby={quota.isExhausted ? QUOTA_REASON_ID : undefined}
              onClick={() => askAgain(first.resolvedMode)}
            >
              <RotateCcw size={18} aria-hidden="true" />
              다시 묻기
            </HoondokButton>
          </div>
        </div>
      )}

      {isAnswered && (
        <>
          {keySource && (
            <article className="ask-key">
              <p className="ask-key__k">{`근거 말씀 · ${sourceLabel(keySource)}`}</p>
              <p className="scripture ask-key__t">{keySource.text}</p>
              {original.canOpen(keySource) && (
                <Link className="ask-key__go" href={wordsHref(keySource.volume, keySource.chunk_id)}>
                  원문 보기
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              )}
            </article>
          )}

          <div className="sect">
            <AnswerNote answer={first.answer} sources={first.sources} disclaimer={first.disclaimer} />
          </div>

          <div className="sect">
            <div className="sect__head">
              <h3 className="sect__title">{`근거 말씀 ${first.sources.length}`}</h3>
              <span className="sect__meta">원문 공개 권한 확인 후 열기</span>
            </div>
            <EvidenceList sources={first.sources} original={original} />
          </div>

          <div className="sect">
            <div className="ask-acts">
              <button
                className="btn btn-line btn--sm"
                type="button"
                aria-pressed={saved}
                disabled={!detail.data || saveMutation.isPending}
                onClick={() => saveMutation.mutate(!saved)}
              >
                <Star size={18} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
                {saved ? "저장됨" : "저장"}
              </button>
              <HoondokButton variant="line" isSmall onClick={handleShare}>
                <Share2 size={18} aria-hidden="true" />
                공유
              </HoondokButton>
              <HoondokButton
                variant="line"
                isSmall
                disabled={quota.isExhausted}
                aria-describedby={quota.isExhausted ? QUOTA_REASON_ID : undefined}
                onClick={() => askAgain(first.resolvedMode)}
              >
                <RotateCcw size={18} aria-hidden="true" />
                다시 묻기
              </HoondokButton>
            </div>
            <p className="hint ask-saved-note">
              <span>내 계정에만 보관돼요</span>
              <span aria-live="polite" data-testid="ask-share-status">
                {saveMutation.isError ? "저장하지 못했어요" : shareTick > 0 ? "복사했어요" : ""}
              </span>
            </p>
            {first.messageId && (
              <PublicSection
                turn={first}
                outcome={liveOfFirst?.publicOutcome}
                // 신청이 끝났어도 서버 기록에 공개 id 가 오기 전이면(주소가 바뀌어 대화를 먼저 읽은 경우 포함) 아직 보내는
                // 중으로 보인다 — 그 사이 "공개 허용하기"를 한 번 더 누르지 않게
                isSubmitting={
                  liveOfFirst?.publicOutcome === "submitting" ||
                  (liveOfFirst?.publicOutcome === "done" && !first.publicId)
                }
                onChanged={settle}
              />
            )}
          </div>
        </>
      )}

      {rest.map((turn, index) => (
        <section
          key={turn.key}
          ref={index === rest.length - 1 ? lastTurnRef : undefined}
          className="ask-turn"
          aria-label="이어서 한 질문"
        >
          <p className="ask-turn__q">{turn.question}</p>
          {turn.status === "pending" && (
            <AskWaiting onStop={turn.liveKey ? () => stopLiveAsk(turn.liveKey as string) : undefined} />
          )}
          {turn.status === "error" && <AskFailed turn={turn} onRetry={() => retry(turn)} returnTo={returnTo} />}
          {turn.status === "no-sources" && <AskNoSources />}
          {turn.status === "answered" && (
            <>
              {turn.resolvedMode && (
                <p className="ask-turn__by">{answeredByLabel(turn.resolvedMode, "이어서 답했어요")}</p>
              )}
              <AnswerNote answer={turn.answer} sources={turn.sources} disclaimer={turn.disclaimer} />
              <details className="ask-turn__ev">
                <summary>{`근거 말씀 ${turn.sources.length}`}</summary>
                <EvidenceList sources={turn.sources} original={original} />
              </details>
            </>
          )}
        </section>
      ))}

      {hasAnswered && !isBusy && canFollowUp && (
        <div className="sect">
          <div className="sect__head">
            <h3 className="sect__title">관련 질문</h3>
            <span className="sect__meta">누르면 아래 칸에 담아요</span>
          </div>
          <div className="ask-chips">
            {related.map((text) => (
              <button
                className="ask-chip"
                key={text}
                type="button"
                onClick={() => {
                  setFollowup(text);
                  followupRef.current?.focus();
                }}
              >
                <span>{text}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="notice">AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다</p>

      {canFollowUp && (
        <form className="ask-follow" onSubmit={handleFollowup}>
          <AskQuotaNote remaining={quota.remaining} className="ask-follow__quota" />
          {/* 넘친 글자를 몰래 자르지 않는다 — 새 질문 화면과 같은 안내로 알리고 보내기를 잠근다 */}
          {isFollowTooLong && (
            <p id="ask-follow-count" className="ask-count ask-count--over">
              {`${ASK_QUESTION_MAX}자까지 보낼 수 있어요 (${followLength}/${ASK_QUESTION_MAX})`}
            </p>
          )}
          <div className="ask-follow__in">
            <input
              ref={followupRef}
              className="ask-follow__field"
              type="text"
              aria-label="이어서 질문하기"
              aria-describedby={isFollowTooLong ? "ask-follow-count" : undefined}
              aria-invalid={isFollowTooLong || undefined}
              placeholder="이어서 질문하기"
              enterKeyHint="send"
              value={followup}
              disabled={isBusy || quota.isExhausted}
              onChange={(event) => setFollowup(event.target.value)}
            />
            <button
              className="ask-follow__send"
              type="submit"
              aria-label="이어서 질문 보내기"
              disabled={isBusy || !followText || isFollowTooLong || quota.isExhausted}
            >
              <ArrowUp size={20} aria-hidden="true" />
            </button>
            <Link className="icon-btn ask-follow__new" href="/hoondok/ask/new" aria-label="새 질문">
              <PenLine size={20} aria-hidden="true" />
            </Link>
          </div>
        </form>
      )}

      {isModeSheetOpen && first.resolvedMode && (
        <ModeSheet
          title="다른 모델로 다시 묻기"
          lede="같은 질문을 고른 모델로 새로 물어요(오늘 남은 질문 1회를 써요). 지금 답은 내 질문에 그대로 남아요."
          confirmLabel="이 모델로 다시 묻기"
          value={first.resolvedMode}
          onPick={(choice) => {
            setIsModeSheetOpen(false);
            // 카드에 보이는 모델 그대로 확정하면 닫기만 한다
            if (choice !== first.resolvedMode) askAgain(choice);
          }}
          onClose={() => setIsModeSheetOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * 첫 답의 공개 상태와 신청·내리기. 추천 질문은 식구가 공개를 허용한 답 중 관리자가 고른 것이다(DEC-PWA-025 2차).
 * 내리기는 서버 복사본을 바로 지워 되돌릴 수 없으므로 확인을 받고, 내린 뒤에는 다시 신청할 수 있다.
 */
function PublicSection({
  turn,
  outcome,
  isSubmitting,
  onChanged,
}: {
  turn: ViewTurn;
  outcome?: LivePublicOutcome;
  isSubmitting: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [isConfirming, setIsConfirming] = useState(false);
  const [notice, setNotice] = useState<"withdrawn" | "cancelled" | "blocked" | null>(null);
  const refresh = () => {
    onChanged();
    void queryClient.invalidateQueries({ queryKey: ["hoondok", "public-questions"] });
  };
  const submit = useMutation({
    mutationFn: () => publicQuestionsAPI.submit(turn.messageId as string),
    onSuccess: () => {
      setNotice(null);
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setNotice("blocked");
    },
  });
  const withdraw = useMutation({
    mutationFn: () => publicQuestionsAPI.remove(turn.publicId as string),
    onSettled: (_data, error) => {
      // 이미 지워졌으면(404) 내린 것과 같다
      if (error && !(error instanceof ApiError && error.status === 404)) return;
      setIsConfirming(false);
      setNotice(turn.publicStatus === "published" ? "withdrawn" : "cancelled");
      refresh();
    },
  });

  if (turn.publicId) {
    const isPublished = turn.publicStatus === "published";
    return (
      <div className="ask-public">
        <p>
          {isPublished
            ? "추천 질문에 이름 없이 올라가 있어요."
            : turn.publicStatus === "hidden"
              ? "관리자가 추천 질문으로 올리지 않기로 했어요."
              : "공개를 허용했어요. 관리자가 골라 추천 질문으로 올릴 수 있어요."}
        </p>
        <HoondokButton variant="line" isSmall onClick={() => setIsConfirming(true)}>
          {isPublished ? "추천에서 내리기" : "공개 허용 취소"}
        </HoondokButton>
        {isConfirming && (
          <ReaderSheet
            title={isPublished ? "추천에서 내릴까요?" : "공개 허용을 취소할까요?"}
            onClose={() => setIsConfirming(false)}
          >
            <p className="js-lede">
              {isPublished
                ? "추천 목록과 공개 링크에서 바로 사라지고 되돌릴 수 없어요. 내 질문과 답은 그대로 남아요."
                : "관리자가 추천 후보로 보지 않게 돼요. 내 질문과 답은 그대로 남아요."}
            </p>
            {withdraw.isError && <p role="alert">처리하지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
            <div className="ask-acts">
              <HoondokButton variant="primary" isSmall isLoading={withdraw.isPending} onClick={() => withdraw.mutate()}>
                {isPublished ? "내리기" : "취소하기"}
              </HoondokButton>
            </div>
          </ReaderSheet>
        )}
      </div>
    );
  }

  if (turn.resolvedMode === "pastoral" || outcome === "blocked" || notice === "blocked") {
    return (
      <p className="ask-public" role="status">
        {turn.resolvedMode === "pastoral" ? "마음 돌봄으로 답한 질문은 공개하지 않아요." : BLOCKED_MESSAGE}
      </p>
    );
  }
  if (isSubmitting) {
    return (
      <p className="ask-public" role="status" aria-busy="true">
        공개 신청을 보내고 있어요
      </p>
    );
  }
  return (
    <div className="ask-public">
      <p role="status">
        {notice === "withdrawn"
          ? "공개를 내렸어요. 추천 목록에서 빠졌어요."
          : notice === "cancelled"
            ? "공개 허용을 취소했어요. 내 계정에서만 볼 수 있어요."
            : outcome === "failed" || submit.isError
              ? "공개 신청을 보내지 못했어요."
              : "비공개 · 내 계정에서만 볼 수 있어요."}
      </p>
      <HoondokButton variant="line" isSmall isLoading={submit.isPending} onClick={() => submit.mutate()}>
        {notice || outcome === "failed" || submit.isError ? "다시 공개 허용하기" : "공개 허용하기"}
      </HoondokButton>
    </div>
  );
}
