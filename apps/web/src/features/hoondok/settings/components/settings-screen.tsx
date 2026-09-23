"use client";

import { Smartphone } from "lucide-react";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { LockScreenPicker } from "@/features/hoondok/notifications/components/lock-screen-picker";
import { ReadNotificationCard, SOON } from "@/features/hoondok/notifications/components/read-notification-card";
import { usePushNotifications } from "@/features/hoondok/notifications/use-push-notifications";
import { DeleteAccountCard } from "./delete-account-card";

// SCR-PWA-015 알림·설치 설정 (PLAN-HD-002 W1-S · PLAN-HD-006 알림).
// 라벨·설명·순서는 프로토타입 app.html data-screen="settings" 그대로다.
// 실제로 켜고 끄는 알림은 "훈독하기" 한 종류뿐이다 — 기도·가정예배·공지는 보낼 내용이 없어 disabled + "준비 중" 이다.

type NotificationRow = { id: string; title: string; description: string; time?: string };

const SOON_NOTIFICATIONS: readonly NotificationRow[] = [
  { id: "pray", title: "기도하기", description: "하루를 기도로 마무리해요", time: "오후 9:30" },
  { id: "worship", title: "가정예배", description: "순서지가 준비되면 알려드려요", time: "토요일 오후 6:00" },
  { id: "notice", title: "공지", description: "앱 소식" },
];

function InstallSection() {
  // 설정에서는 자격·숨김과 무관하게 안내가 보인다. hidden 은 곧 standalone 이므로 한 줄로 바꾼다.
  const { variant } = useInstallCard({ isAlwaysVisible: true });
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
  // 알림 카드와 잠금 화면 문구가 같은 서버 설정을 보므로 훅은 한 번만 부르고 내려준다.
  const push = usePushNotifications();

  return (
    <section className="col">
      <InstallSection />

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">알림</h2>
          <span className="sect__meta">4종</span>
        </div>
        <div className="st-stack">
          <ReadNotificationCard push={push} />
          {SOON_NOTIFICATIONS.map((item) => (
            <div className="card" key={item.id}>
              <div className="st-row">
                <span className="st-row__bd">
                  <b className="st-row__t">{item.title}</b>
                  <span className="st-row__d">{item.description}</span>
                </span>
                <span className="st-row__side">
                  <span className="st-row__soon">{SOON}</span>
                  <button
                    className="toggle"
                    type="button"
                    disabled
                    aria-disabled="true"
                    aria-pressed="false"
                    aria-label={`${item.title} 알림`}
                  />
                </span>
              </div>
              {/* 꺼진 행에는 caret 을 두지 않는다 — 있으면 탭하면 시간 선택으로 들어갈 행으로 읽힌다 (§3.3) */}
              {item.time && (
                <button className="st-sub" type="button" disabled aria-disabled="true">
                  <span className="st-sub__k">시간</span>
                  <span className="st-sub__v">{item.time}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">잠금 화면 문구</h2>
          <span className="sect__meta">기본 중립형</span>
        </div>
        <LockScreenPicker push={push} />
      </div>

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">그 밖의 설정</h2>
        </div>
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
