// /hoondok/offline — 서비스워커 오프라인 폴백 안내 1장 (PLAN-HD-001 Phase 3 D). 데이터 요청이 없는 정적 안내다.
// sw.js 가 install 시 이 페이지의 HTML 과 참조 청크를 precache 하고, /hoondok 아래 navigation 이 실패하면 이 URL 로 302 보낸 뒤
// 여기서만 캐시 HTML 을 돌려준다(다른 URL 에서 내면 usePathname 기반 앱 셸이 hydration 불일치를 낸다).
import { WifiOff } from "lucide-react";
import Link from "next/link";

export default function HoondokOfflinePage() {
  return (
    <section className="col">
      <div className="card">
        <div className="empty">
          <span className="empty__ic" aria-hidden="true">
            <WifiOff size={28} />
          </span>
          <h2 className="empty__title">지금은 오프라인이에요</h2>
          <p className="empty__body">
            연결이 돌아오면 오늘 말씀을 다시 불러올게요.
            <br />
            완료 기록은 서버에 있어 사라지지 않아요.
          </p>
          <p className="onb-cta">
            <Link className="btn btn-primary" href="/hoondok">
              다시 시도
            </Link>
          </p>
        </div>
      </div>
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
