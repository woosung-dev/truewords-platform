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
function sourceLabel(source: Source): string {
  return stripFileExt(source.display_name?.trim() || source.volume);
}

/** 출처 줄의 한 칸. `isUnknown` 이면 색을 한 단계 낮춰 값이 아니라 결측임을 형태로도 알린다. */
export type SourceField = { id: string; text: string; isUnknown: boolean };

/** 등급을 모를 때의 공식성 표기. 초록 `badge--rank` 는 O1·O2 정본 전용이라 쓰지 않는다 (DES §2.3). */
export const SOURCE_RANK_UNKNOWN = "공식성 확인되지 않음";

/**
 * 근거 카드 출처 줄의 칸들. 순서는 DES-PWA-003 §2.2 의 화자 · 저작물 · 위치 · 판본 · 공식성이고,
 * `/chat/stream` 이 주지 않는 칸은 지어내지 않고 "확인되지 않음"으로 적는다 (REQ-PWA-012 · AC-017-02).
 */
export function sourceFields(source: Source): SourceField[] {
  return [
    { id: "speaker", text: "화자 확인되지 않음", isUnknown: true },
    { id: "work", text: sourceLabel(source), isUnknown: false },
    { id: "edition", text: "판본 확인되지 않음", isUnknown: true },
  ];
}
