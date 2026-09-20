"use client";

// SCR-PWA-010 가정예배 홈 (PLAN-HD-002 W3-W 프리뷰 셸).
// 마크업·문구·순서는 프로토타입 `data-screen="worship"` 그대로이고, 사진 히어로만 글자 카드로 바꿨다(홈 결정 12 선례).
// 순서지·챌린지·설교는 전부 fixture 이고 어떤 버튼도 네트워크를 타지 않는다 — 누르면 인라인 "준비 중"만 알린다.
import { Mic, Pencil, Send, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import {
  PREVIEW_CHALLENGES,
  PREVIEW_LEAD,
  type PreviewChallenge,
  SERMONS,
  WORSHIP_ORDER,
} from "@/features/hoondok/preview/fixtures/worship";
import { ChallengeBadge } from "./challenge-badge";

function OrderCard({ onSoon }: { onSoon: (message: string) => void }) {
  const { source, steps, shareHelp } = WORSHIP_ORDER;
  return (
    <div className="card">
      <div className="src ws-order__src">
        <span>{source.speaker}</span>
        <span className="src__dot" />
        <span>{source.work}</span>
        <AuthorityBadge grade={source.grade} />
      </div>
      {/* 순서가 의미라 어느 폭에서도 세로 1열 <ol> 이다 (DES-PWA-003 §2.4 · §4.4-3) */}
      <ol className="ws-order">
        {steps.map((step) => (
          <li className="ws-order__it" key={step.no}>
            <span className="ws-order__no" aria-hidden="true">
              {step.no}
            </span>
            <span className="ws-order__bd">
              <span className="ws-order__k">{step.kind}</span>
              <span className="ws-order__t">{step.title}</span>
              {step.note && <span className="ws-order__d">{step.note}</span>}
            </span>
          </li>
        ))}
      </ol>
      {/* 공유는 가족 그룹 안으로 한정한다 (AC-019-02). 프리뷰에서는 보내지 않고 상태만 알린다 */}
      <div className="ws-actions">
        <button className="btn btn-primary" type="button" onClick={() => onSoon("가족에게 보내기는 준비 중이에요")}>
          <Send size={20} aria-hidden="true" />
          가족에게 보내기
        </button>
        <button className="btn btn-line" type="button" onClick={() => onSoon("순서지 편집은 준비 중이에요")}>
          <Pencil size={20} aria-hidden="true" />
          편집
        </button>
      </div>
      <p className="ws-actions__help">{shareHelp}</p>
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: PreviewChallenge }) {
  const { progress } = challenge;
  return (
    <Link className="card ws-chal__card" href={`/hoondok/worship/challenge/${challenge.id}`}>
      <span className="ws-chal__top">
        <b className="ws-chal__name">{challenge.title}</b>
        <ChallengeBadge badge={challenge.badge} />
      </span>
      {progress && (
        // 색·길이만으로 값을 전달하지 않는다 — 아래 줄에 퍼센트를 숫자로 병기한다 (DES §2.5)
        <span
          className="progress ws-chal__bar"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${challenge.title} 진행률 ${progress.percent}퍼센트`}
        >
          <i className="progress__fill" style={{ width: `${progress.percent}%` }} />
        </span>
      )}
      <span className={`ws-chal__foot${progress ? "" : " ws-chal__foot--solo"}`}>
        <span>{challenge.cardFoot}</span>
        {progress && (
          <span className="ws-people">
            <Users size={14} aria-hidden="true" />
            {challenge.participantLabel}
          </span>
        )}
      </span>
    </Link>
  );
}

export function WorshipHome() {
  const [soon, setSoon] = useState("");
  const { featured } = SERMONS;

  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      <div className="card ws-hero">
        <p className="ws-eyebrow">{WORSHIP_ORDER.eyebrow}</p>
        <p className="greet">{WORSHIP_ORDER.headline}</p>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이번 주 순서지</h2>
          <span className="sect__meta">{WORSHIP_ORDER.meta}</span>
        </div>
        <OrderCard onSoon={setSoon} />
        {/* 비어 있어도 자리를 지켜야 눌렀을 때 아래 내용이 밀리지 않는다 */}
        <p className="ws-soon" role="status">
          {soon}
        </p>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">챌린지</h2>
          <span className="sect__meta">{PREVIEW_CHALLENGES.length}개</span>
        </div>
        <div className="ws-chal">
          {PREVIEW_CHALLENGES.map((challenge) => (
            <ChallengeCard challenge={challenge} key={challenge.id} />
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">5분 설교</h2>
          <Link className="sect__meta" href="/hoondok/worship/sermons">
            전체 설교
          </Link>
        </div>
        <Link className="card sm-hero" href="/hoondok/worship/sermons">
          <span className="sm-hero__tag badge badge--accent">{featured.tag}</span>
          <span className="sm-hero__t">{featured.title}</span>
          <span className="sm-hero__m">
            {featured.meta} · {featured.duration}
          </span>
        </Link>
        <Link className="btn btn-line sm-request" href="/hoondok/worship/request">
          <Mic size={20} aria-hidden="true" />
          교회장께 설교 요청하기
        </Link>
      </div>

      <p className="notice">챌린지는 진행률과 참여 인원만 보여 줍니다. 개인 순위는 없습니다</p>
    </section>
  );
}
