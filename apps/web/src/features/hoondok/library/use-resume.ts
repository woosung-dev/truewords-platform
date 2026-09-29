"use client";

// 홈 "말씀 읽기 · 이어 읽기" 카드의 데이터. 서고와 같은 쿼리 키(LIBRARY_KEY·READING_POSITIONS_KEY·sectionsKey)를 써서
// 서고·원문 화면과 캐시를 나눠 쓴다. 어느 조회든 실패하면 기록 없음과 같은 기본 카드로 떨어진다.
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { LIBRARY_KEY, sectionsKey } from "../query-keys";
import { useKstDate } from "../use-kst-date";
import { libraryAPI } from "./api";
import { pickResume, resumeCard } from "./resume";
import { useLastReading, useReadingPositions } from "./use-reading";

export type ResumeCardState =
  | { status: "pending" }
  | { status: "none" }
  | { status: "ready"; title: string; meta: string; href: string };

const PENDING: ResumeCardState = { status: "pending" };
const NONE: ResumeCardState = { status: "none" };

export function useResumeCard(): ResumeCardState {
  const { user, isLoading } = useCurrentUser();
  const isLoggedIn = Boolean(user);
  const device = useLastReading();
  const positions = useReadingPositions(isLoggedIn);
  const today = useKstDate();
  // 고를 기록이 있을 때만 서고 목록을 부른다 — 기록 없는 홈에서 요청을 늘리지 않는다
  const hasCandidate = isLoggedIn ? positions.items.length > 0 : device !== null;
  const library = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: libraryAPI.list,
    enabled: hasCandidate,
    retry: false,
    staleTime: 0,
  });
  const resume = library.data
    ? pickResume({ isLoggedIn, positions: positions.items, device, items: library.data.items })
    : null;
  const volume = resume?.volume ?? "";
  const sections = useQuery({
    queryKey: sectionsKey(volume),
    queryFn: ({ signal }) => libraryAPI.sections(volume, signal),
    enabled: resume !== null,
    retry: false,
    staleTime: 0,
  });

  if (isLoading || positions.isPending) return PENDING;
  if (!hasCandidate || library.isError) return NONE;
  if (library.isPending) return PENDING;
  if (!resume || sections.isError) return NONE;
  if (sections.isPending) return PENDING;
  return { status: "ready", ...resumeCard(resume, sections.data.sections, today) };
}
