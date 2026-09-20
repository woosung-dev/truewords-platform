"use client";

// SCR-PWA-005 묻기 홈("물음 한 장") — 오늘 말씀 한 줄 + 라벨 있는 입력 + 시작 문장 3개.
// FAB·세그먼트는 없다(DES-PWA-003 §2.9 2026-09-16 정정). 시작 문장은 입력을 채울 뿐 보내지 않는다(AC-017-03).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { type AskItem, appendAskItem, EMPTY_ASK_ITEMS, newAskId, readAskItems, subscribeAsk } from "../storage";

/** 오늘 읽은 말씀 한 줄. 편성이 없으면 null 이라 줄 자체를 그리지 않는다. */
export type AskTodayLine = { title: string; source: string };

// 프로토타입 `data-screen="ask"` 의 문구 그대로.
const HELP = "근거 말씀을 인용해서 답해요. 근거가 없으면 확인할 수 없다고 말해요.";
const PLACEHOLDER = "말씀이나 신앙 생활에 대해 편하게 적어 주세요";
const STARTERS = [
  "참사랑이 직단거리로 간다는 말씀은 무슨 뜻인가요?",
  "정성을 드린다는 게 정확히 뭘 하는 건가요?",
  "자녀에게 말씀을 어떻게 가르치면 좋을까요?",
] as const;

function AskComposer({ today, initialQuestion }: { today: AskTodayLine | null; initialQuestion: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion);
  // 목록 수는 기기 저장소가 원본이다. 서버 스냅샷이 빈 배열이라 SSR 과 첫 렌더가 같다(TodayNote 와 같은 패턴).
  const items = useSyncExternalStore(subscribeAsk, readAskItems, () => EMPTY_ASK_ITEMS as AskItem[]);
  const savedCount = items.filter((item) => item.isSaved).length;
  const text = question.trim();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!text) return;
    // 답은 상세 화면이 받아 온다 — 여기서는 질문만 남기고 이동한다(새로고침·뒤로가기에도 질문이 남는다).
    const id = newAskId();
    appendAskItem({ id, question: text, status: "pending", createdAt: new Date().toISOString() });
    router.push(`/hoondok/ask/${id}`);
  }

  return (
    <section className="col col--read">
      {today && (
        <p className="qs-today">
          <span className="qs-today__k">오늘 읽은 말씀</span>
          <span className="qs-today__v">{today.title}</span>
          <span className="qs-today__src">{today.source}</span>
        </p>
      )}

      <form className="qs-form" onSubmit={handleSubmit}>
        <label className="qs-label" htmlFor="qs-input">
          무엇이 궁금하세요?
        </label>
        <textarea
          id="qs-input"
          className="qs-input"
          rows={4}
          placeholder={PLACEHOLDER}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <p className="qs-help">{HELP}</p>
        <HoondokButton type="submit" disabled={!text}>
          물어보기
        </HoondokButton>
      </form>

      <div className="qs-starters">
        <p className="qs-starters__k">이렇게 물어볼 수 있어요</p>
        {STARTERS.map((starter) => (
          <button key={starter} className="chip-btn qs-starter" type="button" onClick={() => setQuestion(starter)}>
            {starter}
          </button>
        ))}
      </div>

      <Link className="qs-log" href="/hoondok/ask/log">
        {`내 질문 ${items.length}개와 저장한 답 ${savedCount}개 보기`}
      </Link>
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}

function AskComposerWithQuery({ today }: { today: AskTodayLine | null }) {
  // 이어 묻기 칩·훈독하기 버튼이 `?q=` 로 문장을 넘긴다. 채우기만 하고 보내지는 않는다.
  return <AskComposer today={today} initialQuestion={useSearchParams().get("q") ?? ""} />;
}

export function AskHome({ today }: { today: AskTodayLine | null }) {
  return (
    <Suspense fallback={<AskComposer today={today} initialQuestion="" />}>
      <AskComposerWithQuery today={today} />
    </Suspense>
  );
}
