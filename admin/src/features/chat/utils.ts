// 챗봇 입력 화면 공용 순수 헬퍼·상수.

import type { FeedbackType } from "./types";

// 백엔드 safety layer가 답변 말미에 붙이는 면책 고지를 제거.
// 동일 문구는 입력창 하단 footer에 고정으로 이미 노출된다.
export const DISCLAIMER_PREFIX = "\n\n---\n_이 답변은 AI가 생성한";

export function stripDisclaimer(text: string): string {
  const idx = text.indexOf(DISCLAIMER_PREFIX);
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

// LLM 이 답변 끝에 emit 하는 INLINE_CITATIONS 블록 제거.
// SSE 스트림에서 chunk 단위로 누적되는 동안 사용자에게 잠깐도 보이지 않도록
// onChunk 시점에서 매번 strip. 동기 응답 + sources 도착 시점에도 한 번 더 적용.
// (backend service 가 ChatResponse.answer 에 cleaned 본문을 보내지만, stream chunk
// 는 raw 라 frontend 에서도 strip 필요)
export function stripCitationsBlock(text: string): string {
  const idx = text.indexOf("INLINE_CITATIONS:");
  return idx >= 0 ? text.slice(0, idx).trimEnd() : text;
}

// 봇별 동적 추천이 비어있을 때만 사용하는 fallback. backend cron 갱신 전 / 신규 봇 대응.
export const FALLBACK_PROMPTS = [
  "하나님을 왜 '하늘부모님'이라고 부르나요?",
  "참부모님의 위상과 가치는 왜 영원한가요?",
  "3일 금식은 반드시 해야 하나요?",
  "천일국 시대의 구원 조건은 무엇인가요?",
];

// P0-D — 면책 4문장 + 모델 버전 footer
// (env 미연동, 하드코딩 OK — ADR-46 spec)
export const DISCLAIMER_LINES = [
  "TrueWords AI 답변은 참고용이며, 신앙 지도자의 조언을 대체하지 않습니다.",
  "AI는 종교 텍스트를 학습한 모델이며 교단의 공식 입장과 다를 수 있습니다.",
  "민감한 주제는 반드시 출처 원문과 지도자 안내를 함께 확인해 주세요.",
  "대화 내용은 품질 개선과 안전 점검 목적으로 익명 분석될 수 있습니다.",
];

export const NEGATIVE_REASONS: {
  key: Exclude<FeedbackType, "helpful">;
  label: string;
}[] = [
  { key: "inaccurate", label: "부정확한 답변" },
  { key: "missing_citation", label: "출처 부족/누락" },
  { key: "irrelevant", label: "질문과 무관함" },
  { key: "other", label: "기타 (아래 의견 작성)" },
];
