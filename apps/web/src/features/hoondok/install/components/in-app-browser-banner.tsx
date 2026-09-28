"use client";

import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { HoondokButton } from "@/components/hoondok";
import { inAppBrowser, isIos, kakaoOpenExternalUrl } from "../platform";

// 인앱 브라우저 안내 (hoondok layout 에만 마운트). 카카오톡으로 받은 링크를 누르면 카카오톡 웹뷰에서 열리는데,
// 웹뷰에서는 홈 화면 추가·웹 푸시가 되지 않는다. 카카오톡은 외부 브라우저로 여는 스킴이 있어 세션당 한 번 자동으로 넘기고,
// 넘어가지 않았거나 되돌아온 사람에게는 배너가 남는다. 다른 인앱은 스킴이 없어 메뉴 안내와 링크 복사만 둔다.
export const INAPP_REDIRECT_KEY = "hoondok:inapp-redirected";
export const KAKAO_BANNER_TITLE = "카카오톡 안에서는 앱 설치·알림이 안 돼요";
export const OTHER_BANNER_TITLE = "이 앱 안에서는 앱 설치·알림이 안 돼요";

const subscribeNever = () => () => {};
const getKind = () => inAppBrowser();
// SSR·hydration 첫 렌더는 null — 클라이언트에서만 UA 를 읽어 불일치 없이 다시 그린다.
const getServerKind = () => null;

function assignLocation(url: string): void {
  window.location.href = url;
}

/** 세션당 한 번만 자동 전환한다. 저장소가 막혀 있으면 가드를 둘 수 없으니 자동 전환도 하지 않는다(매 로드 전환 방지). */
function claimAutoRedirect(): boolean {
  try {
    if (window.sessionStorage.getItem(INAPP_REDIRECT_KEY)) return false;
    window.sessionStorage.setItem(INAPP_REDIRECT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

/** navigate 는 테스트가 이동을 가로채는 자리다 — 기본은 location.href 대입. */
export function HoondokInAppBrowserBanner({ navigate = assignLocation }: { navigate?: (url: string) => void }) {
  const kind = useSyncExternalStore(subscribeNever, getKind, getServerKind);
  const [isClosed, setIsClosed] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "kakaotalk" || !claimAutoRedirect()) return;
    navigate(kakaoOpenExternalUrl(window.location.href));
  }, [kind, navigate]);

  if (!kind || isClosed) return null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyNote("링크를 복사했어요. 브라우저 주소창에 붙여 넣어 주세요");
    } catch {
      setCopyNote("복사하지 못했어요. 메뉴의 '다른 브라우저로 열기'를 눌러 주세요");
    }
  }

  const isKakao = kind === "kakaotalk";
  return (
    <aside className="inapp" aria-label="브라우저 안내">
      <div className="inapp__bd">
        <p className="inapp__title">{isKakao ? KAKAO_BANNER_TITLE : OTHER_BANNER_TITLE}</p>
        {!isKakao && <p className="inapp__body">우측 상단 메뉴에서 &apos;다른 브라우저로 열기&apos;를 눌러 주세요</p>}
        <div className="inapp__actions">
          {isKakao ? (
            <HoondokButton isSmall onClick={() => navigate(kakaoOpenExternalUrl(window.location.href))}>
              {isIos() ? "Safari 로 열기" : "Chrome 으로 열기"}
            </HoondokButton>
          ) : (
            <HoondokButton variant="line" isSmall onClick={() => void copyLink()}>
              링크 복사
            </HoondokButton>
          )}
          {copyNote && (
            <span className="inapp__note" role="status">
              {copyNote}
            </span>
          )}
        </div>
      </div>
      <button className="inapp__close" type="button" aria-label="안내 닫기" onClick={() => setIsClosed(true)}>
        <X size={20} />
      </button>
    </aside>
  );
}
