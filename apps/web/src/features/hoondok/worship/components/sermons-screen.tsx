"use client";

// SCR-PWA-012 5분 설교 (PLAN-HD-002 W3-W 프리뷰 셸). 넷째 탭 "5분 설교"의 첫 화면이다(2026-09-29).
// 순서: 이번 주 설교 → 많이 본 설교 → 교회장께 설교 요청 → 이번 주 가정예배. 볼 것이 먼저, 부탁할 것이 다음이다.
// 재생은 아직 붙지 않았다 — 포스터가 곧 재생 자리이고, 그 위에 "재생 준비 중"을 한 번만 적는다(목록마다 되풀이하지 않는다).
// 포스터·썸네일은 16:9 로 둔다. YouTube 임베드가 붙으면 같은 자리·같은 비율로 바뀐다.
// 교회장 아바타는 실제 사람 자리라 스톡 얼굴을 쓰지 않고 이니셜 원형을 유지한다.
import { ChevronRight, Mic } from "lucide-react";
import Link from "next/link";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_LEAD, SERMONS, WORSHIP_ORDER } from "@/features/hoondok/preview/fixtures/worship";
import { PreviewAvatar } from "./preview-avatar";

// public/hoondok/photos/sermon-thumb-1..4.webp
const SERMON_THUMBS = 4;

export function SermonsScreen() {
  const { featured, popular, pastors } = SERMONS;

  return (
    <section className="col">
      <p className="notice notice--lead">{PREVIEW_LEAD}</p>

      <article className="sm-feat" aria-labelledby="sm-feat-title">
        <h2 className="sect__title">이번 주 설교</h2>
        <div className="sm-poster">
          <img src="/hoondok/photos/sermon-orchard-dusk.webp" alt="" />
          <span className="sm-poster__state">
            <span>재생 준비 중</span>
          </span>
          <span className="sm-dur">{featured.duration}</span>
        </div>
        <h3 className="sm-feat__t" id="sm-feat-title">
          {featured.title}
        </h3>
        <p className="sm-feat__by">{featured.by}</p>
        <p className="sm-feat__src">
          <span>
            {featured.scripture} 본문, {featured.postedOn} 게시
          </span>
          <AuthorityBadge grade={featured.grade} />
        </p>
        <blockquote className="sm-summary">
          <p>{featured.summary}</p>
          <footer>설교 요약</footer>
        </blockquote>
      </article>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">많이 본 설교</h2>
          <span className="sect__meta">최근 30일</span>
        </div>
        {/* 폰은 썸네일 옆 글자 한 줄 목록, 768 이상은 썸네일 위 2열 (DES §5 012) */}
        <ul className="sm-list">
          {popular.map((sermon, index) => (
            <li className="sm-item" key={sermon.id}>
              <span className="sm-thumb">
                {/* 썸네일 4장을 순환한다 — fixture 가 늘어도 이름 없는 사진이 모자라지 않는다 */}
                <img src={`/hoondok/photos/sermon-thumb-${(index % SERMON_THUMBS) + 1}.webp`} alt="" />
                <span className="sm-dur">{sermon.duration}</span>
              </span>
              <span className="sm-item__bd">
                <span className="sm-item__t">{sermon.title}</span>
                <span className="sm-item__m">{sermon.by}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="sect sm-ask">
        <h2 className="sect__title">교회장께 설교 요청</h2>
        <p className="sm-ask__lede">듣고 싶은 주제를 적어 보내면 우리 지역 교회장께 전해져요.</p>
        {/* 누를 곳은 아래 버튼 하나다 — 아바타마다 같은 폼으로 가는 링크를 두지 않는다.
            가로로 넘기는 목록이라 키보드로도 들어와 화살표로 넘길 수 있게 포커스를 받는다 */}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 스크롤 영역은 키보드로 넘길 수 있어야 한다 (axe scrollable-region-focusable) */}
        <ul className="sm-pastors" aria-label="우리 지역 교회장" tabIndex={0}>
          {pastors.map((pastor) => (
            <li className="sm-pastor" key={pastor.id}>
              <PreviewAvatar name={pastor.name} />
              <span className="sm-pastor__n">{pastor.name}</span>
              <span className="sm-pastor__c">{pastor.church}</span>
            </li>
          ))}
        </ul>
        <Link className="btn btn-line" href="/hoondok/worship/request">
          <Mic size={20} aria-hidden="true" />
          설교 요청하기
        </Link>
      </div>

      <div className="sect">
        <h2 className="sect__title">이번 주 가정예배</h2>
        <Link className="card sm-order" href="/hoondok/worship/order">
          <span className="sm-order__bd">
            <span className="sm-order__t">순서지·챌린지</span>
            <span className="sm-order__m">{WORSHIP_ORDER.headline}</span>
          </span>
          <ChevronRight size={20} aria-hidden="true" />
        </Link>
      </div>

      <p className="notice">{SERMONS.notice}</p>
    </section>
  );
}
