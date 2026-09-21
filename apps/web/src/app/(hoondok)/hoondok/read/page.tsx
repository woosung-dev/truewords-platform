// 서버는 공개 편성만 읽고 개인화는 클라이언트에서 인증 확인 후 같은 날의 공유 쿼리로 교체한다.
import { loadToday } from "@/features/hoondok/api";
import { EffectiveReading } from "@/features/hoondok/jeongseong/components/effective-reading";

export default async function HoondokReadPage() {
  const today = await loadToday();
  return (
    <section className="col col--read">
      <EffectiveReading today={today} />
      <p className="notice">독립 운영 베타 · 가정연합 공식 앱이 아닙니다</p>
    </section>
  );
}
