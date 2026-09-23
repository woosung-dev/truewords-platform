"use client";

// SCR-PWA-007 말씀 서고. PLAN-HD-007 로 저작물(works) → 권 → 장 3계층의 첫 칸이 됐다.
// 이어 읽기는 로그인 시 서버 값 우선, 없으면 기기 값 1회 업로드(§2-13). 북마크 절은 최근 5건이다.
import { useQuery } from "@tanstack/react-query";
import type { LibraryItem, LibraryWork } from "@truewords/api-client-ts/types";
import { Bookmark, BookOpenText, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { AuthorityBadge } from "@/components/hoondok";
import { LIBRARY_KEY } from "@/features/hoondok/query-keys";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { libraryAPI, pageOfChunkIndex, seriesHref, WORDS_PAGE_SIZE, wordsHref, wordsPageHref } from "../api";
import { parseLastReading, readLastReadingRaw, subscribeLastReading } from "../last-reading";
import { useBookmarks, useReadingPositions, useReadingPositionWriter } from "../use-reading";

const BOOKMARK_LIMIT = 5;

function GradeBadge({ grade }: { grade: LibraryItem["authority_grade"] }) {
  return grade === "R" ? (
    <span className="badge badge--dashed">공식성 확인되지 않음</span>
  ) : (
    <AuthorityBadge grade={grade} />
  );
}

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
  const device = parseLastReading(useSyncExternalStore(subscribeLastReading, readLastReadingRaw, () => null));
  const positions = useReadingPositions(isLoggedIn);
  const bookmarks = useBookmarks(isLoggedIn, BOOKMARK_LIMIT);
  const items = query.data?.items ?? [];
  const works = query.data?.works ?? [];

  // §2-13 병합: 서버가 비어 있고 기기에만 기록이 있으면 한 번만 올린다. 반대 방향 복사는 하지 않는다.
  const shouldUpload = isLoggedIn && positions.isSuccess && positions.items.length === 0 && device !== null;
  const remember = useReadingPositionWriter();
  useEffect(() => {
    if (shouldUpload && device) remember(device.volume, (device.page - 1) * WORDS_PAGE_SIZE);
  }, [shouldUpload, device, remember]);

  const serverResume = positions.items[0] ?? null;
  const deviceResume =
    !isLoggedIn && device ? items.find((item) => item.volume === device.volume && item.scope_full_text) : undefined;
  const resumeGrade = serverResume
    ? items.find((item) => item.volume === serverResume.volume)?.authority_grade
    : undefined;

  return (
    <section className="col">
      <Link className="search-field" href="/hoondok/search">
        <Search size={20} aria-hidden="true" />
        <span>단어, 구절, 상황을 입력해 주세요</span>
      </Link>
      {serverResume ? (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">이어 읽기</h2>
            <span className="sect__meta">계정에 저장된 위치</span>
          </div>
          <Link
            className="card resume"
            href={wordsPageHref(serverResume.volume, pageOfChunkIndex(serverResume.chunk_index))}
          >
            <span className="resume__bd">
              <b>{serverResume.work_title}</b>
              <span className="resume__meta">
                {serverResume.label !== serverResume.work_title && `${serverResume.label} · `}
                단락 {serverResume.chunk_index}까지 읽었어요
              </span>
            </span>
            {resumeGrade && <GradeBadge grade={resumeGrade} />}
          </Link>
        </div>
      ) : (
        deviceResume &&
        device && (
          <div className="sect">
            <div className="sect__head">
              <h2 className="sect__title">이어 읽기</h2>
              <span className="sect__meta">이 기기의 마지막 구간</span>
            </div>
            <Link className="card resume" href={wordsPageHref(deviceResume.volume, device.page)}>
              <span className="resume__bd">
                <b>{deviceResume.work_title}</b>
                <span className="resume__meta">원문 구간 {device.page}</span>
              </span>
              <GradeBadge grade={deviceResume.authority_grade} />
            </Link>
          </div>
        )
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
                  <GradeBadge grade={work.authority_grade} />
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
                  <GradeBadge grade={work.authority_grade} />
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
      {bookmarks.length > 0 && (
        <div className="sect">
          <div className="sect__head">
            <h2 className="sect__title">북마크</h2>
            <span className="sect__meta">최근 {bookmarks.length}건</span>
          </div>
          <div className="shelf">
            {bookmarks.map((mark) => (
              <Link key={mark.chunk_id} className="shelf__item" href={wordsHref(mark.volume, mark.chunk_id)}>
                <b>{mark.work_title}</b>
                <span>
                  {mark.label !== mark.work_title && `${mark.label} · `}단락 {mark.chunk_index}
                </span>
                <Bookmark size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      )}
      <p className="notice">
        검색과 원문 공개 권한은 각각 확인합니다. 판본·화자·공식성이 확인되지 않은 값은 지어내지 않습니다.
      </p>
    </section>
  );
}
