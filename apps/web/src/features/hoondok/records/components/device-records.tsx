"use client";

// 이 기기에만 있는 기록 (C1 결정 9). 오늘의 한 줄(note/storage)과 저장한 AI 답(ask/storage)은 이 브라우저
// localStorage 에만 있다 — 이 화면과 입구는 서버를 부르지 않는다. 로그아웃·다른 계정 로그인도 이 기록을 지운다
// (identity `clearHoondokStorage`). 계정으로 옮기는 기능은 없으니 한 줄을 글로 한 번에 복사할 길만 둔다.
import { ChevronRight, Copy, MessageSquareText, Smartphone } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { EMPTY_ASK_ITEMS, readAskItems, subscribeAsk } from "../../ask/storage";
import { cardDayLabel, cardLongDate } from "../../cards/format";
import { type DeviceNote, EMPTY_NOTES, readAllNotes, subscribeNote } from "../../note/storage";
import { DEVICE_RECORDS_PATH } from "../records";

const ASK_LOG_HREF = "/hoondok/ask/log";

function noopSubscribe(): () => void {
  return () => {};
}

/** 한 줄(날짜 최신순)과 저장한 AI 답 수. 서버 렌더와 hydration 첫 렌더는 빈 값이다. */
function useDeviceRecords() {
  const notes = useSyncExternalStore(subscribeNote, readAllNotes, () => EMPTY_NOTES);
  const askItems = useSyncExternalStore(subscribeAsk, readAskItems, () => EMPTY_ASK_ITEMS);
  const savedAnswers = askItems.filter((item) => item.isSaved).length;
  return { notes, savedAnswers };
}

/** 복사할 글 — 날짜 줄 + 한 줄, 빈 줄로 나눈다. 해가 바뀌어도 알아보게 연도를 넣는다. */
export function notesAsText(notes: readonly DeviceNote[]): string {
  return notes.map((note) => `${cardLongDate(note.date)}\n${note.text}`).join("\n\n");
}

/** 정원의 입구. 기기에 남은 기록이 없으면 그리지 않는다. 비로그인 정원에서는 섹션 머리와 함께 둔다. */
export function DeviceRecordsEntry({ isGuest = false }: { isGuest?: boolean }) {
  const { notes, savedAnswers } = useDeviceRecords();
  if (notes.length === 0 && savedAnswers === 0) return null;
  const summary = [
    notes.length > 0 && `오늘의 한 줄 ${notes.length}개`,
    savedAnswers > 0 && `저장한 AI 답 ${savedAnswers}개`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="sect">
      {isGuest && (
        <div className="sect__head">
          <h2 className="sect__title">이 기기에 있는 기록</h2>
          <span className="sect__meta">로그인 없이도 보여요</span>
        </div>
      )}
      <Link className="rc-local" href={DEVICE_RECORDS_PATH}>
        <Smartphone size={22} aria-hidden="true" />
        <span className="rc-local__bd">
          <b>{isGuest ? summary : "이 기기에만 있는 기록"}</b>
          <span>{isGuest ? "로그인해도 계정으로 옮겨지지 않아요" : summary}</span>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function DeviceRecordsScreen() {
  const isClient = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const { notes, savedAnswers } = useDeviceRecords();
  const [copyMessage, setCopyMessage] = useState("");

  // 서버 렌더에는 기기 값이 없다 — 빈 상태가 잠깐 비쳤다 바뀌지 않게 hydration 전에는 그리지 않는다.
  if (!isClient) return <section className="col" />;

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(notesAsText(notes));
      setCopyMessage("복사했어요");
    } catch {
      setCopyMessage("복사하지 못했어요. 한 줄을 길게 눌러 직접 복사해 주세요.");
    }
  }

  return (
    <section className="col">
      <div className="rc-info">
        <Smartphone size={24} aria-hidden="true" />
        <div>
          <b>이 브라우저에만 저장돼 있어요</b>
          <p>
            폰을 바꾸거나 로그아웃하거나 인터넷 사용 기록을 지우면 함께 지워져요. 계정으로 옮기는 기능은 아직 없어요.
          </p>
        </div>
      </div>

      {notes.length === 0 && savedAnswers === 0 && (
        <div className="card rc-empty">
          <div className="empty gd-empty">
            <h2 className="empty__title">이 기기에 남은 기록이 없어요</h2>
            <p className="empty__body">오늘 훈독의 ‘오늘의 한 줄’과 AI 질문에서 저장한 답이 여기에 모여요.</p>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">오늘의 한 줄</h2>
            <span className="sect__meta">{notes.length}개</span>
          </div>
          <div className="card rc-listcard">
            <ul className="rc-lines">
              {notes.map((note) => (
                <li key={note.date}>
                  <time dateTime={note.date}>{cardDayLabel(note.date)}</time>
                  <p>{note.text}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rc-copy">
            <button className="btn btn-line btn--sm" type="button" onClick={() => void copyNotes()}>
              <Copy size={18} aria-hidden="true" />한 줄 모두 글로 복사
            </button>
            <p role="status">{copyMessage || "카카오톡 '나와의 채팅'에 붙여 두면 폰을 바꿔도 남아요."}</p>
          </div>
        </div>
      )}

      {savedAnswers > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">저장한 AI 답</h2>
            <span className="sect__meta">{savedAnswers}개</span>
          </div>
          <Link className="card fm-entry" href={ASK_LOG_HREF}>
            <MessageSquareText size={22} aria-hidden="true" />
            <span className="fm-entry__bd">
              <b>AI 질문 기록에서 보기</b>
              <span>‘저장한 답’에 모여 있어요. AI 답은 공식 해설이 아니에요.</span>
            </span>
            <ChevronRight size={20} aria-hidden="true" />
          </Link>
        </div>
      )}

      <p className="notice">이 화면의 기록은 서버로 보내지 않아요. 나만 봐요.</p>
    </section>
  );
}
