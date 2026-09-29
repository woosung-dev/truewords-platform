import type { LibraryItem, ReadingPositionItem, SectionItem } from "@truewords/api-client-ts/types";
import { kstDayOf } from "../kst";
import { formatKstDate } from "../today";
import { pageOfChunkIndex, verseNumber, WORDS_PAGE_SIZE, wordsPageHref } from "./api";
import type { LastReading } from "./last-reading";

// 이어 읽기 한 건을 고르고 문구로 바꾸는 순수 함수. 홈 미션 카드와 서고 "이어 읽기" 가 같은 규칙을 쓴다.
// 저장값은 "읽은 곳" 이 아니라 마지막으로 연 원문 구간의 첫 단락이다 — 그래서 "N단락부터" 로 말한다.

export type ResumeReading = {
  /** account = API-HD-025 서버 기록, device = 이 기기의 `hoondok:read:last` */
  source: "account" | "device";
  volume: string;
  /** 0부터인 청크 번호. 기기 기록은 원문 구간 첫 단락으로 환산한다(서고 업로드와 같은 환산) */
  chunkIndex: number;
  workTitle: string;
  /** 권 라벨(API-HD-025). 기기 기록에는 없다 */
  label: string | null;
  /** 마지막 기록 시각(서버 naive UTC). 기기 기록은 시각을 남기지 않는다 */
  updatedAt: string | null;
  authorityGrade: LibraryItem["authority_grade"];
};

/**
 * 로그인은 서버 기록 첫 항목(최신), 비로그인은 기기 기록. 어느 쪽이든 서고 목록(API-HD-014)에서
 * 원문 공개가 허용된 권일 때만 고른다 — 권리가 닫힌 권은 원문 링크를 만들지 않는다.
 */
export function pickResume({
  isLoggedIn,
  positions,
  device,
  items,
}: {
  isLoggedIn: boolean;
  positions: readonly ReadingPositionItem[];
  device: LastReading | null;
  items: readonly LibraryItem[];
}): ResumeReading | null {
  const readable = (volume: string) => items.find((item) => item.volume === volume && item.scope_full_text);
  if (isLoggedIn) {
    const latest = positions[0];
    const item = latest ? readable(latest.volume) : undefined;
    if (!latest || !item) return null;
    return {
      source: "account",
      volume: latest.volume,
      chunkIndex: latest.chunk_index,
      workTitle: latest.work_title,
      label: latest.label,
      updatedAt: latest.updated_at,
      authorityGrade: item.authority_grade,
    };
  }
  const item = device ? readable(device.volume) : undefined;
  if (!device || !item) return null;
  return {
    source: "device",
    volume: device.volume,
    chunkIndex: (device.page - 1) * WORDS_PAGE_SIZE,
    workTitle: item.work_title,
    label: null,
    updatedAt: null,
    authorityGrade: item.authority_grade,
  };
}

/** 원문 화면이 보여 주는 단락 번호(verseNumber)와 같은 N 을 쓴다. */
export function resumeFromPhrase(chunkIndex: number): string {
  return `${verseNumber(chunkIndex)}단락부터 이어 읽어요`;
}

/** chunk_index 를 품는 장. 편·장이 겹치면 더 좁은 장 — 원문 머리글(API-HD-016 section)과 같은 규칙이다. */
export function sectionAt(sections: readonly SectionItem[], chunkIndex: number): SectionItem | null {
  let found: SectionItem | null = null;
  for (const section of sections) {
    if (section.start_chunk_index > chunkIndex || section.end_chunk_index < chunkIndex) continue;
    if (!found || section.level > found.level || (section.level === found.level && section.position > found.position))
      found = section;
  }
  return found;
}

/** 마지막 기록이 KST 오늘·어제일 때만 붙인다. 그보다 오래된 기록은 경과를 드러내지 않는다(비처벌). */
export function resumeDayLabel(updatedAt: string | null, today: string): "오늘" | "어제" | null {
  const day = updatedAt ? kstDayOf(updatedAt) : null;
  if (day === null) return null;
  if (day === today) return "오늘";
  const yesterday = formatKstDate(new Date(new Date(`${today}T12:00:00+09:00`).getTime() - 86_400_000)).iso;
  return day === yesterday ? "어제" : null;
}

/** 이어 읽기 도착 링크. `from` 은 원문 화면의 도착 표시용이고 API 로 보내지 않는다. */
export function resumeHref(resume: ResumeReading): string {
  return `${wordsPageHref(resume.volume, pageOfChunkIndex(resume.chunkIndex))}&from=resume`;
}

/**
 * 홈 미션 카드 문구. 제목 = 저작물 + 장, 장이 없으면 저작물 + 권 라벨.
 * 장이 없는 권은 원문 구간 번호로 자리를 알리고 장·절로 꾸미지 않는다.
 */
export function resumeCard(
  resume: ResumeReading,
  sections: readonly SectionItem[],
  today: string,
): { title: string; meta: string; href: string } {
  const section = sectionAt(sections, resume.chunkIndex);
  const volumeName =
    resume.label && resume.label !== resume.workTitle ? `${resume.workTitle} ${resume.label}` : resume.workTitle;
  const title = section ? `${resume.workTitle} · ${section.title}` : volumeName;
  const meta = [
    section ? null : `원문 구간 ${pageOfChunkIndex(resume.chunkIndex)}`,
    resumeFromPhrase(resume.chunkIndex),
    resumeDayLabel(resume.updatedAt, today),
    resume.source === "device" ? "이 기기에서 읽던 곳" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { title, meta, href: resumeHref(resume) };
}
