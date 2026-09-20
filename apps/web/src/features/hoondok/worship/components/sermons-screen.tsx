"use client";

// SCR-PWA-012 5분 설교 · 전체 설교 (PLAN-HD-002 W3-W 프리뷰 셸).
// 재생은 붙지 않았다 — 재생 컨트롤은 전부 disabled 이고 왜 못 누르는지는 옆 글자가 말한다 (DES-PWA-003 §3.3).
// 프로토타입의 썸네일·교회장 사진은 바깥 네트워크(picsum)라 글자 아바타·시간 배지로 바꿨다.
import { Mic, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_LEAD, SERMONS, SOON } from "@/features/hoondok/preview/fixtures/worship";
import { PreviewAvatar } from "./preview-avatar";

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
          <div className="card sm-hero sm-hero--full">
            <span className="sm-hero__tag badge badge--accent">{featured.tag}</span>
            <span className="sm-hero__t">{featured.title}</span>
            <span className="sm-hero__m">
              {featured.meta} · {featured.duration}
            </span>
            <span className="sm-play">
              <button className="btn btn-line btn--sm" type="button" disabled aria-disabled="true">
                <Play size={20} aria-hidden="true" />
                재생
              </button>
              <span className="sm-play__soon">{SOON}</span>
            </span>
          </div>
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
            {popular.map((sermon) => (
              <li className="card sm-item" key={sermon.id}>
                <span className="sm-thumb">
                  <Play size={20} aria-hidden="true" />
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

      <p className="notice">{SERMONS.notice}</p>
    </section>
  );
}
