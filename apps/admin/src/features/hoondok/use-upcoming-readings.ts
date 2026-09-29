import { useQuery } from "@tanstack/react-query";
import { hoondokAPI } from "./api";
import { addDays, kstTodayIso, LIST_DAYS } from "./dates";

/**
 * 오늘(KST)~+14일 편성 목록. 편성 화면과 사이드바 재고 배지가 같은 쿼리 키를 써서 캐시를 나눈다 —
 * 요청은 늘지 않는다. 등록·수정은 ["hoondok"] 을 무효화하므로 배지도 함께 새로 읽는다.
 */
export function useUpcomingReadings() {
  const from = kstTodayIso();
  const to = addDays(from, LIST_DAYS);
  const query = useQuery({
    queryKey: ["hoondok", "daily-readings", from, to],
    queryFn: () => hoondokAPI.list(from, to),
  });
  return { from, ...query };
}
