"use client";

// SCR-PWA-006 질문·답변 상세 — AI 설명 → 근거 말씀 → 이어서 물어보기 → 저장·공유.
// 근거 게이트(AC-017-01·04): sources 가 0건이면 답을 보이지 않고 "확인할 수 없음" 으로 끝낸다.
// 연관 말씀 섹션은 `/chat/stream` 이 주지 않는 데이터라 렌더하지 않는다(AC-017-02 — 지어내지 않는다).
import { CornerDownRight, MessageCircleQuestion, Share2, Sparkles, Sunrise } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { askErrorMessage, requestAsk } from "../ask-stream";
import { answerParagraphs, sourceLabel } from "../format";
import { type AskItem, EMPTY_ASK_ITEMS, readAskItems, subscribeAsk, toggleAskSaved, updateAskItem } from "../storage";

// 이어지는 질문은 답변·근거 맥락에서 제안해야 하지만(AC-017-03) `/chat/stream` 이 주는 suggested_followups 는
// 시연 챗 말투라 훈독 문장으로 고정한다 `[가정]`. 탭하면 묻기 홈을 채우기만 하고 보내지 않는다.
const FOLLOWUPS = ["이 말씀의 배경이 궁금해요", "오늘 어떻게 실천할 수 있나요", "비슷한 말씀이 더 있나요"] as const;

const GATE_MESSAGE = "근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요";
const SHARE_VISIBLE_MS = 2200;

function AskMissing() {
  return (
    <section className="col col--read">
      <div className="empty">
        <span className="empty__ic">
          <MessageCircleQuestion size={26} aria-hidden="true" />
        </span>
        <p className="empty__title">질문을 찾을 수 없어요</p>
        <p className="empty__body">질문과 답은 이 기기에만 저장돼요. 다른 기기에서는 보이지 않아요.</p>
        <Link className="btn btn-line ql-empty__cta" href="/hoondok/ask">
          질문하러 가기
        </Link>
      </div>
    </section>
  );
}

export function AskDetail({ id }: { id: string }) {
  const items = useSyncExternalStore(subscribeAsk, readAskItems, () => EMPTY_ASK_ITEMS as AskItem[]);
  // 저장소는 hydration 뒤에야 읽힌다 — 그 전에 "없는 질문" 화면이 번쩍이지 않게 한 번만 기다린다.
  // 서버 스냅샷(false)과 클라이언트 스냅샷(true)이 달라 마운트 직후 한 번 다시 그려진다.
  const isMounted = useSyncExternalStore(
    subscribeAsk,
    () => true,
    () => false,
  );
  const [shareTick, setShareTick] = useState(0);
  const item = items.find((candidate) => candidate.id === id) ?? null;
  const status = item?.status;
  const question = item?.question;

  // 답을 아직 받지 않은 질문만 요청한다. 화면을 떠나면 중단하고 저장소를 건드리지 않는다.
  useEffect(() => {
    if (status !== "pending" || !question) return;
    const controller = new AbortController();
    let isCancelled = false;
    void (async () => {
      try {
        const { answer, sources, disclaimer } = await requestAsk(question, controller.signal);
        if (isCancelled) return;
        updateAskItem(
          id,
          sources.length > 0
            ? { status: "answered", answer, sources, disclaimer }
            : { status: "no-sources", answer: "", sources: [], disclaimer },
        );
      } catch (error) {
        if (isCancelled || controller.signal.aborted) return;
        updateAskItem(id, { status: "error", errorMessage: askErrorMessage(error) });
      }
    })();
    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [id, status, question]);

  useEffect(() => {
    if (shareTick === 0) return;
    const timer = window.setTimeout(() => setShareTick(0), SHARE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [shareTick]);

  if (!item) return isMounted ? <AskMissing /> : <section className="col col--read" />;

  const sources = item.sources ?? [];
  const paragraphs = answerParagraphs(item.answer ?? "");

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

  return (
    <section className="col col--read">
      <h2 className="ask-q">{item.question}</h2>
      {(item.isSaved || item.status === "answered") && (
        <div className="ask-q__meta">
          {item.isSaved && <span className="badge">저장됨</span>}
          {item.status === "answered" && <span className="badge badge--line">{`근거 ${sources.length}`}</span>}
        </div>
      )}

      {item.status === "pending" && (
        <p className="ask-wait" role="status">
          근거 말씀을 찾고 있어요. 잠시만 기다려 주세요.
        </p>
      )}

      {item.status === "error" && (
        <div className="card ask-fail" role="status">
          <p className="ask-fail__msg">{item.errorMessage ?? askErrorMessage(null)}</p>
          <HoondokButton
            variant="line"
            isSmall
            onClick={() => updateAskItem(id, { status: "pending", errorMessage: undefined })}
          >
            다시 시도
          </HoondokButton>
        </div>
      )}

      {item.status === "no-sources" && (
        <div className="card ask-fail" role="status">
          <p className="ask-fail__msg">{GATE_MESSAGE}</p>
          <Link className="btn btn-line btn--sm" href="/hoondok/ask">
            다시 물어보기
          </Link>
        </div>
      )}

      {item.status === "answered" && (
        <>
          <div className="sect">
            <div className="sect__head">
              <h3 className="sect__title">AI 설명</h3>
              <span className="sect__meta">공식 해설 아님</span>
            </div>
            <div className="ai-note">
              <div className="ai-note__lab">
                <Sparkles size={14} aria-hidden="true" />
                AI 설명 · 공식 해설 아님
              </div>
              {paragraphs.map((paragraph, index) => (
                <p className="ai-note__body" key={paragraph.slice(0, 24)}>
                  {paragraph}
                  {/* 근거 번호는 답 끝에 한 번만 붙인다 `[가정]` — 문장 단위 인용 위치는 모델이 주지 않는다 */}
                  {index === paragraphs.length - 1 &&
                    sources.map((_, order) => (
                      <sup className="ask-ref" key={`ref-${order + 1}`}>
                        {order + 1}
                      </sup>
                    ))}
                </p>
              ))}
              {item.disclaimer && <p className="ai-note__micro">{item.disclaimer}</p>}
            </div>
          </div>

          <div className="sect">
            <div className="sect__head">
              <h3 className="sect__title">근거 말씀</h3>
              <span className="sect__meta">원문 열기는 준비 중</span>
            </div>
            {sources.map((source, order) => (
              <article className="card ask-ev" key={source.chunk_id ?? `${order}-${source.volume}`}>
                <div className="src">
                  <b className="ask-ev__no">{order + 1}</b>
                  <span className="src__dot" />
                  <span>{sourceLabel(source)}</span>
                </div>
                <p className="scripture">{source.text}</p>
              </article>
            ))}
          </div>

          <div className="sect">
            <div className="sect__head">
              <h3 className="sect__title">이어서 물어보기</h3>
              <span className="sect__meta">탭해야 보냅니다</span>
            </div>
            <div className="ask-chips">
              {FOLLOWUPS.map((followup) => (
                <Link className="ask-chip" key={followup} href={`/hoondok/ask?q=${encodeURIComponent(followup)}`}>
                  <CornerDownRight size={20} aria-hidden="true" />
                  {followup}
                </Link>
              ))}
            </div>
          </div>
        </>
      )}

      {(item.status === "answered" || item.status === "no-sources") && (
        <div className="sect">
          <div className="card ask-row">
            <span className="ask-row__bd">
              <b>이 질문 저장</b>
              <span>끄면 기록 목록의 저장한 답에서 빠져요</span>
            </span>
            <button
              className="toggle"
              type="button"
              aria-pressed={Boolean(item.isSaved)}
              aria-label="이 질문 저장"
              onClick={() => toggleAskSaved(id)}
            />
          </div>
          <div className="ask-acts">
            <HoondokButton variant="line" isSmall onClick={handleShare}>
              <Share2 size={20} aria-hidden="true" />
              공유
            </HoondokButton>
            <Link className="btn btn-line btn--sm" href="/hoondok?sheet=jeongseong">
              <Sunrise size={20} aria-hidden="true" />이 주제로 정성 시작
            </Link>
          </div>
          <p className="hint">
            <span aria-live="polite" data-testid="ask-share-status">
              {shareTick > 0 ? "복사했어요" : ""}
            </span>
            <span>이 기기에만 저장돼요</span>
          </p>
        </div>
      )}

      <p className="notice">AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다</p>
    </section>
  );
}
