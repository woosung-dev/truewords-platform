// 카카오톡으로 건네기 (DEC-PWA-024 2단계). 카카오 JavaScript SDK 의 피드 템플릿으로 4:5 사진 카드 + 버튼 두 개를 보낸다.
// 키(NEXT_PUBLIC_KAKAO_JS_KEY)가 없는 빌드·SDK 를 못 불러온 기기에서는 버튼을 숨기고 기존 Web Share 갈래만 남긴다.
// 키는 공개 값이지만 카카오 앱의 "JavaScript SDK 도메인"·"웹 도메인"에 등록된 origin 에서만 동작한다(운영·localhost:3000).
import type { CardPublic } from "./api";
import type { CardLook } from "./look";
import { cardPath, cardWordsHref, photoCardImagePath } from "./share";

/** [확인 필요] 카카오 개발자 문서의 최신 SDK 버전·integrity 로 올린다. 주소가 틀리면 로드 실패 → 버튼이 숨는다 */
export const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";

/** 피드 이미지는 늘 4:5(1080×1350). 9:16 은 카톡 말풍선에서 잘리므로 스토리를 골라도 4:5 로 보낸다 */
const FEED_IMAGE = { width: 1080, height: 1350 } as const;

export function kakaoJsKey(): string {
  return process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim() ?? "";
}

export function isKakaoShareConfigured(): boolean {
  return kakaoJsKey().length > 0;
}

/** 설명 두 줄 분량(60자). 줄바꿈은 공백으로 */
function excerpt(text: string, limit = 60): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("");
}

type FeedCard = Pick<CardPublic, "id" | "text" | "work_title" | "source_label" | "volume" | "chunk_id">;

/** 피드 템플릿. 링크는 모두 같은 origin(카카오 앱 "웹 도메인"에 등록된 곳)이어야 카톡이 연다 */
export function kakaoFeedTemplate(card: FeedCard, look: CardLook, origin: string) {
  const cardUrl = `${origin}${cardPath(card.id)}`;
  const wordsUrl = `${origin}${cardWordsHref(card)}`;
  const homeUrl = `${origin}/`;
  return {
    objectType: "feed" as const,
    content: {
      title: `오늘의 책갈피 · ${card.work_title}`,
      description: excerpt(card.text),
      imageUrl: `${origin}${photoCardImagePath(card.id, { ...look, format: "feed" })}`,
      imageWidth: FEED_IMAGE.width,
      imageHeight: FEED_IMAGE.height,
      link: { webUrl: cardUrl, mobileWebUrl: cardUrl },
    },
    buttons: [
      { title: "원문에서 앞뒤 읽기", link: { webUrl: wordsUrl, mobileWebUrl: wordsUrl } },
      { title: "훈독에서 매일 한 장 받기", link: { webUrl: homeUrl, mobileWebUrl: homeUrl } },
    ],
  };
}

type KakaoTemplate = ReturnType<typeof kakaoFeedTemplate>;

/** SDK 전역에서 쓰는 부분만. 실제 값은 unknown 으로 받아 확인한다 */
type KakaoSdk = {
  init: (key: string) => void;
  isInitialized: () => boolean;
  Share: { sendDefault: (template: KakaoTemplate) => void };
};

function asKakaoSdk(value: unknown): KakaoSdk | null {
  if (typeof value !== "object" || value === null) return null;
  const sdk = value as Partial<KakaoSdk>;
  const share = sdk.Share as Partial<KakaoSdk["Share"]> | undefined;
  return typeof sdk.init === "function" &&
    typeof sdk.isInitialized === "function" &&
    typeof share?.sendDefault === "function"
    ? (sdk as KakaoSdk)
    : null;
}

function currentSdk(): KakaoSdk | null {
  return typeof window === "undefined" ? null : asKakaoSdk((window as { Kakao?: unknown }).Kakao);
}

let loading: Promise<KakaoSdk | null> | null = null;

/**
 * SDK 를 한 번만 불러와 초기화한다. 키가 없거나 불러오기·초기화에 실패하면 null(다음 호출에서 다시 시도).
 * 보내기 버튼을 누른 뒤에 불러오면 모바일에서 사용자 동작이 끊겨 카톡이 안 열릴 수 있어 시트를 열 때 미리 부른다.
 */
export function loadKakaoSdk(): Promise<KakaoSdk | null> {
  const key = kakaoJsKey();
  if (!key || typeof document === "undefined") return Promise.resolve(null);
  const ready = currentSdk();
  if (ready) return Promise.resolve(initialized(ready, key));
  loading ??= new Promise<KakaoSdk | null>((resolve) => {
    const script = document.createElement("script");
    script.src = KAKAO_SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      const sdk = currentSdk();
      resolve(sdk ? initialized(sdk, key) : null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  }).then((sdk) => {
    if (!sdk) loading = null;
    return sdk;
  });
  return loading;
}

function initialized(sdk: KakaoSdk, key: string): KakaoSdk | null {
  try {
    if (!sdk.isInitialized()) sdk.init(key);
    return sdk;
  } catch {
    return null;
  }
}

/** 테스트용: 불러오기 상태를 비운다 */
export function resetKakaoSdkForTest(): void {
  loading = null;
}

/** 카카오톡 공유 창을 연다. 보냈는지는 SDK 가 알려 주지 않으므로 연 것까지만 성공으로 본다 */
export function sendKakaoFeed(sdk: KakaoSdk, card: FeedCard, look: CardLook, origin: string): boolean {
  try {
    sdk.Share.sendDefault(kakaoFeedTemplate(card, look, origin));
    return true;
  } catch {
    return false;
  }
}
