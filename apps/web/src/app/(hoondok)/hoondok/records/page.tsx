// /hoondok/records — 나의 기록 (C1). 나의 정원 탭 소속. `?tab=&color=&volume=` 은 화면이 useSearchParams 로 읽는다.
import { Suspense } from "react";
import { RecordsScreen } from "@/features/hoondok/records/components/records-screen";

export default function HoondokRecordsPage() {
  return (
    <Suspense fallback={<section className="col" />}>
      <RecordsScreen />
    </Suspense>
  );
}
