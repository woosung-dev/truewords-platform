"use client";

import { Smartphone } from "lucide-react";
import { HoondokButton, HoondokMascot } from "@/components/hoondok";
import { type InstallVariant, useInstallCard } from "../use-install-card";

// 설치 문구는 이 파일 한 곳에서만 고친다 — 설정 카드·하단 안내 자리·알림 제안(iOS 미설치)이 같이 쓴다.
export const INSTALL_CARD_TITLE = "홈 화면에 추가하면 앱처럼 바로 열려요";
// 훈독 완료 직후 — 방금 마친 사람에게 "내일" 을 약속하는 자리라 문장도 내일을 말한다.
export const INSTALL_AFTER_READ_TITLE = "오늘 훈독을 마쳤어요";
export const INSTALL_AFTER_READ_SUB = "홈 화면에 두면 내일 아침 바로 이어 읽어요";
export const INSTALL_HOWTO_LABEL = "방법 보기";
export const INSTALL_HOWTO_TITLE = "홈 화면에 추가하는 방법";

export const INSTALL_CARD_BODY: Record<Exclude<InstallVariant, "hidden">, string> = {
  // iOS 26+ Safari 기본 배치는 공유 버튼이 숨어 있다 — 주소창 메뉴(≡/⋯)에서 공유 → 더 보기로 들어간다.
  ios: "주소창의 메뉴(≡ 또는 ⋯)나 공유 버튼을 누르고, 공유 → 더 보기에서 '홈 화면에 추가'를 고르세요.",
  prompt: "앱처럼 설치해 두면 주소창 없이 바로 훈독할 수 있어요.",
  manual: "Chrome 이나 Safari 에서 이 주소를 열고, 브라우저 메뉴의 '홈 화면에 추가'(또는 '앱 설치')를 고르세요.",
};

// iPhone 은 버튼 하나로 설치할 수 없다. 웹은 Safari 버튼을 가리킬 수 없고 메뉴 아이콘도 탭 배치마다 달라서
// (iOS 27 기본 배치는 주소창 왼쪽 ≡) 화살표 없이 단계만 하단 안내 자리에 펼쳐 둔다.
export const IOS_INSTALL_STEPS = ["주소창의 메뉴(≡ 또는 ⋯)나 공유 버튼 누르기", "공유 → 아래쪽 '더 보기'", "'홈 화면에 추가' 누르기"];

/**
 * 설정 화면(SCR-PWA-015)의 설치 안내. 사용자가 스스로 찾아온 자리라 자격·"나중에" 숨김·설치 기록과 무관하게 보인다.
 * standalone 이면 null — 호출자가 "이미 홈 화면에서 열었어요" 한 줄로 바꾼다. 다른 화면의 권유는 하단 안내 자리가 맡는다.
 */
export function InstallCard() {
  const { variant, promptInstall } = useInstallCard({ isAlwaysVisible: true });
  if (variant === "hidden") return null;

  return (
    <section className="card install" aria-labelledby="hoondok-install-title">
      <div className="install__hd">
        <span className="install__ic" aria-hidden="true">
          {/* 부엉이(인사 포즈)는 장식이다 — 플래그가 꺼져 있으면 기존 폰 아이콘 */}
          <HoondokMascot pose="welcome" size={48} fallback={<Smartphone size={24} />} />
        </span>
        <div className="install__bd">
          <h2 className="install__title" id="hoondok-install-title">
            {INSTALL_CARD_TITLE}
          </h2>
          <p className="install__body">{INSTALL_CARD_BODY[variant]}</p>
        </div>
      </div>
      {variant === "prompt" && (
        <div className="install__actions">
          <HoondokButton isSmall onClick={() => void promptInstall()}>
            지금 추가
          </HoondokButton>
        </div>
      )}
    </section>
  );
}
