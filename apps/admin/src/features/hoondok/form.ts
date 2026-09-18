import { isIsoDate } from "./dates";
import { GRADE_LABEL, REVIEW_LABEL } from "./labels";
import type { AuthorityGrade, DailyReading, DailyReadingAdminCreate, ReviewStatus } from "./types";

// 편성 폼의 순수 로직 — 값·검증·페이로드. React 없이 테스트한다.
// 폼 상태는 전부 문자열이다(input 값 그대로). 숫자·null 변환은 toPayload 에서만 한다.

export interface DailyReadingFormValues {
  reading_date: string;
  title: string;
  body: string;
  speaker: string;
  spoken_on: string;
  work_title: string;
  edition: string;
  authority_grade: AuthorityGrade;
  review_status: ReviewStatus;
  source_note: string;
  chunk_id: string;
  estimated_minutes: string;
}

export type FormErrors = Partial<Record<keyof DailyReadingFormValues, string>>;

/** ENT-HD-002 varchar 길이. 서버 422 를 화면에서 먼저 잡는다. */
const MAX_LENGTH = {
  title: 200,
  speaker: 64,
  spoken_on: 32,
  work_title: 200,
  edition: 120,
  source_note: 500,
  chunk_id: 128,
} as const;

const REQUIRED_TEXT = ["title", "body", "speaker", "work_title"] as const;

/** 새 편성 기본값. 등급은 보수적으로 R(권리 확인 중), 검수는 unverified(서버 기본과 같다). */
export function emptyValues(reading_date = ""): DailyReadingFormValues {
  return {
    reading_date,
    title: "",
    body: "",
    speaker: "",
    spoken_on: "",
    work_title: "",
    edition: "",
    authority_grade: "R",
    review_status: "unverified",
    source_note: "",
    chunk_id: "",
    estimated_minutes: "3",
  };
}

/** 저장된 편성 → 폼 값. null 은 빈 문자열로. */
export function fromReading(reading: DailyReading): DailyReadingFormValues {
  return {
    reading_date: reading.reading_date,
    title: reading.title,
    body: reading.body,
    speaker: reading.speaker,
    spoken_on: reading.spoken_on ?? "",
    work_title: reading.work_title,
    edition: reading.edition ?? "",
    authority_grade: reading.authority_grade,
    review_status: reading.review_status,
    source_note: reading.source_note ?? "",
    chunk_id: reading.chunk_id ?? "",
    estimated_minutes: String(reading.estimated_minutes),
  };
}

export function validate(values: DailyReadingFormValues): FormErrors {
  const errors: FormErrors = {};
  const date = values.reading_date.trim();
  if (!date) errors.reading_date = "편성일은 필수예요";
  else if (!isIsoDate(date)) errors.reading_date = "날짜는 YYYY-MM-DD 형식이어야 해요";

  for (const key of REQUIRED_TEXT) {
    if (!values[key].trim()) errors[key] = "필수 항목이에요";
  }
  for (const [key, max] of Object.entries(MAX_LENGTH) as [keyof typeof MAX_LENGTH, number][]) {
    if (!errors[key] && values[key].trim().length > max) errors[key] = `${max}자 이내로 입력해 주세요`;
  }
  if (!(values.authority_grade in GRADE_LABEL)) errors.authority_grade = "공식성 등급을 선택해 주세요";
  if (!(values.review_status in REVIEW_LABEL)) errors.review_status = "검수 상태를 선택해 주세요";

  const minutesText = values.estimated_minutes.trim();
  const minutes = Number(minutesText);
  if (!minutesText || !Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    errors.estimated_minutes = "1~60 사이 정수여야 해요";
  }
  return errors;
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** POST 본문. PUT 도 같은 값을 보낸다(전체 필드 전송 — exclude_unset 이라 안전하고 diff 보다 단순). */
export function toPayload(values: DailyReadingFormValues): DailyReadingAdminCreate {
  return {
    reading_date: values.reading_date.trim(),
    title: values.title.trim(),
    body: values.body.trim(),
    speaker: values.speaker.trim(),
    spoken_on: optional(values.spoken_on),
    work_title: values.work_title.trim(),
    edition: optional(values.edition),
    authority_grade: values.authority_grade,
    review_status: values.review_status,
    source_note: optional(values.source_note),
    chunk_id: optional(values.chunk_id),
    estimated_minutes: Number(values.estimated_minutes.trim()),
  };
}
