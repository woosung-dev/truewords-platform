// 맞춤 첫 말씀 답·마음 한 장 한 줄은 이 기기 localStorage 에만 둔다(신앙·마음은 민감정보). 서버·분석·오류 수집으로 보내지 않는다.
// 키는 `hoondok:` 접두라 로그아웃 "이 기기 기록 지우기"·계정 삭제·기기 주인 변경(clearHoondokStorage)이 함께 지운다.
// 저장소는 없거나 던질 수 있으므로(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다 — cards/storage.ts 와 같은 관례.
import {
  CRISIS_MOOD_ID,
  isInterestId,
  isMoodId,
  MAX_MOODS,
  READING_LENGTH_OPTIONS,
  READING_TIME_OPTIONS,
} from "./options";

export const ANSWERS_KEY = "hoondok:personal:answers";
export const NOTE_KEY = "hoondok:personal:note";
const CHANGE_EVENT = "hoondok:personal-change";

/** 마음 한 장 한 줄 최대 글자 수(시안 pray). */
export const NOTE_MAX_LENGTH = 100;

export type PersonalAnswers = {
  interests: string[];
  /** 위기 선택지를 뺀 마음, 두 개까지 */
  moods: string[];
  /** 오늘(KST) "많이 힘들어요"를 골랐는가. 오래 둘 상태가 아니라 날짜가 지나면 꺼진다 */
  isCrisis: boolean;
  readingTime: string | null;
  readingLength: string | null;
};

export const EMPTY_ANSWERS: PersonalAnswers = {
  interests: [],
  moods: [],
  isCrisis: false,
  readingTime: null,
  readingLength: null,
};

export type PersonalNote = { date: string; cardId: string | null; text: string };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // SSR
  }
}

/** 원시 문자열 읽기. useSyncExternalStore 스냅샷은 문자열로 받아야 값 비교가 된다. 실패는 "" (없음). */
export function readRaw(key: string): string {
  try {
    return storage()?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // 저장 실패해도 화면은 지금 고른 값으로 이어간다(다음 방문에 다시 묻는다)
  }
  notify();
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // 무시
  }
  notify();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function oneOf(value: unknown, ids: readonly { id: string }[]): string | null {
  return typeof value === "string" && ids.some((o) => o.id === value) ? value : null;
}

/** 저장 문자열 → 답. 모르는 id·잘못된 형식은 버리고, 마음은 두 개로 자른다. 위기 표시는 오늘 날짜일 때만 켠다. */
export function parseAnswers(raw: string, today: string): PersonalAnswers {
  if (!raw) return EMPTY_ANSWERS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_ANSWERS;
  }
  if (typeof data !== "object" || data === null) return EMPTY_ANSWERS;
  const record = data as Record<string, unknown>;
  return {
    interests: [...new Set(stringList(record.interests).filter(isInterestId))],
    moods: [...new Set(stringList(record.moods).filter((id) => isMoodId(id) && id !== CRISIS_MOOD_ID))].slice(
      0,
      MAX_MOODS,
    ),
    isCrisis: record.crisisOn === today,
    readingTime: oneOf(record.readingTime, READING_TIME_OPTIONS),
    readingLength: oneOf(record.readingLength, READING_LENGTH_OPTIONS),
  };
}

export function readAnswers(today: string): PersonalAnswers {
  return parseAnswers(readRaw(ANSWERS_KEY), today);
}

/** 답을 고른 적이 있는가(관심 주제나 마음이 하나라도 있으면). 홈의 "고르기" 줄을 보일지 정한다. */
export function hasAnswers(answers: PersonalAnswers): boolean {
  return answers.interests.length > 0 || answers.moods.length > 0;
}

/**
 * 답 저장. `moods` 에 위기 선택지가 있으면 목록에서 빼고 오늘 날짜만 남긴다(두 개 제한 밖, 다음 날 꺼짐).
 * `isCrisis: true` 로도 같은 표시를 남길 수 있다.
 */
export function writeAnswers(
  answers: Partial<Omit<PersonalAnswers, "isCrisis">> & { isCrisis?: boolean },
  today: string,
): void {
  const moods = answers.moods ?? [];
  const isCrisis = Boolean(answers.isCrisis) || moods.includes(CRISIS_MOOD_ID);
  const value = {
    interests: [...new Set((answers.interests ?? []).filter(isInterestId))],
    moods: [...new Set(moods.filter((id) => isMoodId(id) && id !== CRISIS_MOOD_ID))].slice(0, MAX_MOODS),
    crisisOn: isCrisis ? today : null,
    readingTime: oneOf(answers.readingTime, READING_TIME_OPTIONS),
    readingLength: oneOf(answers.readingLength, READING_LENGTH_OPTIONS),
  };
  write(ANSWERS_KEY, JSON.stringify(value));
}

export function clearAnswers(): void {
  remove(ANSWERS_KEY);
}

/** 마음 한 장 한 줄. 마지막 한 장만 둔다. */
export function parseNote(raw: string): PersonalNote | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const { date, cardId, text } = data as Record<string, unknown>;
    if (typeof date !== "string" || typeof text !== "string") return null;
    return { date, cardId: typeof cardId === "string" ? cardId : null, text: text.slice(0, NOTE_MAX_LENGTH) };
  } catch {
    return null;
  }
}

export function readNote(): PersonalNote | null {
  return parseNote(readRaw(NOTE_KEY));
}

/** 한 줄 저장. 앞뒤 공백을 떼고 비면 지운다. */
export function writeNote(note: PersonalNote): void {
  const text = note.text.trim().slice(0, NOTE_MAX_LENGTH);
  if (!text) {
    remove(NOTE_KEY);
    return;
  }
  write(NOTE_KEY, JSON.stringify({ date: note.date, cardId: note.cardId, text }));
}

export function clearNote(): void {
  remove(NOTE_KEY);
}

/** useSyncExternalStore 용 구독 — 같은 탭 write 와 다른 탭 storage 이벤트. */
export function subscribePersonal(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
