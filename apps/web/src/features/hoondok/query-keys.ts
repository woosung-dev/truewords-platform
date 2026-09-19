// 훈독 진행 상태 React Query 키 (PLAN-HD-002 W0-W). 요약·정성·기록 화면이 각자 키를 만들지 않고 여기서 가져간다.
// 미션 완료 한 번이 세 캐시를 함께 무효화해야 하므로 PROGRESS_KEYS 로 묶는다.
export const SUMMARY_KEY = ["hoondok", "summary"] as const;
export const JEONGSEONG_KEY = ["hoondok", "jeongseong"] as const;
export const HISTORY_KEY = ["hoondok", "history"] as const;

/** 월별 기록 (YYYY-MM). HISTORY_KEY 접두 무효화에 함께 잡힌다. */
export const historyKey = (month: string) => [...HISTORY_KEY, month] as const;

/** 미션 완료 성공(recorded·already) 시 순회 무효화하는 키 — 접두 매칭이라 historyKey(month) 도 포함된다. */
export const PROGRESS_KEYS = [SUMMARY_KEY, JEONGSEONG_KEY, HISTORY_KEY] as const;
