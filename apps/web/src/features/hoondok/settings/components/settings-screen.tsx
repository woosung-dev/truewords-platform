"use client";

import { ChevronRight, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { inAppBrowser } from "@/features/hoondok/install/platform";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { ReadNotificationCard, SOON } from "@/features/hoondok/notifications/components/read-notification-card";
import { usePushNotifications } from "@/features/hoondok/notifications/use-push-notifications";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { useLogout } from "@/features/identity/use-logout";
import { AccountHero, GuestHero } from "./account-hero";
import { AccountSection } from "./account-section";
import { DeleteAccountCard } from "./delete-account-card";
import { DisplayNameCard } from "./display-name-card";
import { LoginMethodsCard } from "./login-methods-card";

// SCR-PWA-015 관리 — 헤더 사람 아이콘이 여는 계정·설정 화면. 위에서부터 주요 카드(기록 요약) · 알림 · 화면 · 계정 · 안내.
// 로그아웃은 나의 정원에서 이 화면 "계정" 묶음으로 옮겼다 — 정원은 기록을 보는 곳, 관리는 계정·기기를 다루는 곳이다.
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
  return <InstallCard />;
}

export function SettingsScreen({ todayWeekday }: { todayWeekday: number }) {
  const push = usePushNotifications();
  const { user, isLoading: isUserLoading } = useCurrentUser();
  // 로그아웃하면 계정 묶음이 사라지므로 상태는 화면이 든다 — 성공이면 맨 위 카드 제목이 "로그아웃했어요" 가 된다
  const logout = useLogout();
  const guestTitleRef = useRef<HTMLHeadingElement>(null);
  const hasLoggedOut = logout.isSuccess && !user;

  // 누른 버튼이 사라져 초점이 body 로 떨어진다 — 결과를 알리는 제목으로 옮긴다
  useEffect(() => {
    if (hasLoggedOut) guestTitleRef.current?.focus();
  }, [hasLoggedOut]);

  return (
    <section className="col ac-screen">
      {isUserLoading ? (
        <div className="ac-shell" aria-busy="true" aria-label="계정을 불러오는 중">
          <span className="ac-core skeleton ac-skel--hero" />
        </div>
      ) : user ? (
        <AccountHero user={user} todayWeekday={todayWeekday} />
      ) : (
        <GuestHero hasLoggedOut={hasLoggedOut} titleRef={guestTitleRef} />
      )}

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
            <div className="st-row">
              <span className="st-row__bd">
                <b className="st-row__t">조용한 시간</b>
                <span className="st-row__d">오후 10시부터 오전 5시까지 알리지 않아요</span>
              </span>
              <span className="st-row__soon">{SOON}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">화면</h2>
        </div>
        <InstallSection />
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">계정</h2>
        </div>
        <div className="st-stack">
          <DisplayNameCard />
          <LoginMethodsCard />
          {user && <AccountSection user={user} logout={logout} />}
          <DeleteAccountCard />
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">안내</h2>
        </div>
        <div className="st-group">
          <Link className="st-row st-row--link" href="/privacy">
            <span className="st-row__bd">
              <b className="st-row__t">개인정보 처리방침</b>
              <span className="st-row__d">어떤 정보를 저장하고 어떻게 지우는지 알려드려요</span>
            </span>
            <span className="st-go" aria-hidden="true">
              <ChevronRight size={20} />
            </span>
          </Link>
        </div>
      </div>

      <p className="notice">독립 운영 베타</p>
    </section>
  );
}
