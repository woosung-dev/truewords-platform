// SCR-PWA-007 말씀 서고 (PLAN-HD-002 W3-L). 프리뷰 셸이라 값은 전부 fixture 이고 네트워크 요청이 없다.
// 마크업은 프로토타입 data-screen="library" 그대로 — 검색 필드(상설) · 이어 읽기 · 저작물 · 권리 고지 순서다.
import { Search } from "lucide-react";
import Link from "next/link";
import { AuthorityBadge } from "@/components/hoondok";
import { PREVIEW_LIBRARY_NOTICE, PREVIEW_RESUME, PREVIEW_WORKS } from "@/features/hoondok/preview/fixtures/library";

// 프로토타입 `.search-field` 의 문구 그대로. 검색 화면의 입력 placeholder 와 같은 말이다.
const SEARCH_PLACEHOLDER = "단어, 구절, 상황을 입력해 주세요";

export function LibraryScreen() {
  return (
    <section className="col">
      <p className="notice">미리보기 예시 데이터입니다</p>

      <Link className="search-field" href="/hoondok/search">
        <Search size={20} aria-hidden="true" />
        <span>{SEARCH_PLACEHOLDER}</span>
      </Link>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">이어 읽기</h2>
          <span className="sect__meta">{PREVIEW_RESUME.when}</span>
        </div>
        <Link className="card resume" href={`/hoondok/words/${PREVIEW_RESUME.wordId}`}>
          <span className="resume__bd">
            <b>{PREVIEW_RESUME.title}</b>
            <span className="resume__meta">{PREVIEW_RESUME.meta}</span>
          </span>
          <AuthorityBadge grade={PREVIEW_RESUME.grade} />
        </Link>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">저작물</h2>
          <span className="sect__meta">권리 확인된 정본만</span>
        </div>
        <div className="shelf">
          {PREVIEW_WORKS.map((work) => {
            const body = (
              <>
                <b>{work.title}</b>
                <span>{work.meta}</span>
                <AuthorityBadge grade={work.grade} />
              </>
            );
            // 읽을 원문이 있는 저작물만 링크다. 나머지는 왜 못 여는지를 메타 줄·배지가 글자로 말한다(§3.3).
            return work.wordId ? (
              <Link key={work.id} className="shelf__item" href={`/hoondok/words/${work.wordId}`}>
                {body}
              </Link>
            ) : (
              <div key={work.id} className="shelf__item">
                {body}
              </div>
            );
          })}
        </div>
      </div>

      <p className="notice">{PREVIEW_LIBRARY_NOTICE}</p>
    </section>
  );
}
