"use client";

// 저작물 → 권 목록 (API-HD-023). 3계층의 가운데 칸으로, 권을 고르면 원문 뷰로 간다.
// 허용 권이 0건인 시리즈는 백엔드가 404 를 주므로 존재 여부를 화면에서 추측하지 않는다.
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@truewords/api-client-ts";
import { BookOpenText } from "lucide-react";
import Link from "next/link";
import { AuthorityBadge } from "@/components/hoondok";
import { seriesKey } from "@/features/hoondok/query-keys";
import { useHoondokScreenTitle } from "@/features/hoondok/screen-title";
import { libraryAPI, wordsHref } from "../api";

export function SeriesScreen({ series }: { series: string }) {
  const query = useQuery({
    queryKey: seriesKey(series),
    queryFn: ({ signal }) => libraryAPI.series(series, signal),
    retry: false,
    staleTime: 0,
  });
  useHoondokScreenTitle(query.isSuccess ? query.data.title : null);

  if (query.isPending)
    return (
      <section className="col">
        <p className="sf-status" role="status" aria-busy="true">
          권 목록을 불러오고 있어요
        </p>
      </section>
    );
  if (query.isError) {
    const isMissing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section className="col">
        <div className="empty" role="status">
          <span className="empty__ic">
            <BookOpenText size={26} />
          </span>
          <p className="empty__title">
            {isMissing ? "이 저작물은 아직 공개되지 않았어요" : "권 목록을 불러오지 못했어요"}
          </p>
          <p className="empty__body">
            {isMissing ? "원문 공개 권리가 확인되면 이곳에서 읽을 수 있어요." : "연결을 확인하고 다시 시도해 주세요."}
          </p>
          {!isMissing && (
            <button className="btn btn-line" type="button" onClick={() => void query.refetch()}>
              다시 시도
            </button>
          )}
          <Link className="btn btn-line" href="/hoondok/library">
            서고로 돌아가기
          </Link>
        </div>
      </section>
    );
  }
  const detail = query.data;
  return (
    <section className="col">
      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">권</h2>
          <span className="sect__meta">{detail.volumes.length}권 공개</span>
          {detail.authority_grade === "R" ? (
            <span className="badge badge--dashed">공식성 확인되지 않음</span>
          ) : (
            <AuthorityBadge grade={detail.authority_grade} />
          )}
        </div>
        <div className="shelf shelf--works">
          {detail.volumes.map((item) => {
            const content = (
              <>
                <b>{item.label}</b>
                <span>
                  {item.total_chunks !== null && `단락 ${item.total_chunks}개`}
                  {item.total_chunks !== null && item.section_count > 0 && " · "}
                  {item.section_count > 0 && `장 ${item.section_count}개`}
                </span>
              </>
            );
            // 목록은 검색만 허용된 권도 담는다(서버 _is_visible) — 원문이 닫힌 권은 눌러도 404 다
            return item.scope_full_text ? (
              <Link key={item.volume} className="shelf__item" href={wordsHref(item.volume)}>
                {content}
              </Link>
            ) : (
              <div key={item.volume} className="shelf__item">
                {content}
                <span>검색 인용만 허용 · 원문 공개 확인 중</span>
                <Link href="/hoondok/search" className="btn btn-line btn--sm">
                  말씀 검색하기
                </Link>
              </div>
            );
          })}
        </div>
      </div>
      <p className="notice">
        검색과 원문 공개 권한은 각각 확인합니다. 판본·화자·공식성이 확인되지 않은 값은 지어내지 않습니다.
      </p>
    </section>
  );
}
