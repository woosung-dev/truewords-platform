"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpenText, Search } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { libraryAPI, wordsHref } from "../api";
import { parseLastReading, readLastReadingRaw, subscribeLastReading } from "../last-reading";

export function LibraryScreen() {
  const query = useQuery({ queryKey: ["hoondok", "library"], queryFn: libraryAPI.list, retry: false, staleTime: 0 });
  const last = parseLastReading(useSyncExternalStore(subscribeLastReading, readLastReadingRaw, () => null));
  const resume =
    query.isSuccess && last
      ? query.data.items.find((work) => work.volume === last.volume && work.scope_full_text)
      : null;
  return (
    <section className="col">
      <Link className="search-field" href="/hoondok/search">
        <Search size={20} aria-hidden="true" />
        <span>단어, 구절, 상황을 입력해 주세요</span>
      </Link>
      {resume && last && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">이어 읽기</h2>
            <span className="sect__meta">이 기기의 마지막 구간</span>
          </div>
          <Link className="card resume" href={`${wordsHref(resume.volume)}?page=${last.page}`}>
            <span className="resume__bd">
              <b>{resume.work_title}</b>
              <span className="resume__meta">원문 구간 {last.page}</span>
            </span>
            {resume.authority_grade === "R" ? (
              <span className="badge badge--dashed">공식성 확인되지 않음</span>
            ) : (
              <AuthorityBadge grade={resume.authority_grade} />
            )}
          </Link>
        </div>
      )}
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">저작물</h2>
          <span className="sect__meta">검색·원문 공개 권리를 확인한 저작물</span>
        </div>
        {query.isPending ? (
          <p className="sf-status" role="status" aria-busy="true">
            서고를 불러오고 있어요
          </p>
        ) : query.isError ? (
          <div className="empty" role="status">
            <span className="empty__ic">
              <BookOpenText size={26} />
            </span>
            <p className="empty__title">서고를 불러오지 못했어요</p>
            <p className="empty__body">연결을 확인하고 다시 시도해 주세요.</p>
            <button type="button" className="btn btn-line" onClick={() => void query.refetch()}>
              다시 시도
            </button>
          </div>
        ) : query.data.items.length === 0 ? (
          <div className="empty" role="status">
            <span className="empty__ic">
              <BookOpenText size={26} />
            </span>
            <p className="empty__title">공개된 저작물이 아직 없어요</p>
            <p className="empty__body">원문 공개 권리가 확인되면 이곳에서 읽을 수 있어요.</p>
            <Link className="btn btn-line" href="/hoondok">
              오늘 훈독으로 돌아가기
            </Link>
          </div>
        ) : (
          <div className="shelf">
            {query.data.items.map((work) => {
              const content = (
                <>
                  <b>{work.work_title}</b>
                  {/* 권리 원장에는 volume 과 work_title 이 같은 저작물이 있다 — 같은 글자를 두 줄 쓰지 않는다 */}
                  {work.volume !== work.work_title && <span>{work.volume}</span>}
                  {work.authority_grade === "R" ? (
                    <span className="badge badge--dashed">공식성 확인되지 않음</span>
                  ) : (
                    <AuthorityBadge grade={work.authority_grade} />
                  )}
                </>
              );
              return work.scope_full_text ? (
                <Link key={work.volume} className="shelf__item" href={wordsHref(work.volume)}>
                  {content}
                </Link>
              ) : (
                <div key={work.volume} className="shelf__item">
                  {content}
                  <span>검색 인용만 허용 · 원문 공개 확인 중</span>
                  <Link href="/hoondok/search" className="btn btn-line btn--sm">
                    말씀 검색하기
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="notice">
        검색과 원문 공개 권한은 각각 확인합니다. 판본·화자·공식성이 확인되지 않은 값은 지어내지 않습니다.
      </p>
    </section>
  );
}
