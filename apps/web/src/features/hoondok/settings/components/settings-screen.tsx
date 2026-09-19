"use client";

import { ChevronRight, Smartphone } from "lucide-react";
import { InstallCard } from "@/features/hoondok/install/components/install-card";
import { useInstallCard } from "@/features/hoondok/install/use-install-card";
import { DeleteAccountCard } from "./delete-account-card";

// SCR-PWA-015 알림·설치 설정 (PLAN-HD-002 W1-S). 라벨·설명·순서는 프로토타입 app.html data-screen="settings" 그대로다.
// 알림 발송·구독은 PLAN-HD-001 Phase 4 라 이 화면의 컨트롤은 전부 disabled + "준비 중" 이고,
// 실제로 동작하는 것은 설치 안내와 내 데이터 삭제 둘뿐이다.
const SOON = "준비 중";

type NotificationRow = { id: string; title: string; description: string; time?: string };

const NOTIFICATIONS: readonly NotificationRow[] = [
  { id: "read", title: "훈독하기", description: "아침 훈독을 알려드려요", time: "오전 6:00" },
  { id: "pray", title: "기도하기", description: "하루를 기도로 마무리해요", time: "오후 9:30" },
  { id: "worship", title: "가정예배", description: "순서지가 준비되면 알려드려요", time: "토요일 오후 6:00" },
  { id: "notice", title: "공지", description: "우리 교회와 앱 소식" },
];

type LockScreenLevel = { id: string; title: string; note: string; isDefault: boolean };

const LOCK_SCREEN_LEVELS: readonly LockScreenLevel[] = [
  { id: "neutral", title: "오늘의 읽을거리가 준비됐어요", note: "중립형 · 기본", isDefault: true },
  { id: "faith", title: "오늘의 말씀이 준비됐어요", note: "신앙 맥락이 드러나요 · 내가 선택", isDefault: false },
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
  return (
    <section className="col">
      <InstallSection />

      <div className="sect">
        <div className="sect__head">
          <h2 className="sect__title">알림</h2>
          <span className="sect__meta">4종</span>
        </div>
        <div className="st-stack">
          {NOTIFICATIONS.map((item) => (
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
              {item.time && (
                <button className="st-sub" type="button" disabled aria-disabled="true">
                  <span className="st-sub__k">시간</span>
                  <span className="st-sub__v">
                    {item.time}
                    <ChevronRight size={20} aria-hidden="true" />
                  </span>
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
        <div className="card">
          <p className="st-lead">잠금 화면에 보일 문구예요. 기본은 내용이 드러나지 않습니다.</p>
          <div className="st-picks" role="radiogroup" aria-label="잠금 화면 문구 수준">
            {LOCK_SCREEN_LEVELS.map((level) => (
              <button
                className="st-pick"
                key={level.id}
                type="button"
                role="radio"
                aria-checked={level.isDefault}
                disabled
                aria-disabled="true"
              >
                <span className="st-radio" aria-hidden="true" />
                <span className="st-pick__bd">
                  <b>{level.title}</b>
                  <span>{level.note}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="st-row__soon">{SOON}</p>
        </div>
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
