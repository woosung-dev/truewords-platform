"use client";

import { BellRing, ChevronRight, Sprout } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { HoondokMascot, type MascotPose } from "@/components/hoondok";
import { handleSegmentKeyDown } from "@/features/hoondok/segmented-keyboard";
import { onboardingHref } from "@/features/identity/gate";
import { useCurrentUser } from "@/features/identity/use-current-user";
import { formatKoreanTime } from "../format";
import { SUPPORT_HINTS } from "./read-notification-card";
import { usePushNotifications } from "../use-push-notifications";

// 알림센터 = 알림 / 공지 / 함께해요 세 탭. 보낸 알림 기록·공지·행사는 아직 서버에 없다 —
// 가짜 목록이나 안 읽음 숫자를 만들지 않고, 빈 상태에서 할 수 있는 일(알림 켜기·설정)만 보인다.

const TABS = [
  { id: "alerts", label: "알림" },
  { id: "notices", label: "공지" },
  { id: "together", label: "함께해요" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function NotificationCenter() {
  const [tab, setTab] = useState<TabId>("alerts");

  return (
    <section className="col nc-screen">
      <div className="pill-seg nc-tabs" role="tablist" onKeyDown={handleSegmentKeyDown} aria-label="알림 종류">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`nc-tab-${item.id}`}
            aria-selected={tab === item.id}
            tabIndex={tab === item.id ? 0 : -1}
            aria-controls="nc-panel"
            className={tab === item.id ? "is-on" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id="nc-panel" className="nc-panel" role="tabpanel" aria-labelledby={`nc-tab-${tab}`}>
        {tab === "alerts" ? (
          <AlertsPanel />
        ) : tab === "notices" ? (
          <EmptyCard pose="reading" title="아직 공지가 없어요" body="업데이트·점검 소식이 생기면 여기에 모아 둘게요." />
        ) : (
          <EmptyCard pose="heart" title="아직 열린 행사가 없어요" body="함께 훈독하는 행사가 열리면 여기에서 알려드릴게요." />
        )}
        <Link className="nc-settings" href="/settings">
          알림 설정
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function EmptyCard({
  pose,
  title,
  body,
  children,
}: {
  pose: MascotPose;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="ac-shell">
      <div className="ac-core nc-empty">
        <HoondokMascot
          pose={pose}
          size={96}
          fallback={
            <span className="empty__ic" aria-hidden="true">
              <Sprout size={28} />
            </span>
          }
        />
        <h2 className="nc-empty__title">{title}</h2>
        <p className="nc-empty__body">{body}</p>
        {children}
      </div>
    </div>
  );
}

function AlertsPanel() {
  const { user, isLoading } = useCurrentUser();
  if (isLoading) return <span className="skeleton ac-skel--hero" aria-busy="true" aria-label="불러오는 중" />;
  if (!user) {
    return (
      <EmptyCard pose="welcome" title="로그인하면 훈독하기 알림을 받을 수 있어요" body="정한 시간에 하루 한 번 알려드려요.">
        <Link className="btn btn-primary ac-chunky" href={onboardingHref("/notifications")}>
          시작하기
        </Link>
      </EmptyCard>
    );
  }
  return <SignedInAlerts />;
}

// 로그인한 뒤에만 그린다 — 알림 수신 설정 조회가 로그인 전 방문에서 나가지 않게 한다
function SignedInAlerts() {
  const push = usePushNotifications();

  // 설정 판정 전, 또는 켤 수 있는데 서버 수신 설정을 아직 못 읽었으면 "꺼짐" 이라 단정하지 않는다
  if (push.support === null || (push.support === "ready" && !push.isPrefsReady)) {
    return <span className="skeleton ac-skel--hero" aria-busy="true" aria-label="불러오는 중" />;
  }

  if (push.prefs.read_enabled) {
    return (
      <div className="ac-shell">
        <div className="ac-core nc-status">
          <span className="nc-status__ic" aria-hidden="true">
            <BellRing size={22} />
          </span>
          <div className="nc-status__text">
            <h2 className="nc-status__title">매일 {formatKoreanTime(push.prefs.read_time)}에 훈독하기를 알려드려요</h2>
            <p className="nc-status__body">지난 알림 목록은 준비 중이에요.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <EmptyCard pose="rest" title="받은 알림이 없어요" body="훈독하기 알림을 켜면 정한 시간에 하루 한 번 알려드려요.">
      {push.support === "ready" ? (
        <>
          <button
            type="button"
            className="btn btn-primary ac-chunky"
            disabled={push.isSaving}
            // 권한 요청은 이 클릭 안에서 바로 시작된다(iOS 제스처 요건) — enable 앞에 await 를 두지 않는다
            onClick={() => push.enable()}
          >
            훈독하기 알림 켜기
          </button>
          {push.message && (
            <p className="nc-empty__body" role="status">
              {push.message}
            </p>
          )}
        </>
      ) : (
        <p className="nc-empty__body">
          {push.support === "disabled" ? "알림 준비가 아직 끝나지 않았어요." : SUPPORT_HINTS[push.support]}
        </p>
      )}
    </EmptyCard>
  );
}
