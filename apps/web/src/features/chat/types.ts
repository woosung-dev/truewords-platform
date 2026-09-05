import type { ChatRequest } from "@truewords/api-client-ts/types";

// 입력 화면의 모드 상태는 공통 API 계약의 허용 값에서 가져온다.
export type AnswerMode = NonNullable<ChatRequest["answer_mode"]>;
