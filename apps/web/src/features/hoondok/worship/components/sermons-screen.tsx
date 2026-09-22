"use client";

// SCR-PWA-012 5분 설교 · 전체 설교 (PLAN-HD-002 W3-W 프리뷰 셸).
// 재생은 붙지 않았다 — 재생 컨트롤은 전부 disabled 이고 왜 못 누르는지는 옆 글자가 말한다 (DES-PWA-003 §3.3).
// 히어로·썸네일 사진은 레포 정적 파일로 복원했다 (2026-09-22 DES-PWA-003-Q2 되돌림).
// 교회장 아바타는 실제 사람 자리라 스톡 얼굴을 쓰지 않고 이니셜 원형을 유지한다.
import { Mic, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_LEAD, SERMONS, SOON } from "@/features/hoondok/preview/fixtures/worship";
import { PreviewAvatar } from "./preview-avatar";

// public/hoondok/photos/sermon-thumb-1..4.webp
const SERMON_THUMBS = 4;

export function SermonsScreen() {
  const [segment, setSegment] = useState(SERMONS.segments[0].id);
  const { featured, quote, pastors, popular } = SERMONS;

  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      <div className="pill-seg" role="tablist" aria-label="설교 길이">
        {SERMONS.segments.map((item) => (
          <button
            className={item.id === segment ? "is-on" : ""}
            type="button"
            role="tab"
            key={item.id}
            id={`sm-seg-${item.id}`}
            aria-selected={item.id === segment}
            aria-controls="sm-seg-panel"
            disabled={item.isSoon}
            aria-disabled={item.isSoon}
            onClick={() => setSegment(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="pill-seg__soon">전체 설교 목록은 {SOON}이에요</p>

      <div id="sm-seg-panel" role="tabpanel" aria-labelledby={`sm-seg-${segment}`}>
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">우리 지역 교회장</h2>
            <span className="sect__meta">{pastors.length}명</span>
          </div>
          {/* 390 에서는 가로 스크롤, 768 이상에서는 줄바꿈이다 (DES §4.4-3 · §5 012) */}
          <ul className="sm-pastors">
            {pastors.map((pastor) => (
              <li key={pastor.id}>
                <Link className="sm-pastor" href="/hoondok/worship/request">
                  <PreviewAvatar name={pastor.name} className="pv-avatar--lg" />
                  <span className="sm-pastor__n">{pastor.name}</span>
                  <span className="sm-pastor__c">{pastor.church}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">이번 주</h2>
            <span className="sect__meta">{featured.postedOn}</span>
          </div>
          {/* 사진 히어로 (2026-09-22 DES-PWA-003-Q2 되돌림). veil 위에는 글자만 두고
              재생 컨트롤은 사진 아래에 남긴다 — 사진 높이는 고정이라 버튼까지 얹으면 잘린다. */}
          <div className="shot sm-hero">
            <img src="/hoondok/photos/sermon-orchard-dusk.webp" alt="" />
            <div className="shot__tx">
              <span className="sm-hero__tag badge badge--accent">{featured.tag}</span>
              <span className="sm-hero__t">{featured.title}</span>
              <span className="sm-hero__m">
                {featured.meta} · {featured.duration}
              </span>
            </div>
          </div>
          <span className="sm-play">
            <button className="btn btn-line btn--sm" type="button" disabled aria-disabled="true">
              <Play size={20} aria-hidden="true" />
              재생
            </button>
            <span className="sm-play__soon">{SOON}</span>
          </span>
          <div className="card sm-quote-card">
            <p className="sm-quote">{quote.body}</p>
            <div className="src">
              {quote.source.map((part, index) => (
                <span className="sm-quote__part" key={part}>
                  {index > 0 && <span className="src__dot" />}
                  <span>{part}</span>
                </span>
              ))}
              <AuthorityBadge grade={quote.grade} />
            </div>
          </div>
        </div>

        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">많이 본 설교</h2>
            <span className="sect__meta">최근 30일</span>
          </div>
          {/* 순서 없는 병렬 항목이라 768 이상 2열을 허용한다 (DES §4.4-3) */}
          <ul className="sm-list">
            {popular.map((sermon, index) => (
              <li className="card sm-item" key={sermon.id}>
                <span className="sm-thumb">
                  {/* 썸네일 4장을 순환한다 — fixture 가 늘어도 이름 없는 사진이 모자라지 않는다 */}
                  <img src={`/hoondok/photos/sermon-thumb-${(index % SERMON_THUMBS) + 1}.webp`} alt="" />
                  <span className="sm-dur">{sermon.duration}</span>
                </span>
                <span className="sm-item__bd">
                  <span className="sm-item__t">{sermon.title}</span>
                  <span className="sm-item__m">{sermon.meta}</span>
                  <span className="sm-item__soon">재생 {SOON}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sect">
        <Link className="btn btn-primary" href="/hoondok/worship/request">
          <Mic size={20} aria-hidden="true" />
          교회장께 설교 요청하기
        </Link>
      </div>

      <p className="notice">{SERMONS.notice} 재생 권리와 운영 방식이 정해지기 전에는 설교를 재생할 수 없어요.</p>
      <Link className="btn btn-line" href="/hoondok/worship">
        가정예배로 돌아가기
      </Link>
    </section>
  );
}
