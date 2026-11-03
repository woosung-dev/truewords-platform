"use client";

// 질문·답변 상세 — 제목·날짜 → 답한 모델(변경) → 핵심 근거 → 답 → 근거 말씀 → 저장·공유·다시 → 이어서 한 질문들
// → 관련 질문 → 하단 고정 "이어서 질문하기"(같은 session_id 로 잇는다).
// 근거 게이트(AC-017-01·04): sources 가 0건이면 답을 보이지 않고 "확인할 수 없음" 으로 끝낸다. 이어서 한 턴도 같다.
// 공개를 고른 질문은 답이 끝난 뒤 message_id 로 공개 신청한다(서버가 기록을 복사하고 협회가 검수한다).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import type { Source } from "@truewords/api-client-ts/types";
import { ArrowUp, ChevronRight, MessageCircleQuestion, PenLine, RotateCcw, Share2, Sparkles, Star } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { isHoondokMascotEnabled } from "@/features/hoondok/flag";
import { libraryAPI, wordsHref } from "@/features/hoondok/library/api";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { type AskResult, askErrorMessage, requestAsk } from "../ask-stream";
import { askFullDate, SOURCE_RANK_UNKNOWN, sourceFields, sourceLabel } from "../format";
import { type AnswerChoice, answeredByLabel, answerModeInfo } from "../modes";
import { PUBLIC_STATUS_LABEL, publicQuestionsAPI } from "../public-api";
import {
  type AskItem,
  type AskTurn,
  appendAskItem,
  appendAskTurn,
  EMPTY_ASK_ITEMS,
  newAskId,
  readAskItem,
  readAskItems,
  subscribeAsk,
  toggleAskSaved,
  updateAskItem,
  updateAskTurn,
} from "../storage";
import { ModeSheet } from "./mode-sheet";

// react-markdown(unified·micromark) 은 답이 있을 때만 받는다 — 대기·근거 없음 화면의 첫 로드 JS 에서 뺀다.
const AnswerMarkdown = dynamic(() => import("./answer-markdown").then((module) => module.AnswerMarkdown));

// 서버가 관련 질문을 주지 않을 때의 고정 문장 `[가정]`. 누르면 이어서 질문하기 칸을 채우기만 하고 보내지 않는다.
const FOLLOWUPS = ["이 말씀의 배경이 궁금해요", "오늘 어떻게 실천할 수 있나요", "비슷한 말씀이 더 있나요"] as const;

const GATE_MESSAGE = "근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요";
// 사용자가 스스로 멈춘 것은 실패가 아니지만, 다시 물어볼 길은 오류 카드(입력 보존 + 다시 시도)와 같다.
const STOPPED_MESSAGE = "질문을 그만뒀어요. 다시 시도하면 처음부터 찾아요";
const BLOCKED_MESSAGE =
  "마음 돌봄이나 위기 안내로 답했거나 근거를 다시 확인할 수 없는 답은 공개하지 않아요. 이 답은 이 기기에만 남아요.";
const MY_QUESTIONS_KEY = ["hoondok", "me", "questions"] as const;
const SHARE_VISIBLE_MS = 2200;

// 같은 질문의 공개 신청이 StrictMode 이중 실행·재마운트로 두 번 나가지 않게 한다(두 번째는 서버가 409 로 막는다).
const submitting = new Set<string>();

type AnswerFields = Pick<
  AskTurn,
  "status" | "answer" | "sources" | "disclaimer" | "resolvedMode" | "followups" | "errorMessage"
>;

function answerFields(result: AskResult): AnswerFields {
  return result.sources.length > 0
    ? {
        status: "answered",
        answer: result.answer,
        sources: result.sources,
        disclaimer: result.disclaimer,
        resolvedMode: result.resolvedMode,
        followups: result.followups,
      }
    : {
        status: "no-sources",
        answer: "",
        sources: [],
        disclaimer: result.disclaimer,
        resolvedMode: result.resolvedMode,
      };
}

function AskMissing() {
  return (
    <section className="col col--read">
      <div className="empty">
        <span className="empty__ic">
          <MessageCircleQuestion size={26} aria-hidden="true" />
        </span>
        <h2 className="empty__title">질문을 찾을 수 없어요</h2>
        <p className="empty__body">질문과 답은 이 기기에만 저장돼요. 다른 기기에서는 보이지 않아요.</p>
        <Link className="btn btn-line ql-empty__cta" href="/hoondok/ask">
          질문 목록으로
        </Link>
      </div>
    </section>
  );
}

/** 답을 기다리는 카드 — 회전 1종(1.2s)으로 진행 중임을 알리고 그만둘 길을 함께 둔다 (DES §1.5) */
function AskWaiting({ onStop }: { onStop: () => void }) {
  return (
    <div className="ask-wait" role="status" aria-busy="true">
      {/* 부엉이는 메시지 위에 쌓는다 — 스피너·부엉이·문장이 한 줄에 서면 390px 에서 문장이 끊긴다 */}
      <HoondokMascot pose="search" size={56} motion="breathe" />
      <p className="ask-wait__msg">
        <span className="ask-spinner" aria-hidden="true" />
        근거 말씀을 찾고 있어요. 잠시만 기다려 주세요.
      </p>
      {isHoondokMascotEnabled() && <p className="ask-wait__sub">찾은 말씀 안에서만 설명해요.</p>}
      <HoondokButton variant="line" isSmall onClick={onStop}>
        그만두기
      </HoondokButton>
    </div>
  );
}

function AskFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card ask-fail" role="status">
      <p className="ask-fail__msg">{message}</p>
      <HoondokButton variant="line" isSmall onClick={onRetry}>
        다시 시도
      </HoondokButton>
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

/** 공개 신청 — 공개를 골랐고 첫 답이 근거와 함께 끝났을 때 한 번. 마음 돌봄 답은 신청하지 않는다. */
function usePublicSubmission(item: AskItem | null, isLoggedIn: boolean) {
  const queryClient = useQueryClient();
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const id = item?.id;
  const shouldSubmit =
    item?.visibility === "public" &&
    item.status === "answered" &&
    Boolean(item.messageId) &&
    !item.publicId &&
    !item.publicStatus &&
    isLoggedIn;
  const messageId = item?.messageId;
  const resolvedMode = item?.resolvedMode;

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryTick 은 "다시 신청" 을 눌렀을 때 같은 조건으로 다시 돌리는 신호다
  useEffect(() => {
    if (!shouldSubmit || !id || !messageId) return;
    if (resolvedMode === "pastoral") {
      updateAskItem(id, { publicStatus: "blocked" });
      return;
    }
    if (submitting.has(id)) return;
    submitting.add(id);
    void publicQuestionsAPI
      .submit(messageId)
      .then((created) => {
        updateAskItem(id, { publicId: created.id, publicStatus: created.status });
        setFailedAt(null);
        // 상태 새로 고침이 신청 전 목록으로 "서버에 없음" 을 판정하지 않게 한다
        void queryClient.invalidateQueries({ queryKey: MY_QUESTIONS_KEY });
      })
      .catch((error: unknown) => {
        // 409 = 공개할 수 없는 답(위기·근거 없음·이어 물은 답) 또는 남이 이미 신청한 답.
        // 본인 재신청(응답 유실 뒤 다시 신청)은 서버가 기존 신청을 201 로 돌려줘 여기 오지 않는다.
        if (error instanceof ApiError && error.status === 409) updateAskItem(id, { publicStatus: "blocked" });
        else setFailedAt(id);
      })
      .finally(() => submitting.delete(id));
  }, [shouldSubmit, id, messageId, resolvedMode, retryTick, queryClient]);

  return {
    hasFailed: failedAt !== null && failedAt === id && shouldSubmit,
    retry: () => {
      setFailedAt(null);
      setRetryTick((tick) => tick + 1);
    },
  };
}

/** 신청 상태를 서버에서 다시 읽는다 — 검토 중은 공개됨·숨김으로, 공개됨도 나중에 숨김으로 바뀔 수 있다. */
function usePublicStatusRefresh(item: AskItem | null, isLoggedIn: boolean) {
  const shouldCheck =
    Boolean(item?.publicId) && (item?.publicStatus === "pending" || item?.publicStatus === "published") && isLoggedIn;
  const mine = useQuery({
    queryKey: MY_QUESTIONS_KEY,
    queryFn: publicQuestionsAPI.mine,
    enabled: shouldCheck,
    retry: false,
  });
  const id = item?.id;
  const publicId = item?.publicId;
  const publicStatus = item?.publicStatus;
  // 이 화면에 들어온 뒤 새로 받은 목록만 믿는다 — 캐시에 남은 옛 목록으로 "없음" 을 판정하지 않는다.
  const isFresh = mine.isFetchedAfterMount && !mine.isFetching;
  useEffect(() => {
    if (!id || !publicId || !mine.data || !isFresh) return;
    const found = mine.data.items.find((entry) => entry.id === publicId);
    // 다른 기기에서 내렸으면 기기 표시도 비공개로 맞춘다(다시 자동 신청하지 않게 visibility 도 바꾼다)
    if (!found) updateAskItem(id, { publicId: undefined, publicStatus: undefined, visibility: "private" });
    else if (found.status !== publicStatus) updateAskItem(id, { publicStatus: found.status });
  }, [id, publicId, publicStatus, mine.data, isFresh]);
}

export function AskDetail({ id }: { id: string }) {
  const router = useRouter();
  const items = useSyncExternalStore(subscribeAsk, readAskItems, () => EMPTY_ASK_ITEMS as AskItem[]);
  // 저장소는 hydration 뒤에야 읽힌다 — 그 전에 "없는 질문" 화면이 번쩍이지 않게 한 번만 기다린다.
  const isMounted = useSyncExternalStore(
    subscribeAsk,
    () => true,
    () => false,
  );
  const { user } = useCurrentUser();
  const isLoggedIn = Boolean(user);
  const [shareTick, setShareTick] = useState(0);
  const [isModeSheetOpen, setIsModeSheetOpen] = useState(false);
  const [followup, setFollowup] = useState("");
  const [withdrawError, setWithdrawError] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const followupRef = useRef<HTMLInputElement>(null);
  const lastTurnRef = useRef<HTMLElement>(null);
  const turnCountRef = useRef<number | null>(null);
  // 진행 중인 요청 — "그만두기" 가 끊을 수 있어야 하므로 effect 밖에서도 잡힌다.
  const abortRef = useRef<AbortController | null>(null);
  const item = items.find((candidate) => candidate.id === id) ?? null;
  const turns = item?.turns ?? [];

  // 지금 답을 받아야 할 자리: 첫 질문이 먼저, 그다음 이어서 한 턴 중 기다리는 것.
  const pendingTurn = item?.status === "pending" ? undefined : turns.find((turn) => turn.status === "pending");
  const targetQuestion = item?.status === "pending" ? item.question : pendingTurn?.question;
  const targetTurnId = pendingTurn?.id ?? null;
  const answerMode = item?.answerMode;
  const sessionId = item?.sessionId;
  const isBusy = targetQuestion !== undefined;
  const hasAnswered = item?.status === "answered" || turns.some((turn) => turn.status === "answered");
  const original = useOriginalLink(hasAnswered);
  const submission = usePublicSubmission(item, isLoggedIn);
  usePublicStatusRefresh(item, isLoggedIn);

  // 답을 아직 받지 않은 자리만 요청한다. 화면을 떠나면 중단하고 저장소를 건드리지 않는다.
  useEffect(() => {
    if (targetQuestion === undefined) return;
    const controller = new AbortController();
    abortRef.current = controller;
    let isCancelled = false;
    void (async () => {
      try {
        const result = await requestAsk(targetQuestion, {
          answerMode,
          // 첫 질문은 새 대화, 이어서 한 질문만 세션을 잇는다
          sessionId: targetTurnId ? sessionId : undefined,
          signal: controller.signal,
        });
        if (isCancelled) return;
        if (targetTurnId) {
          const current = readAskItem(id);
          updateAskItem(id, {
            sessionId: result.sessionId,
            turns: (current?.turns ?? []).map((turn) =>
              turn.id === targetTurnId ? { ...turn, ...answerFields(result), errorMessage: undefined } : turn,
            ),
          });
        } else {
          updateAskItem(id, { ...answerFields(result), sessionId: result.sessionId, messageId: result.messageId });
        }
      } catch (error) {
        if (isCancelled || controller.signal.aborted) return;
        const patch = { status: "error" as const, errorMessage: askErrorMessage(error) };
        if (targetTurnId) updateAskTurn(id, targetTurnId, patch);
        else updateAskItem(id, patch);
      }
    })();
    return () => {
      isCancelled = true;
      controller.abort();
      abortRef.current = null;
    };
  }, [id, targetQuestion, targetTurnId, answerMode, sessionId]);

  useEffect(() => {
    if (shareTick === 0) return;
    const timer = window.setTimeout(() => setShareTick(0), SHARE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [shareTick]);

  // 이어서 질문을 보내면 새 턴으로 내려간다. 처음 열 때(기존 턴)는 움직이지 않는다.
  useEffect(() => {
    if (turnCountRef.current !== null && turns.length > turnCountRef.current) {
      lastTurnRef.current?.scrollIntoView({ block: "start" });
    }
    turnCountRef.current = turns.length;
  }, [turns.length]);

  if (!item) return isMounted ? <AskMissing /> : <section className="col col--read" />;

  const sources = item.sources ?? [];
  const keySource = sources[0];
  const lastAnswered = [...turns].reverse().find((turn) => turn.status === "answered");
  const followups = (lastAnswered ? lastAnswered.followups : item.followups) ?? [];
  const related = followups.length > 0 ? followups : FOLLOWUPS;
  const modeInfo = item.resolvedMode ? answerModeInfo(item.resolvedMode) : null;
  const ModeIcon = modeInfo?.icon;
  const isAnswered = item.status === "answered";
  const canFollowUp = Boolean(item.sessionId) && item.status !== "pending";

  // 중단은 요청을 끊고 저장소 상태도 직접 적는다 — effect 의 catch 는 abort 를 무시하기 때문이다.
  function handleStop() {
    abortRef.current?.abort();
    const patch = { status: "error" as const, errorMessage: STOPPED_MESSAGE };
    if (targetTurnId) updateAskTurn(id, targetTurnId, patch);
    else updateAskItem(id, patch);
  }

  /** 같은 질문을 (다른) 모델로 새로 묻는다 — 새 항목이라 공개 신청은 따라가지 않는다. */
  function askAgain(choice: AnswerChoice | undefined) {
    if (!item) return;
    const nextId = newAskId();
    appendAskItem({
      id: nextId,
      question: item.question,
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(choice && choice !== "auto" ? { answerMode: choice } : {}),
    });
    router.push(`/hoondok/ask/${nextId}`);
  }

  function handleFollowup(event: React.FormEvent) {
    event.preventDefault();
    const text = followup.trim();
    if (!text || !canFollowUp || isBusy) return;
    appendAskTurn(id, { id: newAskId(), question: text, status: "pending", createdAt: new Date().toISOString() });
    setFollowup("");
  }

  async function handleShare() {
    if (!item) return;
    const text = `${item.question}\n\n${item.answer ?? ""}`.trim();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: item.question, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setShareTick((tick) => tick + 1);
    } catch {
      // 사용자가 공유 시트를 닫았거나 클립보드 권한이 없으면 조용히 둔다
    }
  }

  async function handleWithdraw() {
    if (!item?.publicId) return;
    setIsWithdrawing(true);
    setWithdrawError(false);
    try {
      await publicQuestionsAPI.remove(item.publicId);
      updateAskItem(id, { publicId: undefined, publicStatus: undefined, visibility: "private" });
    } catch (error) {
      // 이미 지워졌으면(404) 기기 표시만 맞춘다
      if (error instanceof ApiError && error.status === 404)
        updateAskItem(id, { publicId: undefined, publicStatus: undefined, visibility: "private" });
      else setWithdrawError(true);
    } finally {
      setIsWithdrawing(false);
    }
  }

  return (
    <section className={`col col--read ask-detail${canFollowUp ? " ask-detail--follow" : ""}`}>
      <h2 className="ask-q">{item.question}</h2>
      <div className="ask-q__meta">
        <span className="ask-q__date">{askFullDate(item.createdAt)}</span>
        {item.isSaved && <span className="badge">저장됨</span>}
        {item.publicStatus && (
          <span className={`badge ${item.publicStatus === "published" ? "badge--accent" : "badge--line"}`}>
            {PUBLIC_STATUS_LABEL[item.publicStatus]}
          </span>
        )}
      </div>

      {isAnswered && modeInfo && ModeIcon && (
        <div className="card ask-model">
          <p className="ask-model__k">
            {!item.answerMode
              ? "자동으로 골랐어요"
              : item.answerMode === item.resolvedMode
                ? "이 모델이 답변했어요"
                : "질문에 맞춰 다른 모델이 답했어요"}
          </p>
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
              onClick={() => setIsModeSheetOpen(true)}
            >
              변경
            </button>
          </div>
        </div>
      )}

      {item.status === "pending" && <AskWaiting onStop={handleStop} />}
      {item.status === "error" && (
        <AskFailed
          message={item.errorMessage ?? askErrorMessage(null)}
          onRetry={() => updateAskItem(id, { status: "pending", errorMessage: undefined })}
        />
      )}
      {item.status === "no-sources" && <AskNoSources />}
      {item.status === "no-sources" && (
        <div className="sect">
          {item.visibility === "public" && <p className="ask-public">근거를 찾지 못한 답은 공개하지 않아요.</p>}
          <div className="ask-acts">
            <HoondokButton variant="line" isSmall onClick={() => askAgain(item.answerMode)}>
              <RotateCcw size={18} aria-hidden="true" />
              다시 묻기
            </HoondokButton>
          </div>
        </div>
      )}

      {item.status === "answered" && (
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
            <AnswerNote answer={item.answer ?? ""} sources={sources} disclaimer={item.disclaimer} />
          </div>

          <div className="sect">
            <div className="sect__head">
              <h3 className="sect__title">{`근거 말씀 ${sources.length}`}</h3>
              <span className="sect__meta">원문 공개 권한 확인 후 열기</span>
            </div>
            <EvidenceList sources={sources} original={original} />
          </div>
        </>
      )}

      {isAnswered && (
        <div className="sect">
          <div className="ask-acts">
            <button
              className="btn btn-line btn--sm"
              type="button"
              aria-pressed={Boolean(item.isSaved)}
              aria-label="이 질문 저장"
              onClick={() => toggleAskSaved(id)}
            >
              <Star size={18} aria-hidden="true" fill={item.isSaved ? "currentColor" : "none"} />
              {item.isSaved ? "저장됨" : "저장"}
            </button>
            <HoondokButton variant="line" isSmall onClick={handleShare}>
              <Share2 size={18} aria-hidden="true" />
              공유
            </HoondokButton>
            <HoondokButton variant="line" isSmall onClick={() => askAgain(item.answerMode)}>
              <RotateCcw size={18} aria-hidden="true" />
              다시 묻기
            </HoondokButton>
          </div>
          <p className="hint ask-saved-note">
            <span>이 기기에 저장돼요</span>
            <span aria-live="polite" data-testid="ask-share-status">
              {shareTick > 0 ? "복사했어요" : ""}
            </span>
          </p>
          <PublicNotice
            item={item}
            isLoggedIn={isLoggedIn}
            hasFailed={submission.hasFailed}
            onRetry={submission.retry}
            onWithdraw={handleWithdraw}
            isWithdrawing={isWithdrawing}
            withdrawError={withdrawError}
          />
        </div>
      )}

      {turns.map((turn, index) => (
        <section
          key={turn.id}
          ref={index === turns.length - 1 ? lastTurnRef : undefined}
          className="ask-turn"
          aria-label="이어서 한 질문"
        >
          <p className="ask-turn__q">{turn.question}</p>
          {turn.status === "pending" && <AskWaiting onStop={handleStop} />}
          {turn.status === "error" && (
            <AskFailed
              message={turn.errorMessage ?? askErrorMessage(null)}
              onRetry={() => updateAskTurn(id, turn.id, { status: "pending", errorMessage: undefined })}
            />
          )}
          {turn.status === "no-sources" && <AskNoSources />}
          {turn.status === "answered" && (
            <>
              {turn.resolvedMode && (
                <p className="ask-turn__by">{answeredByLabel(turn.resolvedMode, "이어서 답했어요")}</p>
              )}
              <AnswerNote answer={turn.answer ?? ""} sources={turn.sources ?? []} disclaimer={turn.disclaimer} />
              <details className="ask-turn__ev">
                <summary>{`근거 말씀 ${turn.sources?.length ?? 0}`}</summary>
                <EvidenceList sources={turn.sources ?? []} original={original} />
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
          <div className="ask-follow__in">
            <input
              ref={followupRef}
              className="ask-follow__field"
              type="text"
              aria-label="이어서 질문하기"
              placeholder="이어서 질문하기"
              enterKeyHint="send"
              value={followup}
              disabled={isBusy}
              onChange={(event) => setFollowup(event.target.value)}
            />
            <button
              className="ask-follow__send"
              type="submit"
              aria-label="이어서 질문 보내기"
              disabled={isBusy || !followup.trim()}
            >
              <ArrowUp size={20} aria-hidden="true" />
            </button>
            <Link className="icon-btn ask-follow__new" href="/hoondok/ask/new" aria-label="새 질문">
              <PenLine size={20} aria-hidden="true" />
            </Link>
          </div>
        </form>
      )}

      {isModeSheetOpen && (
        <ModeSheet
          title="다른 모델로 다시 묻기"
          lede="같은 질문을 고른 모델로 새로 물어요. 지금 답은 내 질문에 그대로 남아요."
          confirmLabel="이 모델로 다시 묻기"
          value={item.answerMode ?? "auto"}
          onPick={(choice) => {
            setIsModeSheetOpen(false);
            if (choice !== (item.answerMode ?? "auto")) askAgain(choice);
          }}
          onClose={() => setIsModeSheetOpen(false)}
        />
      )}
    </section>
  );
}

function PublicNotice({
  item,
  isLoggedIn,
  hasFailed,
  onRetry,
  onWithdraw,
  isWithdrawing,
  withdrawError,
}: {
  item: AskItem;
  isLoggedIn: boolean;
  hasFailed: boolean;
  onRetry: () => void;
  onWithdraw: () => void;
  isWithdrawing: boolean;
  withdrawError: boolean;
}) {
  if (item.visibility !== "public" || item.status !== "answered") return null;
  if (item.publicStatus === "blocked") {
    return (
      <p className="ask-public" role="status">
        {BLOCKED_MESSAGE}
      </p>
    );
  }
  if (item.publicId) {
    return (
      <div className="ask-public">
        <p>
          {item.publicStatus === "published"
            ? "추천 목록에 이름 없이 올라가 있어요."
            : item.publicStatus === "hidden"
              ? "협회가 확인한 뒤 공개하지 않기로 했어요."
              : "협회가 확인한 뒤 추천 목록에 올라가요."}
        </p>
        <HoondokButton variant="line" isSmall isLoading={isWithdrawing} onClick={onWithdraw}>
          공개 신청 내리기
        </HoondokButton>
        {withdrawError && <p role="status">내리지 못했어요. 잠시 뒤 다시 해 주세요.</p>}
      </div>
    );
  }
  if (!isLoggedIn) {
    return (
      <div className="ask-public">
        <p>공개 신청은 훈독 로그인 뒤에 할 수 있어요.</p>
        <Link className="btn btn-line btn--sm" href={onboardingHref(`/hoondok/ask/${item.id}`)}>
          로그인하고 공개하기
        </Link>
      </div>
    );
  }
  if (hasFailed) {
    return (
      <div className="ask-public" role="status">
        <p>공개 신청을 보내지 못했어요.</p>
        <HoondokButton variant="line" isSmall onClick={onRetry}>
          다시 신청
        </HoondokButton>
      </div>
    );
  }
  return (
    <p className="ask-public" role="status" aria-busy="true">
      공개 신청을 보내고 있어요
    </p>
  );
}
