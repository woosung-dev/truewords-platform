"use client";

import { createContext, useContext, useEffect } from "react";

/** 원문 조회 결과의 실제 제목만 앱 셸에 전달한다. 화면을 떠나면 기본 제목으로 복원한다. */
export const HoondokScreenTitleContext = createContext<(title: string | null) => void>(() => {});

export function useHoondokScreenTitle(title: string | null) {
  const update = useContext(HoondokScreenTitleContext);
  useEffect(() => {
    update(title);
    return () => update(null);
  }, [title, update]);
}
