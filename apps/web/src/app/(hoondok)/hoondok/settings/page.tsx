// /hoondok/settings — 알림·설치 자리표시 (PLAN-HD-002 W0-W). 실제 화면은 W?-? 가 이 파일을 교체한다.
// 플래그 게이트는 layout, 앱바(제목 "알림·설치"·뒤로 /hoondok/garden)는 screens.ts 가 담당하는 서버 컴포넌트다.
import { Bell } from "lucide-react";

export default function HoondokSettingsPage() {
  return (
    <section className="col">
      <div className="card">
        <div className="empty" role="status">
          <span className="empty__ic" aria-hidden="true">
            <Bell size={28} />
          </span>
          <h2 className="empty__title">알림·설치 설정을 준비하고 있어요</h2>
          <p className="empty__body">아침 알림 시간과 홈 화면 설치를 여기서 다뤄요.</p>
        </div>
      </div>
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
