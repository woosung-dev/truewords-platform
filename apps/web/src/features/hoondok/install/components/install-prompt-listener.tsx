"use client";

import { useEffect } from "react";
import { listenForInstallPrompt } from "../prompt-store";

// hoondok layout 에만 마운트한다. 카드는 홈에만 있지만 beforeinstallprompt 는 /hoondok/read 에서도 발사되므로
// layout 에서 잡아 모듈 스토어에 두고, 클라이언트 라우팅으로 홈에 오면 카드가 꺼내 쓴다.
export function HoondokInstallPromptListener() {
  useEffect(() => {
    return listenForInstallPrompt();
  }, []);
  return null;
}
