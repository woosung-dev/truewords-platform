"use client";

import { Smartphone } from "lucide-react";
import { useSyncExternalStore } from "react";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { inAppBrowser } from "@/features/hoondok/install/platform";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { ReadNotificationCard, SOON } from "@/features/hoondok/notifications/components/read-notification-card";
import { usePushNotifications } from "@/features/hoondok/notifications/use-push-notifications";
import { DeleteAccountCard } from "./delete-account-card";
import { TextScaleSetting } from "./text-scale-setting";

// SCR-PWA-015 알림·설치 설정 (PLAN-HD-002 W1-S · PLAN-HD-006 알림).
// 실제로 켜고 끄는 알림은 "훈독하기" 한 종류뿐이다 — 기도·가정예배·공지는 보낼 내용이 없어 "준비 중" 한 줄로 접는다.
// 조용한 시간도 "준비 중" 이고 알림함은 없다 — 누를 수 있는 줄(›)로 그리지 않는다.

const subscribeNever = () => () => {};
const isInAppSnapshot = () => inAppBrowser() !== null;

function InstallSection() {
  // 설정에서는 자격·숨김과 무관하게 안내가 보인다. hidden 은 곧 standalone 이므로 한 줄로 바꾼다.
  const { variant } = useInstallCard({ isAlwaysVisible: true });
  // 인앱 브라우저(카카오톡 등)는 홈 화면 추가가 안 된다 — iOS 공유 버튼 안내를 그대로 두면 상단 배너
  // ("앱 설치·알림이 안 돼요")와 모순된다. 서버·hydration 첫 렌더는 false(일반 안내)이고 클라이언트에서 UA 를 읽는다.
  const isInAppBrowser = useSyncExternalStore(subscribeNever, isInAppSnapshot, () => false);
  if (isInAppBrowser) {
    return (
      <p className="card st-installed" role="status">
        <span className="st-installed__ic" aria-hidden="true">
          <Smartphone size={20} />
        </span>
        <span>기본 브라우저에서 열면 홈 화면에 추가할 수 있어요</span>
      </p>
    );
  }
  if (variant === "hidden") {
    return (
      <p className="card st-installed" role="status">
        <span className="st-installed__ic" aria-hidden="true">
          <Smartphone size={20} />
        </span>
        <span>이미 홈 화면에서 열었어요</span>
      </p>
    );
  }
  return <InstallCard isAlwaysVisible />;
}

export function SettingsScreen() {
  const push = usePushNotifications();

  return (
    <section className="col">
      <InstallSection />

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">알림</h2>
        </div>
        <div className="st-stack">
          <ReadNotificationCard push={push} />
          {/* 누를 수 없는 줄이라 caret 을 두지 않는다 (§3.3) */}
          <div className="st-group">
            <div className="st-row">
              <span className="st-row__bd">
                <b className="st-row__t">그 밖의 알림</b>
                <span className="st-row__d">기도하기 · 가정예배 · 공지</span>
              </span>
              <span className="st-row__soon">{SOON}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">그 밖의 설정</h2>
        </div>
        <TextScaleSetting />
        <div className="st-group">
          <div className="st-row">
            <span className="st-row__bd">
              <b className="st-row__t">조용한 시간</b>
              <span className="st-row__d">오후 10시부터 오전 5시까지 알리지 않아요</span>
            </span>
            <span className="st-row__soon">{SOON}</span>
          </div>
        </div>
        <DeleteAccountCard />
      </div>

      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
