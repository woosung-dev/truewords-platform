// 말씀 글자 크기 (설정 화면 "그 밖의 설정"). 이 기기 localStorage 한 키에만 두고 계정·서버에 올리지 않는다.
// 고른 값은 훈독 루트에 CSS 변수 --read-scale 로 걸리고, 원문 단락·훈독하기 본문·AI 답 본문의 글자 크기가
// 이 값을 곱한다(rem 토큰 × 배율). 저장소는 없거나 던질 수 있어(사생활 모드·차단) 모든 접근을 try/catch 로 감싼다.

export const TEXT_SCALES = [
  { id: "normal", label: "보통", scale: 1 },
  { id: "large", label: "크게", scale: 1.125 },
  { id: "larger", label: "더 크게", scale: 1.25 },
  { id: "largest", label: "아주 크게", scale: 1.375 },
] as const;

export type TextScaleId = (typeof TEXT_SCALES)[number]["id"];

const KEY = "hoondok:text-scale";
const CHANGE_EVENT = "hoondok:text-scale-change";
const ROOT_SELECTOR = '[data-app="hoondok"]';
const PROPERTY = "--read-scale";

/** 모르는 값·빈 값은 "보통"으로 본다. */
export function toTextScaleId(raw: unknown): TextScaleId {
  return TEXT_SCALES.find((option) => option.id === raw)?.id ?? "normal";
}

export function textScaleValue(id: TextScaleId): number {
  return TEXT_SCALES.find((option) => option.id === id)?.scale ?? 1;
}

export function readTextScale(): TextScaleId {
  try {
    return toTextScaleId(window.localStorage.getItem(KEY));
  } catch {
    return "normal";
  }
}

export function writeTextScale(id: TextScaleId): void {
  try {
    if (id === "normal") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, id);
  } catch {
    // 저장이 막혀도 이번 화면에는 바로 걸린다(아래 알림)
  }
  try {
    window.dispatchEvent(new CustomEvent<TextScaleId>(CHANGE_EVENT, { detail: id }));
  } catch {
    // SSR·구형 환경
  }
}

/** useSyncExternalStore 용 구독 — 같은 탭의 write 와 다른 탭의 storage 이벤트. */
export function subscribeTextScale(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** 훈독 루트에 배율을 건다. "보통"이면 변수를 지워 CSS 기본값(1)으로 돌아간다. */
export function applyTextScale(root: HTMLElement, id: TextScaleId): void {
  if (id === "normal") root.style.removeProperty(PROPERTY);
  else root.style.setProperty(PROPERTY, String(textScaleValue(id)));
}

export function findHoondokRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ROOT_SELECTOR);
}

const SCALE_BY_ID = Object.fromEntries(
  TEXT_SCALES.filter((option) => option.scale !== 1).map((option) => [option.id, option.scale]),
);

/**
 * 첫 페인트 전에 저장값을 거는 인라인 스크립트. 서버 HTML 을 읽는 순간 한 번 실행되고(클라이언트 렌더로 넣은
 * 스크립트는 실행되지 않는다) 그 뒤는 마운트 컴포넌트가 맡는다. 서버는 localStorage 를 읽지 않는다.
 */
export const TEXT_SCALE_SCRIPT = `(function(){try{var s=${JSON.stringify(SCALE_BY_ID)}[localStorage.getItem(${JSON.stringify(KEY)})];var c=document.currentScript;var r=c&&c.closest(${JSON.stringify(ROOT_SELECTOR)});if(typeof s==="number"&&r)r.style.setProperty(${JSON.stringify(PROPERTY)},String(s))}catch(e){}})();`;
