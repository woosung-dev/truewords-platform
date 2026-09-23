import type { OfficialJeongseongInput, OfficialJeongseongOut } from "@truewords/api-client-ts/types";
import { addDays, isIsoDate } from "./dates";

// 공식 정성 폼·상태의 순수 로직 (API-HD-042). React 없이 테스트한다.
// 폼 값은 전부 문자열(input 그대로)이고 숫자·null 변환은 toJeongseongPayload 에서만 한다.

export type OfficialJeongseong = OfficialJeongseongOut;

export interface JeongseongFormValues {
  title: string;
  started_on: string;
  duration_days: string;
  source_note: string;
}

export type JeongseongFormErrors = Partial<Record<keyof JeongseongFormValues, string>>;

/** 서버 `OfficialJeongseongInput` 제약과 같다. 422 를 화면에서 먼저 잡는다. */
export const TITLE_MAX = 40;
export const SOURCE_NOTE_MAX = 200;
export const DURATION_MIN = 1;
export const DURATION_MAX = 100;

export function emptyJeongseongValues(started_on = ""): JeongseongFormValues {
  return { title: "", started_on, duration_days: "40", source_note: "" };
}

export function fromJeongseong(item: OfficialJeongseong): JeongseongFormValues {
  return {
    title: item.title,
    started_on: item.started_on,
    duration_days: String(item.duration_days),
    source_note: item.source_note ?? "",
  };
}

export function validateJeongseong(values: JeongseongFormValues): JeongseongFormErrors {
  const errors: JeongseongFormErrors = {};
  const title = values.title.trim();
  if (!title) errors.title = "제목은 필수예요";
  else if (title.length > TITLE_MAX) errors.title = `${TITLE_MAX}자 이내로 입력해 주세요`;

  const date = values.started_on.trim();
  if (!date) errors.started_on = "시작일은 필수예요";
  else if (!isIsoDate(date)) errors.started_on = "날짜는 YYYY-MM-DD 형식이어야 해요";

  const durationText = values.duration_days.trim();
  const duration = Number(durationText);
  if (!durationText || !Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
    errors.duration_days = `${DURATION_MIN}~${DURATION_MAX} 사이 정수여야 해요`;
  }

  if (values.source_note.trim().length > SOURCE_NOTE_MAX) {
    errors.source_note = `${SOURCE_NOTE_MAX}자 이내로 입력해 주세요`;
  }
  return errors;
}

/** POST·PUT 본문(PUT 은 전체 교체). 빈 출처 메모는 null. */
export function toJeongseongPayload(values: JeongseongFormValues): OfficialJeongseongInput {
  const note = values.source_note.trim();
  return {
    title: values.title.trim(),
    started_on: values.started_on.trim(),
    duration_days: Number(values.duration_days.trim()),
    source_note: note === "" ? null : note,
  };
}

export type JeongseongStatus = "active" | "upcoming" | "ended";

export const JEONGSEONG_STATUS_LABEL: Record<JeongseongStatus, string> = {
  active: "진행 중",
  upcoming: "예정",
  ended: "끝남",
};

/** 마지막 날(포함) = 시작일 + 기간 - 1. 기간 1일이면 시작일 당일. */
export function jeongseongEndDate(started_on: string, duration_days: number): string {
  return addDays(started_on, duration_days - 1);
}

/**
 * KST 오늘 기준 진행 상태. 서버 `day_index = (오늘 - started_on) + 1` 과 같은 계산이다.
 * ISO 날짜 문자열은 사전순 = 날짜순이라 문자열 비교로 충분하다. 마지막 날 당일은 진행 중이다.
 */
export function jeongseongStatus(
  started_on: string,
  duration_days: number,
  todayIso: string,
): { status: JeongseongStatus; dayIndex: number | null } {
  if (todayIso < started_on) return { status: "upcoming", dayIndex: null };
  if (todayIso > jeongseongEndDate(started_on, duration_days)) return { status: "ended", dayIndex: null };
  const [y1, m1, d1] = started_on.split("-").map(Number);
  const [y2, m2, d2] = todayIso.split("-").map(Number);
  const diff = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000;
  return { status: "active", dayIndex: diff + 1 };
}
