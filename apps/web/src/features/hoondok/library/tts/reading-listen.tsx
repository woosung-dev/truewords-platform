"use client";

// PLAN-HD-011 오늘 훈독(/hoondok/read) 말씀 듣기. 단락 = 본문을 빈 줄로 나눈 덩어리(서버 split_paragraphs 와 같은 규칙).
// AI 목소리는 말씀 id + 단락 번호만 보낸다 — 편성 말씀이든 내 정성 말씀이든 서버가 본문을 직접 찾는다.
// [가정] 오늘 말씀은 짧아(편성 약 3분) 원문 뷰처럼 읽는 단락을 강조하지 않고 진행 막대·단락 번호만 보인다.
import { useCallback, useMemo } from "react";
import type { TodayReading } from "../../today";
import { TtsBar } from "./tts-bar";
import { useReadAloud } from "./use-read-aloud";
import { type AiVoiceId, readingAudioUrl, splitReadingParagraphs } from "./voice-api";

export function ReadingListen({ reading }: { reading: TodayReading }) {
  const paragraphs = useMemo(
    () => splitReadingParagraphs(reading.body).map((text, index) => ({ id: `${reading.id}:${index}`, text })),
    [reading.id, reading.body],
  );
  const audioUrl = useCallback(
    (index: number, voice: AiVoiceId) => readingAudioUrl(reading.id, index, voice),
    [reading.id],
  );
  const reader = useReadAloud(paragraphs, reading.id, audioUrl);
  if (paragraphs.length === 0) return null;
  return <TtsBar reader={reader} title="듣기 · 오늘 말씀" total={paragraphs.length} nextHref={null} />;
}
