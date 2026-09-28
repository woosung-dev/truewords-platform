"use client";

// SCR-PWA-010 이번 주 순서지·챌린지 (PLAN-HD-002 W3-W 프리뷰 셸).
// 마크업·문구·순서는 프로토타입 `data-screen="worship"` 그대로다. 5분 설교 묶음은 2026-09-29 "5분 설교" 탭 첫 화면으로 옮겼다.
// 순서지·챌린지는 전부 fixture 이고 어떤 버튼도 네트워크를 타지 않는다 — 누르면 인라인 "준비 중"만 알린다.
import { Pencil, Send, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import {
  PREVIEW_CHALLENGES,
  PREVIEW_LEAD,
  type PreviewChallenge,
  WORSHIP_ORDER,
} from "@/features/hoondok/preview/fixtures/worship";
import { PreviewUnavailable } from "@/features/hoondok/preview/unavailable";
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

export function WorshipOrder() {
  const [soon, setSoon] = useState("");

  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      {/* 사진 히어로 180px (DES-PWA-003 §5 010 행 · 2026-09-22 DES-PWA-003-Q2 되돌림) */}
      <div className="shot ws-hero">
        <img src="/hoondok/photos/worship-bench-family.webp" alt="바닷가 벤치에 나란히 앉은 가족" />
        <div className="shot__tx">
          <p className="ws-eyebrow">{WORSHIP_ORDER.eyebrow}</p>
          <p className="shot__greet">{WORSHIP_ORDER.headline}</p>
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이번 주 순서지</h2>
          <span className="sect__meta">{WORSHIP_ORDER.meta}</span>
        </div>
        <OrderCard onSoon={setSoon} />
        {/* 비어 있어도 자리를 지켜야 눌렀을 때 아래 내용이 밀리지 않는다 */}
        {soon && (
          <PreviewUnavailable
            title={soon}
            reason="가족 연결과 예배 운영 방식이 정해지기 전에는 순서지를 저장하거나 보낼 수 없어요."
            href="/hoondok"
            linkLabel="오늘 훈독으로 돌아가기"
          />
        )}
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

      <p className="notice">챌린지는 진행률과 참여 인원만 보여 줍니다. 개인 순위는 없습니다</p>
    </section>
  );
}
