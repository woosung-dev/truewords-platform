"use client";

// 새 질문하기 (전체 화면). "+ 질문하기"·예시 질문·말씀 단락의 "이 단락으로 질문하기"·훈독 완료 링크로만 열린다.
// 질문은 훈독 로그인이 필요하다(DEC-PWA-025 2차) — 로그인 전이면 안내를 보이고, 로그인에서 돌아오면 문장·모델이 그대로다.
// 답변 모델(기본 자동)과 공개 여부(기본 비공개)를 고르고 보낸다. 보내기를 누르는 순간 요청을 시작하고(하루 1회 차감)
// 상세 화면이 그 진행을 이어 보여 준다.
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Globe, Lock, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { canGoBackInApp } from "@/features/hoondok/nav-history";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { ASK_QUESTION_MAX, askLength } from "../ask-stream";
import { ASKS_KEY } from "../asks-api";
import { useClearLegacyAskItems } from "../legacy";
import { startLiveAsk } from "../live";
import { ANSWER_CHOICES, type AnswerChoice, answerModeInfo } from "../modes";
import { AskLoginGate, AskQuotaNote, useAskQuota } from "./ask-gate";
import { ModeSheet } from "./mode-sheet";

const HELP =
  "훈독 AI는 협회 말씀 자료 안에서만 근거를 찾아 답합니다. 근거를 찾지 못하면 답하지 않습니다. 교리 판정이나 위기 상황은 전문 상담을 안내합니다.";
const PLACEHOLDER = "말씀이나 신앙 생활에 대해 편하게 적어 주세요";

type AskVisibility = "private" | "public";

const VISIBILITY_LABEL: Record<AskVisibility, string> = {
  public: "공개하고 함께 나누기",
  private: "비공개로 보관하기",
};

type Sheet = "mode" | "visibility" | null;

type AskNewInitial = { question: string; choice: AnswerChoice; isResume?: boolean };
const EMPTY_INITIAL: AskNewInitial = { question: "", choice: "auto" };

// 로그인하러 가는 동안 쓰던 문장을 이 탭에만 잠깐 둔다. 주소(returnTo)에 싣지 않는다 — 질문 원문이 방문 기록·주소창
// 자동완성·Referer·웹 서버 접근 로그에 남지 않게. 돌아오면 읽고 바로 지운다.
const DRAFT_KEY = "hoondok:ask-draft";

export function keepDraft(text: string): void {
  try {
    if (text) window.sessionStorage.setItem(DRAFT_KEY, text);
    else window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // 사생활 모드·차단 — 돌아와서 다시 적으면 된다
  }
}

function takeDraft(): string {
  try {
    const text = window.sessionStorage.getItem(DRAFT_KEY) ?? "";
    window.sessionStorage.removeItem(DRAFT_KEY);
    return text;
  } catch {
    return "";
  }
}

function parseChoice(raw: string | null): AnswerChoice {
  return ANSWER_CHOICES.find((info) => info.id === raw)?.id ?? "auto";
}

/** 로그인 뒤 같은 모델로 돌아올 주소. 문장은 주소에 싣지 않고 이 탭의 sessionStorage 로 넘긴다(keepDraft). */
export function askNewReturnHref(choice: AnswerChoice): string {
  const params = new URLSearchParams({ resume: "1" });
  if (choice !== "auto") params.set("mode", choice);
  return `/ask/new?${params.toString()}`;
}

function AskNewBar({ onClose, canSend }: { onClose: () => void; canSend?: boolean }) {
  return (
    <div className="ask-new__bar">
      <button className="icon-btn" type="button" aria-label="닫기" onClick={onClose}>
        <X size={22} aria-hidden="true" />
      </button>
      <h2 className="ask-new__title">새 질문하기</h2>
      {canSend !== undefined && (
        <button className="btn btn-primary btn--sm" type="submit" disabled={!canSend}>
          보내기
        </button>
      )}
    </div>
  );
}

function AskNewForm({ initial }: { initial: AskNewInitial }) {
  useClearLegacyAskItems();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isLoading } = useCurrentUser();
  const quota = useAskQuota(Boolean(user));
  const [question, setQuestion] = useState(initial.question);
  const [choice, setChoice] = useState<AnswerChoice>(initial.choice);
  const [visibility, setVisibility] = useState<AskVisibility>("private");
  const [sheet, setSheet] = useState<Sheet>(null);
  const text = question.trim();
  const length = askLength(question);
  const isTooLong = length > ASK_QUESTION_MAX;
  const mode = answerModeInfo(choice);
  const ModeIcon = mode.icon;
  // 마음 돌봄 답은 서버가 공개를 거절한다(409) — 고르는 단계에서 미리 막는다.
  const isPastoral = choice === "pastoral";
  const shownVisibility: AskVisibility = visibility === "public" && !isPastoral ? "public" : "private";
  const canSend = Boolean(user) && Boolean(text) && !isTooLong && !quota.isExhausted;
  const isGate = !user && !isLoading;

  // 로그인에서 돌아왔으면 맡겨 둔 문장을 되찾는다(서버 렌더와 어긋나지 않게 마운트 뒤에 읽는다)
  useEffect(() => {
    if (!initial.isResume) return;
    const draft = takeDraft();
    if (draft) setQuestion((current) => current || draft);
  }, [initial.isResume]);

  // 로그인 안내를 보는 동안의 문장을 맡겨 둔다
  useEffect(() => {
    if (isGate) keepDraft(text);
  }, [isGate, text]);

  // 말씀 단락·훈독 완료에서 열었으면 그 자리로 돌아간다. 이 탭에서 바로 연 화면이면(앱 안 앞 기록 없음) AI 질문 홈으로.
  function handleClose() {
    if (canGoBackInApp()) router.back();
    else router.push("/ask");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend || !user) return;
    const key = startLiveAsk(
      {
        ownerId: user.id,
        question: text,
        answerMode: choice === "auto" ? undefined : choice,
        wantsPublic: shownVisibility === "public",
      },
      () => void queryClient.invalidateQueries({ queryKey: ASKS_KEY }),
    );
    // 새 질문 화면은 기록에 남기지 않는다 — 답에서 뒤로 가면 이 화면을 연 자리로 돌아간다
    router.replace(`/ask/${key}`);
  }

  if (isGate) {
    return (
      <section className="col col--read ask-new">
        <AskNewBar onClose={handleClose} />
        <AskLoginGate
          title="질문하려면 로그인이 필요해요"
          body="AI 질문은 훈독에 로그인한 분만 하루 5번까지 할 수 있어요. 질문과 답은 내 계정에만 보관돼요."
          quote={text || undefined}
          returnTo={askNewReturnHref(choice)}
          replace
        />
      </section>
    );
  }

  return (
    <form className="col col--read ask-new" onSubmit={handleSubmit}>
      <AskNewBar onClose={handleClose} canSend={canSend} />

      <button
        className="ask-pick"
        type="button"
        aria-haspopup="dialog"
        aria-label={`답변 모델: ${mode.label}`}
        onClick={() => setSheet("mode")}
      >
        <span className="ask-pick__ic" aria-hidden="true">
          <ModeIcon size={20} />
        </span>
        <span className="ask-pick__bd">
          <span className="ask-pick__k">답변 모델</span>
          <b>{mode.label}</b>
        </span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>

      <label className="qs-label ask-new__label" htmlFor="ask-new-input">
        무엇이 궁금하세요?
      </label>
      <textarea
        id="ask-new-input"
        className="qs-input ask-new__input"
        aria-describedby="ask-new-count ask-new-help"
        aria-invalid={isTooLong || undefined}
        rows={6}
        placeholder={PLACEHOLDER}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />
      <p id="ask-new-count" className={`ask-count${isTooLong ? " ask-count--over" : ""}`}>
        {isTooLong
          ? `${ASK_QUESTION_MAX}자까지 보낼 수 있어요 (${length}/${ASK_QUESTION_MAX})`
          : `${length}/${ASK_QUESTION_MAX}`}
      </p>

      <button
        className="ask-line"
        type="button"
        aria-haspopup="dialog"
        aria-label={`공개 여부: ${VISIBILITY_LABEL[shownVisibility]}`}
        onClick={() => setSheet("visibility")}
      >
        <span className="ask-line__k">공개 여부</span>
        <span className="ask-line__v">{VISIBILITY_LABEL[shownVisibility]}</span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>

      <AskQuotaNote remaining={quota.remaining} />

      <p id="ask-new-help" className="qs-help ask-new__help">
        {HELP}
      </p>

      {sheet === "mode" && (
        <ModeSheet
          value={choice}
          onPick={(next) => {
            setChoice(next);
            if (next === "pastoral") setVisibility("private");
            setSheet(null);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === "visibility" && (
        // 방향키도 change 를 일으키므로 고르는 즉시 닫지 않는다 — 고른 값은 바로 반영되고 "닫기"로 나간다.
        <ReaderSheet title="답변 공개 여부" onClose={() => setSheet(null)}>
          <div className="ask-opts" role="radiogroup" aria-label="답변 공개 여부">
            <label className="ask-opt" aria-disabled={isPastoral || undefined}>
              <input
                className="ask-opt__in"
                type="radio"
                name="ask-visibility"
                value="public"
                checked={shownVisibility === "public"}
                disabled={isPastoral}
                aria-describedby="ask-vis-public"
                onChange={() => setVisibility("public")}
              />
              <span className="ask-opt__ic" aria-hidden="true">
                <Globe size={20} />
              </span>
              <span className="ask-opt__bd">
                <b>{VISIBILITY_LABEL.public}</b>
                <span id="ask-vis-public">
                  이름은 드러나지 않아요. 관리자가 골라 추천 질문으로 올릴 수 있어요. 언제든 내릴 수 있어요.
                </span>
              </span>
            </label>
            <label className="ask-opt">
              <input
                className="ask-opt__in"
                type="radio"
                name="ask-visibility"
                value="private"
                checked={shownVisibility === "private"}
                onChange={() => setVisibility("private")}
              />
              <span className="ask-opt__ic" aria-hidden="true">
                <Lock size={20} />
              </span>
              <span className="ask-opt__bd">
                <b>{VISIBILITY_LABEL.private}</b>
                <span>내 계정에서만 볼 수 있어요</span>
              </span>
            </label>
          </div>
          {isPastoral && <p className="ask-opts__gate">마음 돌봄으로 답하는 질문은 공개하지 않아요.</p>}
        </ReaderSheet>
      )}
    </form>
  );
}

function AskNewWithQuery() {
  // 말씀 단락·훈독 완료·검색 "이 말로 새로 묻기" 가 `?q=` 로 문장을 넘긴다. 채우기만 하고 보내지는 않는다.
  // `mode`·`resume` 은 로그인 안내에서 돌아올 때만 붙는다(문장은 sessionStorage 로 돌아온다).
  const params = useSearchParams();
  return (
    <AskNewForm
      initial={{
        question: params.get("q") ?? "",
        choice: parseChoice(params.get("mode")),
        isResume: params.get("resume") === "1",
      }}
    />
  );
}

export function AskNew() {
  return (
    <Suspense fallback={<AskNewForm initial={EMPTY_INITIAL} />}>
      <AskNewWithQuery />
    </Suspense>
  );
}
