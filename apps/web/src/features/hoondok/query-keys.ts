// 훈독 진행 상태 React Query 키 (PLAN-HD-002 W0-W). 요약·정성·기록 화면이 각자 키를 만들지 않고 여기서 가져간다.
// 미션 완료 한 번이 세 캐시를 함께 무효화해야 하므로 PROGRESS_KEYS 로 묶는다.
export const SUMMARY_KEY = ["hoondok", "summary"] as const;
export const JEONGSEONG_TODAY_KEY = ["hoondok", "jeongseong-today"] as const;
export const JEONGSEONG_KEY = ["hoondok", "jeongseong"] as const;
export const HISTORY_KEY = ["hoondok", "history"] as const;
/** 함께 읽는 사람들 익명 숫자 (PLAN-HD-009). 사용자별 값이 아니며 훈독하기 완료 직후 다시 읽는다. */
export const TOGETHER_KEY = ["hoondok", "together"] as const;

/** 월별 기록 (YYYY-MM). HISTORY_KEY 접두 무효화에 함께 잡힌다. */
export const historyKey = (month: string) => [...HISTORY_KEY, month] as const;

/** 미션 완료 성공(recorded·already) 시 순회 무효화하는 키 — 접두 매칭이라 historyKey(month) 도 포함된다.
 *  together 는 서버 캐시(60초) 때문에 즉시 바뀌지 않을 수 있다 — 화면은 받은 값을 그대로 쓴다(+1 보정 없음). */
export const PROGRESS_KEYS = [SUMMARY_KEY, JEONGSEONG_KEY, HISTORY_KEY, TOGETHER_KEY] as const;

// --- 말씀 서고·읽기 기록 (PLAN-HD-007). 진행 상태와 무효화 주기가 달라 PROGRESS_KEYS 에 넣지 않는다.
export const LIBRARY_KEY = ["hoondok", "library"] as const;
export const MARKS_KEY = ["hoondok", "marks"] as const;
export const READING_POSITIONS_KEY = ["hoondok", "reading-positions"] as const;

export const seriesKey = (series: string) => ["hoondok", "series", series] as const;
export const sectionsKey = (volume: string) => ["hoondok", "sections", volume] as const;
/** 권별 표시 목록. 접두가 MARKS_KEY 라 표시 1건이 바뀌면 서고 북마크 절도 함께 무효화된다. */
export const marksKey = (volume?: string) => [...MARKS_KEY, volume ?? "all"] as const;
export const wordsKey = (volume: string, page: number, query: { chunkId?: string; section?: number }) =>
  ["hoondok", "words", volume, page, query.chunkId ?? null, query.section ?? null] as const;
/** 서고 "북마크" 절 — 권 구분 없이 북마크만. 같은 접두라 표시 변경 한 번에 함께 무효화된다. */
export const BOOKMARKS_KEY = [...MARKS_KEY, "bookmark"] as const;
