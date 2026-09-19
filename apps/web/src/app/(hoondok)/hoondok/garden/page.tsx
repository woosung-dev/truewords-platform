// /hoondok/garden — 나의 정원 자리표시 (PLAN-HD-002 W0-W). 실제 화면은 W?-? 가 이 파일을 교체한다.
// 플래그 게이트는 layout, 앱바(제목 "나의 정원"·탭 garden)는 screens.ts 가 담당하는 서버 컴포넌트다.
import { Sprout } from "lucide-react";

export default function HoondokGardenPage() {
  return (
    <section className="col">
      <div className="card">
        <div className="empty" role="status">
          <span className="empty__ic" aria-hidden="true">
            <Sprout size={28} />
          </span>
          <h2 className="empty__title">나의 정원을 준비하고 있어요</h2>
          <p className="empty__body">연속일·기록·정성 기간이 여기에 모여요.</p>
        </div>
      </div>
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
