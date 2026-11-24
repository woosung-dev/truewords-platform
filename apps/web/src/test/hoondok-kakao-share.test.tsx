import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardPublic } from "@/features/hoondok/cards/api";

// 카카오톡으로 건네기 (DEC-PWA-024 2단계) — 키 없는 빌드에서는 버튼이 없고, 키·SDK 가 있으면 4:5 피드로 보낸다.
const CARD: CardPublic = {
  id: "11111111-1111-4111-8111-111111111111",
  text: "우리가 원수를 대하여 분하고 절통한 마음이 우러날 때마다 하나님은 용서의 눈물을 흘리신다는 것을 알아야 합니다.",
  volume: "천성경 제1편",
  chunk_id: "chunk-42",
  chunk_index: 41,
  work_title: "천성경",
  source_label: "천성경 제1편 하나님 p.42",
  topic: "용서",
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stubSdk() {
  let isReady = false;
  const sdk = {
    init: vi.fn(() => {
      isReady = true;
    }),
    isInitialized: () => isReady,
    Share: { sendDefault: vi.fn() },
  };
  vi.stubGlobal("Kakao", sdk);
  return sdk;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ detail: "unauthorized" }), { status: 401 })),
  );
});

afterEach(() => {
  window.localStorage.clear();
  document.head.querySelectorAll("script[src*='kakao']").forEach((node) => node.remove());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("카카오 피드 템플릿", () => {
  it("스토리를 골라도 4:5 이미지로 보내고, 링크는 모두 같은 origin 이다", async () => {
    const { kakaoFeedTemplate } = await import("@/features/hoondok/cards/kakao");
    const template = kakaoFeedTemplate(CARD, { format: "story", bg: "orchard", src: "book" }, "https://truewords.woosung.dev");
    expect(template.content.imageUrl).toBe(
      `https://truewords.woosung.dev/c/${CARD.id}/image?f=feed&bg=orchard&src=book`,
    );
    expect([template.content.imageWidth, template.content.imageHeight]).toEqual([1080, 1350]);
    expect(template.content.title).toBe("오늘의 책갈피 · 천성경");
    expect(Array.from(template.content.description)).toHaveLength(61); // 60자 + …
    expect(template.content.link.mobileWebUrl).toBe(`https://truewords.woosung.dev/c/${CARD.id}`);
    expect(template.buttons.map((button) => button.title)).toEqual(["원문에서 앞뒤 읽기", "훈독에서 매일 한 장 받기"]);
    expect(template.buttons[0].link.webUrl).toMatch(/^https:\/\/truewords\.woosung\.dev\/.+card=11111111/);
  });
});

describe("건네기 시트의 카카오 버튼", () => {
  it("키가 없는 빌드에서는 카카오 버튼도 SDK 스크립트도 없고 기존 버튼 문구 그대로다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "");
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={() => {}} />));
    expect(screen.queryByRole("button", { name: "카카오톡으로 보내기" })).toBeNull();
    expect(document.head.querySelector("script[src*='kakao']")).toBeNull();
    expect(screen.getByRole("button", { name: /사진 준비 중|카카오톡·다른 앱으로 건네기/ })).toBeInTheDocument();
  });

  it("SDK 를 못 불러오면 버튼을 숨긴 채 기존 공유만 남는다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "testkey");
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={() => {}} />));
    const script = await waitFor(() => {
      const node = document.head.querySelector<HTMLScriptElement>("script[src*='kakao']");
      expect(node).not.toBeNull();
      return node as HTMLScriptElement;
    });
    fireEvent.error(script);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("button", { name: "카카오톡으로 보내기" })).toBeNull();
  });

  it("키와 SDK 가 있으면 초기화 후 고른 모양으로 보내고, 기존 버튼은 '다른 앱으로' 가 된다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JS_KEY", "testkey");
    const sdk = stubSdk();
    const { ShareSheet } = await import("@/features/hoondok/cards/components/share-sheet");
    const { readCardLook } = await import("@/features/hoondok/cards/storage");
    const onDone = vi.fn();
    render(wrap(<ShareSheet card={CARD} onClose={() => {}} onDone={onDone} />));
    const button = await screen.findByRole("button", { name: "카카오톡으로 보내기" });
    expect(sdk.init).toHaveBeenCalledWith("testkey");
    fireEvent.click(screen.getByRole("radio", { name: "호수" }));
    fireEvent.click(button);
    expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
    const [template] = sdk.Share.sendDefault.mock.calls[0] as unknown as [{ content: { imageUrl: string } }];
    expect(template.content.imageUrl).toBe(`${window.location.origin}/c/${CARD.id}/image?f=feed&bg=lake&src=full`);
    expect(onDone).toHaveBeenCalledWith("kakao");
    expect(readCardLook(CARD.id)).toEqual({ format: "feed", bg: "lake", src: "full" });
  });

  it("카카오 공유는 건넴으로 센다", async () => {
    const { isGivenOutcome, shareToastMessage } = await import("@/features/hoondok/cards/components/share-sheet");
    expect(isGivenOutcome("kakao")).toBe(true);
    expect(shareToastMessage("kakao", true)).toBe("책갈피를 건넸어요 · 나의 책갈피에 남았어요");
  });
});
