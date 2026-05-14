// 입력 화면에서 ChatRequest 에 실어보낼 옵션 type alias.
// PoC 정리 (2026-04-29): P2-D Visibility 제거. 운영 인프라 (ChatbotConfig.visibility
// 컬럼 + 백엔드 검증) 도입 시 재추가.
// v3 개편 (2026-05-14): P1-G TheologicalEmphasis 5종 폐기. 강조점은 모드 모듈에 흡수.

export type AnswerMode =
  | "standard"
  | "theological"
  | "pastoral"
  | "beginner"
  | "kids";
