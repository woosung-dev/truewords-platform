"use client";

import { BellRing, Download, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { isPwaEnabled, registerServiceWorker } from "@/components/pwa/pwa-register";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export const NEUTRAL_NOTIFICATION = { title: "훈독", body: "오늘의 읽을거리가 준비됐어요" } as const;

function detectIos(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export default function HoondokPwaDemo() {
  const enabled = isPwaEnabled();
  const [swState, setSwState] = useState<"idle" | "registered" | "unsupported" | "disabled">("idle");
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [lastAction, setLastAction] = useState<string>("");

  useEffect(() => {
    setIsIos(detectIos(navigator.userAgent));
    setInstalled(detectStandalone());
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
    if (!enabled) {
      setSwState("disabled");
    } else if (!("serviceWorker" in navigator)) {
      setSwState("unsupported");
    } else {
      void registerServiceWorker().then((reg) => setSwState(reg ? "registered" : "unsupported"));
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled]);

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setLastAction(outcome === "accepted" ? "설치를 수락했어요" : "설치를 건너뛰었어요");
    setInstallEvent(null);
  }

  // 권한 요청은 사용자의 탭 직후에만 실행한다 (REQ-PWA-010 · AC-PWA-010-01).
  async function handleNotify() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") {
      setLastAction("권한이 허용되지 않았어요. 같은 내용은 앱 안 알림함에서 볼 수 있어요.");
      return;
    }
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(NEUTRAL_NOTIFICATION.title, {
        body: NEUTRAL_NOTIFICATION.body,
        icon: "/icons/hoondok-192.png",
        tag: "hoondok-demo",
        data: { url: "/hoondok" },
      });
      setLastAction("중립 문구로 로컬 알림을 표시했어요 (서버 발송 아님)");
    } else {
      setLastAction("서비스워커가 없어 알림을 표시하지 못했어요");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8 pb-safe">
      <p className="text-center font-mono text-[11px] tracking-wide text-muted-foreground">
        독립 운영 베타 · FFWPU 공식 앱 아님 · PWA 셸 데모
      </p>
      <header className="flex items-center gap-3">
        <img src="/icons/hoondok.svg" alt="" width={56} height={56} className="rounded-2xl" />
        <div>
          <h1 className="text-2xl font-semibold">훈독</h1>
          <p className="text-sm text-muted-foreground">새벽 한 문단으로 여는 하루</p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> 서비스워커
          </CardTitle>
          <CardDescription>
            {swState === "registered" && "등록됨 · 앱 셸과 아이콘만 캐시해요. 질문·메모·API 응답은 캐시하지 않아요."}
            {swState === "disabled" && "꺼짐 · NEXT_PUBLIC_PWA_ENABLED=1 로 실행하면 등록해요."}
            {swState === "unsupported" && "이 브라우저는 서비스워커를 지원하지 않아요. 읽기 기능은 그대로 쓸 수 있어요."}
            {swState === "idle" && "확인 중…"}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4" /> 홈 화면에 설치
          </CardTitle>
          <CardDescription>
            {installed
              ? "설치된 앱으로 열려 있어요."
              : isIos
                ? "iPhone·iPad: Safari 공유 버튼 → “홈 화면에 추가”. 설치한 뒤에만 알림을 받을 수 있어요 (iOS 16.4+)."
                : installEvent
                  ? "브라우저가 설치를 지원해요."
                  : "브라우저가 설치 창을 준비하면 버튼이 나타나요. 설치하지 않아도 모든 읽기 기능을 쓸 수 있어요."}
          </CardDescription>
        </CardHeader>
        {installEvent && !installed ? (
          <CardContent>
            <Button onClick={handleInstall} className="w-full">
              <Download data-icon="inline-start" /> 설치
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="size-4" /> 알림 (중립 문구)
          </CardTitle>
          <CardDescription>
            잠금 화면에는 “{NEUTRAL_NOTIFICATION.body}” 처럼 중립 문구만 보여요. 질문·기도·가족 상황·말씀 전문은 넣지
            않아요. 권한은 아래 버튼을 탭한 직후에만 요청해요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {permission === "unsupported" ? (
            <p className="text-sm text-muted-foreground">이 브라우저는 알림을 지원하지 않아요.</p>
          ) : permission === "denied" ? (
            <p className="text-sm text-muted-foreground">
              권한이 거부됐어요. 브라우저·OS 설정에서 바꿀 수 있고, 앱은 다시 묻지 않아요.
            </p>
          ) : (
            <Button onClick={handleNotify} className="w-full" disabled={swState !== "registered"}>
              <BellRing data-icon="inline-start" />
              {permission === "granted" ? "중립 문구 알림 다시 표시" : "알림 켜기 — 탭하면 브라우저가 권한을 물어요"}
            </Button>
          )}
          {swState !== "registered" ? (
            <p className="text-xs text-muted-foreground">서비스워커가 등록된 뒤에 표시할 수 있어요.</p>
          ) : null}
          {lastAction ? (
            <p className="text-sm" aria-live="polite">
              {lastAction}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        이 화면은 PWA 셸(manifest · 서비스워커 · 설치 · 권한)만 확인해요. 서버 발송(VAPID)·구독 저장·알림함은 M5 백엔드
        범위예요. 제품 화면은 docs/prd/prototypes 의 훈독 프로토타입을 따라요.
      </p>
    </main>
  );
}
