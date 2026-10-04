"use client";

// 말씀 글자 크기를 훈독 루트에 거는 마운트 (hoondok layout 에만 둔다). 화면에는 아무것도 그리지 않는다.
// 서버 HTML 에서는 인라인 스크립트가 첫 페인트 전에 걸고, 클라이언트 이동·설정 변경은 아래 effect 가 맡는다.
// effect 는 React 상태 대신 저장소를 직접 읽는다 — hydration 첫 렌더의 기본값(보통)으로 잠깐 되돌렸다가
// 다시 키우는 깜빡임이 없게 하기 위해서다.
import { useLayoutEffect } from "react";
import { applyTextScale, findHoondokRoot, readTextScale, subscribeTextScale, TEXT_SCALE_SCRIPT } from "../text-scale";

export function HoondokTextScale() {
  useLayoutEffect(() => {
    const apply = () => {
      const root = findHoondokRoot();
      if (root) applyTextScale(root, readTextScale());
    };
    apply();
    return subscribeTextScale(apply);
  }, []);
  // innerHTML 로 넣은 스크립트는 서버 HTML 파싱 때만 실행되고, 클라이언트 렌더에서는 실행되지 않는다(경고도 없다)
  return <span hidden dangerouslySetInnerHTML={{ __html: `<script>${TEXT_SCALE_SCRIPT}</script>` }} />;
}
