"use client";

import { Smartphone } from "lucide-react";
import { HoondokButton } from "@/components/hoondok";
import { type InstallVariant, useInstallCard } from "../use-install-card";

// SCR-PWA-015 의 설치 안내 부분 (PLAN-HD-001 Phase 3 E). 알림 문구는 Phase 4 라 쓰지 않는다.
export const INSTALL_CARD_TITLE = "홈 화면에 추가하면 아침마다 바로 열려요";

const BODY: Record<Exclude<InstallVariant, "hidden">, string> = {
  ios: "공유 버튼(네모에서 화살표가 나오는 모양)을 누른 뒤 '홈 화면에 추가'를 고르세요.",
  prompt: "앱처럼 설치해 두면 주소창 없이 바로 훈독할 수 있어요.",
  manual: "Chrome 이나 Safari 에서 이 주소를 열고, 브라우저 메뉴의 '홈 화면에 추가'(또는 '앱 설치')를 고르세요.",
};

export function InstallCard() {
  const { variant, promptInstall, dismiss } = useInstallCard();
  if (variant === "hidden") return null;

  return (
    <section className="card install" aria-labelledby="hoondok-install-title">
      <div className="install__hd">
        <span className="install__ic" aria-hidden="true">
          <Smartphone size={24} />
        </span>
        <div className="install__bd">
          <h2 className="install__title" id="hoondok-install-title">
            {INSTALL_CARD_TITLE}
          </h2>
          <p className="install__body">{BODY[variant]}</p>
        </div>
      </div>
      <div className="install__actions">
        {variant === "prompt" && (
          <HoondokButton isSmall onClick={() => void promptInstall()}>
            지금 추가
          </HoondokButton>
        )}
        <HoondokButton variant="line" isSmall onClick={dismiss}>
          나중에
        </HoondokButton>
      </div>
    </section>
  );
}
