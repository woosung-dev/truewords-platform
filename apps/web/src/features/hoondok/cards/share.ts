// 책갈피 건네기 (PLAN-HD-012 결정 4, SCR-PWA-024). 1단계는 Web Share + 2:1 OG 링크 카드이고 카카오 SDK 는 쓰지 않는다.
// 폴백 순서는 모임 초대(together/invite-code.ts shareInvite)와 같다: 파일 공유 → 링크 공유 → 클립보드 → 직접 표시.
import { wordsHref } from "../library/api";
import type { CardPublic } from "./api";

export type CardImageFormat = "link" | "square" | "story";

/** 원문 연결 주소: 인용 단락을 열고 card 로 문장 밑줄·리본을 그린다. */
export function cardWordsHref(card: Pick<CardPublic, "id" | "volume" | "chunk_id">): string {
  return `${wordsHref(card.volume, card.chunk_id)}&card=${encodeURIComponent(card.id)}`;
}

/** 받은 사람 화면 경로. 카톡 링크 카드는 이 주소의 OG(2:1)로 그려진다. */
export function cardPath(id: string): string {
  return `/hoondok/c/${encodeURIComponent(id)}`;
}

export function cardImagePath(id: string, format: CardImageFormat): string {
  return `${cardPath(id)}/image?f=${format}`;
}

/** 브라우저면 현재 origin 을 붙인 절대 URL, 서버 렌더면 상대 경로. */
export function cardLink(id: string): string {
  const path = cardPath(id);
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

/** 글로 복사: 본문 · 출처 · 훈독 · 링크. 인사는 사용자가 대화방에서 직접 쓴다(결정 1). */
export function cardCopyText(card: Pick<CardPublic, "text" | "source_label">, link: string): string {
  return `“${card.text}”\n— ${card.source_label} · 훈독\n${link}`;
}

export type CardShareResult = "file" | "link" | "clipboard" | "cancelled" | "none";

type ShareNavigator = Pick<Navigator, "share" | "canShare" | "clipboard">;

function currentNavigator(): Partial<ShareNavigator> | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * 1) 이미지 파일을 받을 수 있으면 파일 + 링크 → "file"
 * 2) 파일은 안 되지만 공유 시트가 있으면 링크만 → "link"
 * 3) 공유 시트가 없으면 본문·출처·링크를 클립보드로 → "clipboard"
 * 4) 둘 다 안 되면 "none" — 화면이 링크를 직접 보여 준다
 * 사용자가 공유 시트를 닫으면(AbortError) "cancelled" — 뜻밖에 클립보드로 복사하지 않는다.
 * 파일은 미리 받아 둔 것을 넘긴다. iOS 는 클릭 뒤 비동기 대기가 길면 공유 시트를 막는다.
 */
export async function shareCard({
  card,
  link,
  file,
  nav = currentNavigator(),
}: {
  card: Pick<CardPublic, "text" | "source_label" | "work_title">;
  link: string;
  file: File | null;
  nav?: Partial<ShareNavigator>;
}): Promise<CardShareResult> {
  const title = `오늘의 책갈피 · ${card.work_title}`;
  if (typeof nav?.share === "function") {
    const withFile = file && typeof nav.canShare === "function" && nav.canShare({ files: [file] });
    try {
      if (withFile) {
        await nav.share({ title, url: link, files: [file] });
        return "file";
      }
      await nav.share({ title, url: link });
      return "link";
    } catch (error) {
      if (isAbort(error)) return "cancelled";
      // 파일 공유가 실패(NotAllowedError·TypeError)하면 링크 공유를 한 번 더 시도하지 않는다 —
      // 사용자 제스처가 이미 소비되어 두 번째 시트는 막힌다. 클립보드로 내려간다.
    }
  }
  return (await copyCardText(card, link, nav)) ? "clipboard" : "none";
}

/** 글로 복사. 성공하면 true. */
export async function copyCardText(
  card: Pick<CardPublic, "text" | "source_label">,
  link: string,
  nav: Partial<ShareNavigator> | undefined = currentNavigator(),
): Promise<boolean> {
  if (!nav?.clipboard?.writeText) return false;
  try {
    await nav.clipboard.writeText(cardCopyText(card, link));
    return true;
  } catch {
    return false;
  }
}
