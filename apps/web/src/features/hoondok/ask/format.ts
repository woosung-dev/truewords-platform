import type { Source } from "@truewords/api-client-ts/types";
import { stripFileExt } from "@/lib/utils";
import { formatKstDate } from "../today";
import type { AskItem } from "./storage";

// AI 질문 표시 문구 (순수 함수). 저장된 값은 UTC ISO 라 보여 줄 때만 KST 로 바꾼다.

/** 오늘이면 "오늘", 아니면 "9월 14일". 프로토타입 `.ql-m` 의 표기다. */
export function askDateLabel(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const { iso } = formatKstDate(created);
  if (iso === formatKstDate(now).iso) return "오늘";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(created);
}

/** 목록 한 줄의 보조 문구 — 날짜 · 답변 상태. 근거 수는 답이 있을 때만 의미가 있다. */
export function askMetaLabel(item: AskItem, now: Date = new Date()): string {
  const date = askDateLabel(item.createdAt, now);
  const state =
    item.status === "answered"
      ? `근거 말씀 ${item.sources?.length ?? 0}건`
      : item.status === "no-sources"
        ? "확인할 수 없음"
        : item.status === "error"
          ? "답을 받지 못함"
          : "답을 기다리는 중";
  return `${date} · ${state}`;
}

/**
 * 근거 카드의 출처 이름. `/chat/stream` 의 sources 는 표시명(display_name)과 권(volume)만 주고 화자·판본·권위
 * 등급은 주지 않으므로 없는 항목을 지어내지 않는다. 관리자가 지정한 표시명이 있으면 그것을 쓰고 없으면 권으로
 * 되돌리는 것, 파일 확장자를 떼는 것 모두 시연 챗 인용 카드(`features/chat/components/assistant-message.tsx`)와 같다.
 */
export function sourceLabel(source: Source): string {
  return stripFileExt(source.display_name?.trim() || source.volume);
}

/** 답 본문을 빈 줄 기준으로 나눈 단락. 빈 답이면 빈 배열이다. */
export function answerParagraphs(answer: string): string[] {
  return answer
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}
