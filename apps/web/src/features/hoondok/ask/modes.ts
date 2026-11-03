import { Baby, BookOpen, HeartHandshake, Library, type LucideIcon, Sparkles, Sprout } from "lucide-react";
import type { AnswerMode } from "./ask-stream";

// 답변 모델 — 서버 답변 모드 5종에 사용자용 이름을 붙인 것이다(서버 값은 그대로).
// "자동"은 answer_mode 를 보내지 않는 선택이라 서버 값이 없다.
export type AnswerChoice = AnswerMode | "auto";

export type AnswerModeInfo = { id: AnswerChoice; label: string; description: string; icon: LucideIcon };

export const ANSWER_CHOICES: readonly AnswerModeInfo[] = [
  { id: "auto", label: "자동 (추천)", description: "질문을 보고 알맞은 모델이 답해요", icon: Sparkles },
  { id: "standard", label: "말씀 길잡이", description: "말씀으로 차분히 설명해요", icon: BookOpen },
  { id: "theological", label: "깊은 해설", description: "원리와 배경까지 자세히", icon: Library },
  { id: "beginner", label: "처음 믿는 분", description: "쉬운 말로 풀어 줘요", icon: Sprout },
  { id: "pastoral", label: "마음 돌봄", description: "힘든 마음을 먼저 살펴요", icon: HeartHandshake },
  { id: "kids", label: "어린이", description: "아이 눈높이로 짧게", icon: Baby },
];

export function answerModeInfo(choice: AnswerChoice | undefined): AnswerModeInfo {
  return ANSWER_CHOICES.find((info) => info.id === (choice ?? "auto")) ?? ANSWER_CHOICES[0];
}

/** "말씀 길잡이가 답했어요" — 받침 유무로 조사를 고른다. */
export function answeredByLabel(mode: AnswerMode, verb = "답했어요"): string {
  const label = answerModeInfo(mode).label;
  const last = label.charCodeAt(label.length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${label}${hasFinal ? "이" : "가"} ${verb}`;
}
