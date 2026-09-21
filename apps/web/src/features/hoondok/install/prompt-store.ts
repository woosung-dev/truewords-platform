// beforeinstallprompt 보관소 (PLAN-HD-001 Phase 3 E). 이벤트는 페이지 로드당 한 번, 카드가 마운트되기 전에 발사될 수 있으므로
// hoondok layout 의 리스너가 잡아 모듈 변수에 두고, 카드는 나중에 꺼내 prompt() 한다. 클라이언트 라우팅에도 유지된다.
import { markInstalled, notifyInstallChange } from "./storage";

// lib.dom 에 없는 Chromium 전용 이벤트 타입
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let isListening = false;

/** 멱등. preventDefault 로 Chrome Android 의 미니 인포바를 막고 이벤트를 보관한다. */
export function listenForInstallPrompt(): () => void {
  if (isListening || typeof window === "undefined") return () => {};
  isListening = true;
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notifyInstallChange();
  };
  const onInstalled = () => {
    deferred = null;
    markInstalled();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
    isListening = false;
    deferred = null;
  };
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferred;
}

/** prompt() 는 한 번만 쓸 수 있으므로 사용한 뒤 비운다. */
export function consumeDeferredPrompt(): BeforeInstallPromptEvent | null {
  const event = deferred;
  deferred = null;
  notifyInstallChange();
  return event;
}
