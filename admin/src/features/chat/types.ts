// W2-② P0/P1/P2 — 입력 화면에서 ChatRequest 에 실어보낼 옵션 type alias.
// 백엔드 schema 통합(W2-③ feat/chat-request-schema)이 머지되면 OpenAPI 자동 동기화.

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

export type Visibility = "private" | "unlisted" | "public";

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

/** 공개여부 3종 메타데이터 */
export interface VisibilityDef {
  key: Visibility;
  label: string;
  description: string;
}

export const VISIBILITY_OPTIONS: VisibilityDef[] = [
  {
    key: "private",
    label: "비공개",
    description: "나만 볼 수 있어요",
  },
  {
    key: "unlisted",
    label: "공유 가능",
    description: "링크를 받은 사람만 볼 수 있어요",
  },
  {
    key: "public",
    label: "전체 공개",
    description: "누구나 볼 수 있어요",
  },
];
