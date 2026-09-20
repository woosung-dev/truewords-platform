// SCR-PWA-009 원문 뷰 (PLAN-HD-002 W3-L). 프리뷰 플래그 뒤에만 존재하고 fixture 에 없는 id 는 404 다.
// 본문은 오늘 말씀이 편성돼 있으면 그 글을 그대로 읽기 셸에 넣고(출처 줄도 그 말씀의 것),
// 없으면 fixture 예시 단락을 쓴다 — 예시 말씀을 새로 지어내지 않는다.
import { notFound } from "next/navigation";
import { loadToday } from "@/features/hoondok/api";
import { isHoondokPreviewEnabled } from "@/features/hoondok/flag";
import type { WordsDocument } from "@/features/hoondok/library/components/words-screen";
import { WordsScreen } from "@/features/hoondok/library/components/words-screen";
import { findPreviewWord } from "@/features/hoondok/preview/fixtures/library";
import type { TodayReading } from "@/features/hoondok/today";

/** 오늘 말씀 전문을 단락 번호가 붙은 읽기 단위로 나눈다. 빈 줄은 버린다. */
function toDocument(reading: TodayReading): WordsDocument {
  const paragraphs = reading.body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    title: reading.title,
    source: [reading.speaker, reading.spoken_on, reading.work_title, reading.edition].filter((part): part is string =>
      Boolean(part),
    ),
    grade: reading.authority_grade,
    verses: paragraphs.map((text, index) => ({ no: index + 1, segments: [{ text }] })),
  };
}

export default async function HoondokWordsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isHoondokPreviewEnabled()) notFound();
  const { id } = await params;
  const word = findPreviewWord(id);
  if (!word) notFound();

  const today = await loadToday();
  const reading = today.status === "available" ? today.reading : null;
  const doc: WordsDocument = reading
    ? toDocument(reading)
    : { title: word.title, source: word.source, grade: word.grade, verses: word.verses };

  return <WordsScreen doc={doc} toc={word.toc} tocTitle={word.tocTitle} />;
}
