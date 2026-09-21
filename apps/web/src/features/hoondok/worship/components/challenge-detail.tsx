"use client";

// SCR-PWA-011 챌린지 상세 (PLAN-HD-002 W3-W 프리뷰 셸).
// `DEC-PWA-019` — 순위·점수·달란트·보상 배지를 그리지 않는다. 보이는 값은 진행률과 참여 인원뿐이고
// 참여자 목록도 등수 없이 "완료 / 아직이에요" 두 상태만 쓴다 (RSK-PWA-009: 미완료를 탓하지 않는다).
// 완료 신호는 색이 아니라 체크 아이콘이다 (DES-PWA-003 §2.3 · §3.3).
import { Check, HeartHandshake, Users } from "lucide-react";
import { useState } from "react";
import { DoneBadge } from "@/components/hoondok";
import { PREVIEW_LEAD, type PreviewChallenge, SOON } from "@/features/hoondok/preview/fixtures/worship";
import { PreviewUnavailable } from "@/features/hoondok/preview/unavailable";
import { ChallengeBadge } from "./challenge-badge";
import { PreviewAvatar } from "./preview-avatar";

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

const STATE_LABEL: Record<string, string> = { done: "완료", today: "오늘 완료", rest: "쉼", todo: "아직" };

function SummaryCard({ challenge }: { challenge: PreviewChallenge }) {
  const [soon, setSoon] = useState("");
  const { progress } = challenge;

  if (!progress) {
    // 모집 중 : 진행 바 없이 시작일·예정 인원·개설자만 보인다 (DES §2.5)
    return (
      <div className="card">
        <p className="ch-recruit__t">{challenge.cardFoot}</p>
        <p className="ch-recruit__d">{challenge.opener}</p>
        <p className="ch-bar__foot">
          <span className="ws-people">
            <Users size={14} aria-hidden="true" />
            {challenge.participantLabel}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="stats">
        <div>
          <b className="stats__n stats__n--accent">{progress.percent}%</b>
          <span className="stats__lab">진행률</span>
        </div>
        <div>
          <b className="stats__n">{progress.done}</b>
          <span className="stats__lab">완료한 날</span>
        </div>
        <div>
          <b className="stats__n">{progress.remainLabel}</b>
          <span className="stats__lab">남은 날</span>
        </div>
      </div>
      <div
        className="progress ch-bar"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${challenge.title} 진행률 ${progress.percent}퍼센트`}
      >
        <i className="progress__fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <p className="ch-bar__foot">
        <span>
          {progress.done} / {progress.total}일
        </span>
        <span>{challenge.opener}</span>
      </p>
      <button className="btn btn-primary ch-join" type="button" onClick={() => setSoon(`참여 표시는 ${SOON}이에요`)}>
        <HeartHandshake size={20} aria-hidden="true" />
        오늘 훈독 완료로 표시하기
      </button>
      {soon && (
        <PreviewUnavailable
          title={soon}
          reason="챌린지 운영 방식이 아직 정해지지 않아 참여 기록을 저장하지 않았어요."
          href="/hoondok/read"
          linkLabel="오늘 훈독 읽기"
        />
      )}
    </div>
  );
}

function MemberList({ challenge }: { challenge: PreviewChallenge }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">오늘</h2>
        <span className="sect__meta">{challenge.todayLabel}</span>
      </div>
      <ul className="card ch-list">
        {challenge.members.map((member) => (
          <li className="ch-item" key={member.id}>
            <PreviewAvatar name={member.name} />
            <span className="ch-item__bd">
              <span className="ch-item__t">{member.name}</span>
              <span className="ch-item__m">{member.note}</span>
            </span>
            {member.isDone ? (
              <DoneBadge />
            ) : (
              // 응원 보내기는 아직 붙지 않았다 — 왜 못 누르는지는 색이 아니라 옆 글자가 말한다
              <span className="ch-item__side">
                <span className="ch-item__soon">{SOON}</span>
                <button className="btn btn-line btn--sm" type="button" disabled aria-disabled="true">
                  응원
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheerChips({ challenge }: { challenge: PreviewChallenge }) {
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">응원 한마디</h2>
        <span className="sect__meta">정해진 문구만</span>
      </div>
      {/* 자유 입력창을 두지 않는다 (AC-020-03) */}
      <div className="chips">
        {challenge.cheers.map((cheer) => (
          <button className="chip-btn" type="button" key={cheer} disabled aria-disabled="true">
            {cheer}
          </button>
        ))}
      </div>
      <p className="ch-chip__help">응원 보내기는 {SOON}이에요. 가족 연결과 알림 운영 방식은 아직 정해지지 않았어요</p>
    </div>
  );
}

function CalendarCard({ challenge }: { challenge: PreviewChallenge }) {
  const calendar = challenge.calendar;
  if (!calendar) return null;
  return (
    <div className="sect">
      <div className="sect__head">
        <h2 className="sect__title">{calendar.title}</h2>
        <span className="sect__meta">{calendar.monthLabel}</span>
      </div>
      <div className="card">
        <div className="gd-cal__head" aria-hidden="true">
          {DAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        {/* 칸은 누를 수 없으므로 표가 아니라 목록이다. 칸 하나가 "9월 5일 쉼" 같은 한 문장을 갖는다 (W1-G 선례) */}
        <ol className="gd-cal__grid" aria-label={`${calendar.monthLabel} ${calendar.title}`}>
          {Array.from({ length: calendar.leadingBlanks }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 1일 앞 빈 칸은 내용이 없고 순서만 있다
            <li className="gd-cal__pad" aria-hidden="true" key={`pad-${index}`} />
          ))}
          {calendar.days.map((cell) => {
            const isDone = cell.state === "done" || cell.state === "today";
            return (
              <li
                className="gd-cal__day"
                key={cell.day}
                data-today={cell.state === "today" ? "" : undefined}
                data-future={cell.state === "todo" ? "" : undefined}
                aria-label={`${calendar.monthLabel} ${cell.day}일 ${STATE_LABEL[cell.state]}`}
              >
                <span
                  className={`gd-cal__dot${isDone ? " gd-cal__dot--done" : ""}`}
                  aria-hidden="true"
                  data-rest={cell.state === "rest" ? "" : undefined}
                >
                  {isDone && <Check size={14} />}
                  {cell.state === "rest" && "쉼"}
                </span>
                <b>{cell.day}</b>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

export function ChallengeDetail({ challenge }: { challenge: PreviewChallenge }) {
  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      <div className="card ch-hero">
        <span className="ch-hero__top">
          <p className="greet">{challenge.title}</p>
          <ChallengeBadge badge={challenge.badge} />
        </span>
        <p className="greet__sub">{challenge.summary}</p>
      </div>

      <div className="sect ch-sum">
        <SummaryCard challenge={challenge} />
      </div>

      {challenge.members.length > 0 && <MemberList challenge={challenge} />}
      {challenge.cheers.length > 0 && <CheerChips challenge={challenge} />}
      <CalendarCard challenge={challenge} />

      <p className="notice">{challenge.notice}</p>
    </section>
  );
}
