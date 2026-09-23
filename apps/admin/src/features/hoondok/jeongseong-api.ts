import type { OfficialJeongseongInput, OfficialJeongseongOut } from "@truewords/api-client-ts/types";
import { fetchAPI } from "@/lib/api";

const BASE = "/admin/hoondok/jeongseongs";

// 공식 정성 admin API (API-HD-042). 상태 변경의 CSRF 헤더는 fetchAPI 가 붙인다. 401 은 fetchAPI 가 /login 으로 보낸다.
export const jeongseongAPI = {
  /** 시작일 내림차순. 진행 상태는 화면이 started_on·duration_days 로 계산한다. */
  list: () => fetchAPI<OfficialJeongseongOut[]>(BASE),
  create: (data: OfficialJeongseongInput) =>
    fetchAPI<OfficialJeongseongOut>(BASE, { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: OfficialJeongseongInput) =>
    fetchAPI<OfficialJeongseongOut>(`${BASE}/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  remove: (id: string) => fetchAPI<void>(`${BASE}/${id}`, { method: "DELETE" }),
};
