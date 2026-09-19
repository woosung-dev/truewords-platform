// SCR-PWA-005·006 AI 질문 어댑터 — 시연 챗과 같은 `POST /api/backend/chat/stream` SSE 를 소비한다
// (PLAN-HD-002 W2 · §9 2026-09-19 결정). 백엔드·스키마·프롬프트는 건드리지 않는다.
//
// 훈독만의 규칙 둘:
//  1) 무기억 — `session_id` 를 보내지 않는다. 질문 1건 = 새 세션이고 이어 묻기도 새 요청이다.
//  2) 근거 게이트 — chunk 텍스트를 화면에 바로 흘리지 않고 모아 두었다가 `sources` 가 1건 이상일 때만
//     답과 근거를 함께 보인다. 0건이면 답을 버리고 "확인할 수 없음" 으로 끝낸다(AC-017-01·04).

import type { ChatChunkEvent, ChatDoneEvent, ChatSourcesEvent, Source } from "@truewords/api-client-ts/types";
import { parseSSEStream } from "@/lib/sse";

/**
 * 훈독 질문이 쓰는 봇 슬러그 (`chatbot_id`, UUID 아님).
 *
 * `[확인 필요]` 훈독 전용 봇·시스템 프롬프트는 미정이라 기존 봇을 재사용한다(PLAN-HD-002 §9).
 * `all`(전체 검색 = 소스 A·B·C, 말씀선집 포함)을 고른 근거는 두 가지다.
 *  - 시연 챗의 운영 기본값이 `all` 이고(`apps/web/src/app/(chat)/page.tsx`) 실제로 근거가 돌아오는 것이 확인된
 *    유일한 슬러그다. 없는 슬러그를 보내면 `/chat/stream` 이 404 를 준다.
 *  - 시드의 `malssum_priority` 는 A 단독 티어의 `score_threshold` 가 0.75 로, RuntimeConfig 가 적은
 *    RRF 점수 범위(0.0~0.5, `apps/api/app/modules/chatbot/runtime_config.py`) 위라 근거 0건이 상시화될 위험이 있다.
 */
export const HOONDOK_ASK_CHATBOT_ID = "all";

/** 근거 게이트를 통과하기 전의 원자료. sources 가 빈 배열이면 답을 보이지 않는다. */
export type AskResult = {
  answer: string;
  sources: Source[];
  disclaimer: string;
};

export type AskErrorKind = "rate-limit" | "failed";

export const ASK_ERROR_MESSAGE: Record<AskErrorKind, string> = {
  "rate-limit": "지금은 질문이 많아요. 잠시 뒤 다시 물어봐 주세요",
  failed: "답을 받지 못했어요",
};

export class AskError extends Error {
  readonly kind: AskErrorKind;

  constructor(kind: AskErrorKind) {
    super(ASK_ERROR_MESSAGE[kind]);
    this.name = "AskError";
    this.kind = kind;
  }
}

/** 던져진 값을 화면 문구로. AbortError 는 사용자가 떠난 것이므로 호출자가 먼저 걸러낸다. */
export function askErrorMessage(error: unknown): string {
  return error instanceof AskError ? error.message : ASK_ERROR_MESSAGE.failed;
}

/**
 * 질문 1건을 보내고 답·근거·고지를 모아서 돌려준다.
 *
 * 경로·헤더·이벤트 처리 순서는 시연 챗(`features/chatbot/chat-api.ts`)과 같다 — 같은 프록시를 쓰므로
 * `X-Requested-With` 와 쿠키 동봉도 그대로다. 다른 점은 `session_id`·`answer_mode` 를 보내지 않는 것뿐이다.
 */
export async function requestAsk(question: string, signal?: AbortSignal): Promise<AskResult> {
  const res = await fetch("/api/backend/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    credentials: "include",
    body: JSON.stringify({ query: question, chatbot_id: HOONDOK_ASK_CHATBOT_ID }),
    signal,
  });
  if (!res.ok) throw new AskError(res.status === 429 ? "rate-limit" : "failed");
  if (!res.body) throw new AskError("failed");

  const chunks: string[] = [];
  let sources: Source[] | null = null;
  let disclaimer = "";
  await parseSSEStream(res.body.getReader(), (event) => {
    if (!event.data) return;
    try {
      switch (event.event) {
        case "chunk": {
          const parsed = JSON.parse(event.data) as ChatChunkEvent;
          if (parsed.text) chunks.push(parsed.text);
          return;
        }
        case "sources": {
          const parsed = JSON.parse(event.data) as ChatSourcesEvent;
          sources = parsed.sources ?? [];
          return;
        }
        case "done": {
          disclaimer = (JSON.parse(event.data) as ChatDoneEvent).disclaimer ?? "";
          return;
        }
        // 그 외 이벤트는 무시 (향후 확장 호환).
      }
    } catch {
      // 깨진 JSON 한 건이 스트림 전체를 끊지 않게 — 근거가 끝내 안 오면 아래에서 실패로 끝난다.
    }
  });

  // sources 이벤트 자체가 없으면 연결이 중간에 끊긴 것이다. 0건(빈 배열)은 "근거 없음" 이라 성공 경로다.
  if (sources === null) throw new AskError("failed");
  return { answer: chunks.join("").trim(), sources, disclaimer };
}
