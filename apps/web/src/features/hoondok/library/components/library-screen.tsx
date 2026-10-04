"use client";

// SCR-PWA-007 말씀 서고. PLAN-HD-007 로 저작물(works) → 권 → 장 3계층의 첫 칸이 됐다.
// 이어 읽기는 로그인 시 서버 값 우선, 없으면 기기 값 1회 업로드(§2-13).
import { useQuery } from "@tanstack/react-query";
import type { LibraryWork } from "@truewords/api-client-ts/types";
import { BookOpenText, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { LIBRARY_KEY } from "@/features/hoondok/query-keys";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI, pageOfChunkIndex, seriesHref, WORDS_PAGE_SIZE, wordsHref, wordsPageHref } from "../api";
import { R_GROUP_NOTE, sharedGrade } from "../grade";
import { pickResume, resumeFromPhrase } from "../resume";
import { useLastReading, useReadingPositions, useReadingPositionWriter } from "../use-reading";

/** 저작물 카드의 부제 — 전권이 열려 있으면 권 수만, 일부면 공개 비율을 적는다. */
function volumeSummary(work: LibraryWork): string {
  return work.allowed_count >= work.volume_count
    ? `${work.volume_count}권`
    : `${work.allowed_count}/${work.volume_count}권 공개`;
}

export function LibraryScreen() {
  const query = useQuery({ queryKey: LIBRARY_KEY, queryFn: libraryAPI.list, retry: false, staleTime: 0 });
  const { user } = useCurrentUser();
  const isLoggedIn = Boolean(user);
  const device = useLastReading();
  const positions = useReadingPositions(isLoggedIn);
  const items = query.data?.items ?? [];
  const works = query.data?.works ?? [];

  // §2-13 병합: 서버가 비어 있고 기기에만 기록이 있으면 한 번만 올린다. 반대 방향 복사는 하지 않는다.
  const shouldUpload = isLoggedIn && positions.isSuccess && positions.items.length === 0 && device !== null;
  const remember = useReadingPositionWriter();
  useEffect(() => {
    if (shouldUpload && device) remember(device.volume, (device.page - 1) * WORDS_PAGE_SIZE);
  }, [shouldUpload, device, remember]);

  // 홈 이어 읽기 카드와 같은 규칙 — 원문 공개가 허용된 권만 고른다
  const resume = pickResume({ isLoggedIn, positions: positions.items, device, items });
  // 선반 전체가 같은 등급이면 배지는 묶음 머리에 한 번만 — 행에는 그와 다른 등급만 단다
  const shelfGrade = sharedGrade((works.length > 0 ? works : items).map((entry) => entry.authority_grade));

  return (
    <section className="col">
      <Link className="search-field" href="/hoondok/search">
        <Search size={20} aria-hidden="true" />
        <span>단어, 구절, 상황을 입력해 주세요</span>
      </Link>
      {resume && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">이어 읽기</h2>
            <span className="sect__meta">
              {resume.source === "account" ? "계정에 저장된 위치" : "이 기기의 마지막 구간"}
            </span>
          </div>
          <Link className="card resume" href={wordsPageHref(resume.volume, pageOfChunkIndex(resume.chunkIndex))}>
            <span className="resume__bd">
              <b>{resume.workTitle}</b>
              <span className="resume__meta">
                {resume.label && resume.label !== resume.workTitle && `${resume.label} · `}
                {resume.source === "account"
                  ? resumeFromPhrase(resume.chunkIndex)
                  : `원문 구간 ${pageOfChunkIndex(resume.chunkIndex)}`}
              </span>
            </span>
            <AuthorityBadge grade={resume.authorityGrade} />
          </Link>
        </div>
      )}
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">저작물</h2>
          {query.isSuccess && shelfGrade && <AuthorityBadge grade={shelfGrade} />}
        </div>
        {query.isSuccess && shelfGrade === "R" && <p className="list-note">{R_GROUP_NOTE}</p>}
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
        ) : items.length === 0 ? (
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
        ) : works.length > 0 ? (
          <div className="shelf shelf--works">
            {works.map((work) => {
              const volumes = items.filter((item) => item.book_series === work.series);
              // 허용 권이 하나뿐이면 권 목록 한 칸을 건너뛰고 바로 원문으로 간다
              const only = volumes.length === 1 && volumes[0].scope_full_text ? volumes[0] : null;
              return (
                <Link
                  key={work.series}
                  className="shelf__item"
                  href={only ? wordsHref(only.volume) : seriesHref(work.series)}
                >
                  <b>{work.title}</b>
                  <span>{volumeSummary(work)}</span>
                  {work.authority_grade !== shelfGrade && <AuthorityBadge grade={work.authority_grade} />}
                  <ChevronRight className="shelf__go" size={20} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        ) : (
          // 원장에 book_series 가 없는 행만 있는 경우. 저작물로 묶지 못하므로 권 목록 그대로 보인다
          <div className="shelf">
            {items.map((work) => {
              const content = (
                <>
                  <b>{work.work_title}</b>
                  {/* 권리 원장에는 volume 과 work_title 이 같은 저작물이 있다 — 같은 글자를 두 줄 쓰지 않는다 */}
                  {work.volume !== work.work_title && <span>{work.volume}</span>}
                  {work.authority_grade !== shelfGrade && <AuthorityBadge grade={work.authority_grade} />}
                </>
              );
              return work.scope_full_text ? (
                <Link key={work.volume} className="shelf__item" href={wordsHref(work.volume)}>
                  {content}
                  <ChevronRight className="shelf__go" size={20} aria-hidden="true" />
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
        검색과 원문 공개 권한은 저작물마다 따로 확인해요. 확인되지 않은 정보는 ‘확인되지 않음’으로 적어요.
      </p>
    </section>
  );
}
