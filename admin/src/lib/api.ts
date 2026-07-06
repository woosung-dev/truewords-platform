// 공통 API fetch 유틸리티

/**
 * 백엔드 ErrorResponse 형식 (`backend/src/common/schemas.py`).
 * 모든 4xx/5xx 응답은 이 스키마를 따른다.
 */
export interface ApiErrorPayload {
  error_code?: string;
  message?: string;
  request_id?: string;
  details?: unknown;
}

/**
 * 백엔드 에러 응답을 구조화된 형태로 보존하는 Error.
 *
 * UI 측은 ``error.errorCode`` 로 분기해 사용자 친절한 메시지를 표시할 수 있고,
 * raw JSON 응답을 그대로 화면에 노출하던 회귀(2026-05-08)를 방지한다.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload | string) {
    const isStruct = typeof payload !== "string";
    const fallback = `요청 실패 (${status})`;
    const message = isStruct ? (payload.message ?? fallback) : (payload || fallback);
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (isStruct) {
      this.errorCode = payload.error_code;
      this.requestId = payload.request_id;
      this.details = payload.details;
    }
  }
}

/**
 * 응답 body 를 안전하게 파싱해 ``ApiError`` 를 throw 한다.
 *
 * - `application/json` 이면 ``ApiErrorPayload`` 로 해석하고 ``error_code`` 보존.
 * - 그 외 (HTML/text) 는 raw text 를 메시지로 사용.
 * - body 읽기 자체가 실패하면 status 코드만 가진 ApiError.
 */
export async function throwApiError(res: Response): Promise<never> {
  const contentType = res.headers.get("content-type") ?? "";
  let payload: ApiErrorPayload | string;
  try {
    if (contentType.includes("application/json")) {
      payload = (await res.json()) as ApiErrorPayload;
    } else {
      payload = await res.text();
    }
  } catch {
    payload = "";
  }
  throw new ApiError(res.status, payload);
}

export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(options.method))
      ? { "X-Requested-With": "XMLHttpRequest" }
      : {}),
  };

  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    // 이미 /login 이면 리다이렉트 생략 — 로그인 실패(401) 시 same-URL 전체 리로드로
    // 에러 메시지가 지워지는 문제 방지.
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new ApiError(401, { error_code: "UNAUTHORIZED", message: "인증이 필요합니다" });
  }

  if (!res.ok) {
    await throwApiError(res);
  }

  // 204 No Content (body 없음)
  if (res.status === 204) {
    return {} as T;
  }

  const contentType = res.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    return {} as T;
  }
  return (await res.json()) as T;
}
