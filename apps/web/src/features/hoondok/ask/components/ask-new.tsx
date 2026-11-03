"use client";

// 새 질문하기 (전체 화면). "+ 질문하기"·말씀 단락의 "이 단락으로 질문하기"·훈독 완료 링크로만 열린다.
// 답변 모델(기본 자동)과 공개 여부(기본 비공개)를 고르고 보낸다. 답은 상세 화면이 받아 온다.
// 공개는 훈독 로그인이 필요하다 — 신청자만 내릴 수 있어야 하므로(작성자는 드러나지 않는다).
import { ChevronDown, ChevronRight, Globe, Lock, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ReaderSheet } from "@/features/hoondok/library/components/reader-sheet";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { ANSWER_CHOICES, type AnswerChoice, answerModeInfo } from "../modes";
import { type AskVisibility, appendAskItem, newAskId } from "../storage";
import { ModeSheet } from "./mode-sheet";

const HELP =
  "훈독 AI는 협회 말씀 자료 안에서만 근거를 찾아 답합니다. 근거를 찾지 못하면 답하지 않습니다. 교리 판정이나 위기 상황은 전문 상담을 안내합니다.";
const PLACEHOLDER = "말씀이나 신앙 생활에 대해 편하게 적어 주세요";

const VISIBILITY_LABEL: Record<AskVisibility, string> = {
  public: "공개하고 함께 나누기",
  private: "비공개로 보관하기",
};

type Sheet = "mode" | "visibility" | null;

type AskNewInitial = { question: string; choice: AnswerChoice; visibility: AskVisibility };
const EMPTY_INITIAL: AskNewInitial = { question: "", choice: "auto", visibility: "private" };

function parseChoice(raw: string | null): AnswerChoice {
  return ANSWER_CHOICES.find((info) => info.id === raw)?.id ?? "auto";
}

function AskNewForm({ initial }: { initial: AskNewInitial }) {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();
  const [question, setQuestion] = useState(initial.question);
  const [choice, setChoice] = useState<AnswerChoice>(initial.choice);
  // 로그인에서 돌아온 공개 선택도 여기서 이어진다 — 로그인 전이면 아래 canPublish 가 비공개로 보인다
  const [visibility, setVisibility] = useState<AskVisibility>(initial.visibility);
  const [sheet, setSheet] = useState<Sheet>(null);
  const text = question.trim();
  const mode = answerModeInfo(choice);
  const ModeIcon = mode.icon;
  // 마음 돌봄 답은 서버가 공개를 거절한다(409) — 고르는 단계에서 미리 막는다.
  const isPastoral = choice === "pastoral";
  const canPublish = Boolean(user) && !isPastoral;
  const shownVisibility: AskVisibility = visibility === "public" && canPublish ? "public" : "private";
  // 로그인 뒤 돌아와도 고른 모델·공개 선택이 남게 주소에 싣는다
  const returnParams = new URLSearchParams();
  if (text) returnParams.set("q", text);
  if (choice !== "auto") returnParams.set("mode", choice);
  returnParams.set("visibility", "public");
  const loginHref = onboardingHref(`/hoondok/ask/new?${returnParams.toString()}`);

  // 말씀 단락·훈독 완료에서 열었으면 그 자리로 돌아간다. 바로 열린 화면이면 AI 질문 홈으로.
  function handleClose() {
    if (window.history.length > 1) router.back();
    else router.push("/hoondok/ask");
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!text) return;
    const id = newAskId();
    appendAskItem({
      id,
      question: text,
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(choice === "auto" ? {} : { answerMode: choice }),
      visibility: shownVisibility,
    });
    // 새 질문 화면은 기록에 남기지 않는다 — 답에서 뒤로 가면 목록으로 돌아간다
    router.replace(`/hoondok/ask/${id}`);
  }

  return (
    <form className="col col--read ask-new" onSubmit={handleSubmit}>
      <div className="ask-new__bar">
        <button className="icon-btn" type="button" aria-label="닫기" onClick={handleClose}>
          <X size={22} aria-hidden="true" />
        </button>
        <h2 className="ask-new__title">새 질문하기</h2>
        <button className="btn btn-primary btn--sm" type="submit" disabled={!text}>
          보내기
        </button>
      </div>

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
        aria-describedby="ask-new-help"
        rows={6}
        placeholder={PLACEHOLDER}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
      />

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
            <label className="ask-opt" aria-disabled={!canPublish || undefined}>
              <input
                className="ask-opt__in"
                type="radio"
                name="ask-visibility"
                value="public"
                checked={visibility === "public" && canPublish}
                disabled={!canPublish}
                aria-describedby="ask-vis-public"
                onChange={() => setVisibility("public")}
              />
              <span className="ask-opt__ic" aria-hidden="true">
                <Globe size={20} />
              </span>
              <span className="ask-opt__bd">
                <b>{VISIBILITY_LABEL.public}</b>
                <span id="ask-vis-public">
                  이름은 드러나지 않아요. 협회가 확인한 뒤 추천 목록에 올라가요. 언제든 내릴 수 있어요.
                </span>
              </span>
            </label>
            <label className="ask-opt">
              <input
                className="ask-opt__in"
                type="radio"
                name="ask-visibility"
                value="private"
                checked={visibility === "private" || !canPublish}
                onChange={() => setVisibility("private")}
              />
              <span className="ask-opt__ic" aria-hidden="true">
                <Lock size={20} />
              </span>
              <span className="ask-opt__bd">
                <b>{VISIBILITY_LABEL.private}</b>
                <span>이 기기에서 나만 볼 수 있어요</span>
              </span>
            </label>
          </div>
          {isPastoral ? (
            <p className="ask-opts__gate">마음 돌봄으로 답하는 질문은 공개하지 않아요.</p>
          ) : (
            !user &&
            !isLoading && (
              <>
                <p className="ask-opts__gate">공개하려면 훈독 로그인이 필요해요.</p>
                <Link className="btn btn-line btn--sm ask-opts__login" href={loginHref}>
                  로그인하고 공개하기
                </Link>
              </>
            )
          )}
        </ReaderSheet>
      )}
    </form>
  );
}

function AskNewWithQuery() {
  // 말씀 단락·훈독 완료·검색 "이 말로 새로 묻기" 가 `?q=` 로 문장을 넘긴다. 채우기만 하고 보내지는 않는다.
  // `mode`·`visibility` 는 로그인하고 공개하기에서 돌아올 때만 붙는다.
  const params = useSearchParams();
  return (
    <AskNewForm
      initial={{
        question: params.get("q") ?? "",
        choice: parseChoice(params.get("mode")),
        visibility: params.get("visibility") === "public" ? "public" : "private",
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
