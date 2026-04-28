// W2-② — 입력 화면에서 ChatRequest 에 실어보낼 옵션 type alias.
// PoC 정리 (2026-04-29): P2-D Visibility 제거. 운영 인프라 (ChatbotConfig.visibility
// 컬럼 + 백엔드 검증) 도입 시 재추가.

export type AnswerMode =
  | "standard"
  | "theological"
  | "pastoral"
  | "beginner"
  | "kids";

export type TheologicalEmphasis =
  | "all"
  | "principle"
  | "providence"
  | "family"
  | "youth";

/** 강조점 5종 메타데이터 — emphasis-sheet 에서 공유 */
export interface EmphasisDef {
  key: TheologicalEmphasis;
  label: string;
  description: string;
  badge?: string;
}

export const EMPHASIS_OPTIONS: EmphasisDef[] = [
  {
    key: "all",
    label: "전체 (균형)",
    description: "특정 주제에 치우치지 않고 균형 있게 답변",
    badge: "추천",
  },
  {
    key: "principle",
    label: "원리 중심",
    description: "통일원리·교리 기반의 체계적인 설명",
  },
  {
    key: "providence",
    label: "후천기·섭리사 중심",
    description: "섭리 시대 흐름과 후천기 의미 중심",
  },
  {
    key: "family",
    label: "가정·축복 중심",
    description: "참가정·축복결혼·가정연합 관점",
  },
  {
    key: "youth",
    label: "청년·실천 중심",
    description: "청년 신앙 생활과 실천 적용 중심",
  },
];
