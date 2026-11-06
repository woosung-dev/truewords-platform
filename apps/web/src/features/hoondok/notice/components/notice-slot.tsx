"use client";

import { Check, Smartphone } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import {
  INSTALL_AFTER_READ_SUB,
  INSTALL_AFTER_READ_TITLE,
  INSTALL_CARD_BODY,
  INSTALL_CARD_TITLE,
  INSTALL_HOWTO_LABEL,
  INSTALL_HOWTO_TITLE,
  IOS_INSTALL_STEPS,
} from "@/features/hoondok/install/components/install-card";
import { recordInstallVisit } from "@/features/hoondok/install/storage";
import { type InstallVariant, useInstallCard } from "@/features/hoondok/install/use-install-card";
import { PushPromptNotice } from "@/features/hoondok/notifications/components/push-prompt-card";
import { screenFor } from "@/features/hoondok/screens";
import { formatKstDate } from "@/features/hoondok/today";
import { collapseNotice, expandNotice, useNoticeState } from "../notice-store";
import { NoticeFrame } from "./notice-frame";

// 하단 안내 자리 (hoondok layout 에만 마운트). 설치 권유·알림 제안은 모두 여기서만 그린다 — 화면은 useNoticeSignal 로
// 지금이 어떤 순간인지만 알린다. 한 번에 하나만 보이고 설치가 먼저다: 설치하면(standalone) 같은 자리에 알림 제안이 온다.
// 설정(자기 설치 카드가 있음)·질문 흐름·로그인·오프라인·탭 바 없는 화면에는 싣지 않는다.
const SKIP_MATCHES = new Set(["/settings", "/onboarding", "/offline"]);

export const INSTALL_NOTICE_SUB: Record<Exclude<InstallVariant, "hidden">, string> = {
  ios: "한 번만 해 두면 돼요",
  prompt: "버튼 한 번이면 설치돼요",
  manual: "한 번만 해 두면 돼요",
};

function isSlotScreen(pathname: string): boolean {
  const screen = screenFor(pathname);
  return !screen.hideNav && screen.variant !== "onb" && !SKIP_MATCHES.has(screen.match);
}

export function HoondokNoticeSlot() {
  const pathname = usePathname();
  const { signal, expanded } = useNoticeState();
  const install = useInstallCard();

  // 방문은 하루 한 번 센다 — 서로 다른 날 두 번째 방문부터 설치 자격(storage.recordInstallVisit).
  useEffect(() => {
    recordInstallVisit(formatKstDate().iso);
  }, []);

  if (!isSlotScreen(pathname)) return null;
  const isAfterRead = signal?.placement === "after-read";
  // 훈독하기에서는 읽는 동안 비워 둔다 — 다 읽었다는 신호가 오면 그때 권한다.
  const isReading = screenFor(pathname).match === "/read" && !isAfterRead;

  if (install.variant !== "hidden" && !isReading) {
    return (
      <InstallNotice
        variant={install.variant}
        isAfterRead={isAfterRead}
        isExpanded={expanded === "install"}
        onInstall={() => void install.promptInstall()}
        onDismiss={() => {
          collapseNotice();
          install.dismiss();
        }}
      />
    );
  }
  // 알림 제안은 홈과 훈독 완료 뒤에서만 묻는다(push-prompt-policy). 자리가 바뀌면 새 카드로 본다.
  if (signal) {
    return (
      <PushPromptNotice
        key={signal.placement}
        placement={signal.placement}
        isReadDone={signal.isReadDone}
        isExpanded={expanded === "push"}
      />
    );
  }
  return null;
}

function InstallNotice({
  variant,
  isAfterRead,
  isExpanded,
  onInstall,
  onDismiss,
}: {
  variant: Exclude<InstallVariant, "hidden">;
  isAfterRead: boolean;
  isExpanded: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const owl = <HoondokMascot pose="welcome" size={40} fallback={<Smartphone size={20} />} />;

  if (isExpanded && variant !== "prompt") {
    return (
      <NoticeFrame
        lead={owl}
        title={INSTALL_HOWTO_TITLE}
        sub={variant === "ios" ? "Safari 메뉴를 열었다 닫아도 여기 그대로 있어요" : undefined}
        closeLabel="접기"
        onClose={collapseNotice}
      >
        {variant === "ios" ? (
          <ol className="notice-slot__steps">
            {IOS_INSTALL_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="notice-slot__text">{INSTALL_CARD_BODY.manual}</p>
        )}
      </NoticeFrame>
    );
  }

  return (
    <NoticeFrame
      tone={isAfterRead ? "done" : "plain"}
      lead={isAfterRead ? <Check size={18} /> : owl}
      title={isAfterRead ? INSTALL_AFTER_READ_TITLE : INSTALL_CARD_TITLE}
      sub={isAfterRead ? INSTALL_AFTER_READ_SUB : INSTALL_NOTICE_SUB[variant]}
      action={
        variant === "prompt" ? (
          <HoondokButton isSmall onClick={onInstall}>
            설치
          </HoondokButton>
        ) : (
          <HoondokButton isSmall onClick={() => expandNotice("install")}>
            {INSTALL_HOWTO_LABEL}
          </HoondokButton>
        )
      }
      closeLabel="나중에"
      onClose={onDismiss}
    />
  );
}
