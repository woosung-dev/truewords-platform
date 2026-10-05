import { ApiError } from "@/lib/api";

// 원인 + 다음 행동. ApiError.message 는 서버 문구가 없으면 일반 문구라 status 로 분기한다.
export function traceErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도해 주세요.";
  switch (err.status) {
    case 429:
      return "파이프라인 추적이 이미 2건 실행 중입니다. 잠시 후 다시 시도해 주세요.";
    case 404:
      return "챗봇을 찾을 수 없습니다. 챗봇 목록을 확인해 주세요.";
    case 403:
      return "권한이 없습니다. 관리자 계정으로 다시 로그인해 주세요.";
    case 422:
      return "입력값이 올바르지 않습니다. 질문(1~1000자)과 옵션을 확인해 주세요.";
    case 502:
    case 504:
      return "응답 시간이 초과되었습니다. 실행 범위를 줄여(검색까지) 다시 시도해 주세요.";
    default: {
      const suffix = err.requestId ? ` (요청 ID ${err.requestId})` : "";
      return err.status >= 500
        ? `서버 오류로 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.${suffix}`
        : `실행에 실패했습니다: ${err.message}${suffix}`;
    }
  }
}
