import type { MyAskSummary, Source } from "@truewords/api-client-ts/types";
import { stripFileExt } from "@/lib/utils";
import { formatKstDate, formatKstMonthDay } from "../today";
import { answerModeInfo } from "./modes";

// AI 질문 표시 문구 (순수 함수). 저장된 값은 UTC ISO 라 보여 줄 때만 KST 로 바꾼다.

/** 오늘이면 "오늘", 아니면 "9월 14일". 프로토타입 `.ql-m` 의 표기다. */
export function askDateLabel(createdAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  const { iso } = formatKstDate(created);
  if (iso === formatKstDate(now).iso) return "오늘";
  return formatKstMonthDay(created);
}

/** 상세 제목 아래 날짜 "2026.11.03" (KST). */
export function askFullDate(createdAt: string): string {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return "";
  return formatKstDate(created).iso.replaceAll("-", ".");
}

/**
 * 목록 한 줄의 보조 문구 — 날짜 · 답한 모델 · 이어 물은 수. 같은 질문을 다른 모델로 다시 물은 항목을
 * 모델 이름으로 구분한다(여정 테스트 P2).
 */
export function askMetaLabel(
  item: Pick<MyAskSummary, "created_at" | "answer_mode" | "turn_count">,
  now: Date = new Date(),
): string {
  const parts = [askDateLabel(item.created_at, now), answerModeInfo(item.answer_mode).label];
  if (item.turn_count > 1) parts.push(`이어서 ${item.turn_count - 1}번`);
  return parts.filter(Boolean).join(" · ");
}

/**
 * 근거 카드의 출처 이름. `/chat/stream` 의 sources 는 표시명(display_name)과 권(volume)만 주고 화자·판본·권위
 * 등급은 주지 않으므로 없는 항목을 지어내지 않는다. 관리자가 지정한 표시명이 있으면 그것을 쓰고 없으면 권으로
 * 되돌리는 것, 파일 확장자를 떼는 것 모두 시연 챗 인용 카드(`features/chat/components/assistant-message.tsx`)와 같다.
 */
export function sourceLabel(source: Pick<Source, "display_name" | "volume">): string {
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
