import { createClient } from "./generated/client";

export interface ApiErrorPayload {
  error_code?: string;
  message?: string;
  request_id?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly errorCode?: string;
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, payload: ApiErrorPayload | string) {
    super(
      typeof payload === "string" ? payload || `요청 실패 (${status})` : payload.message || `요청 실패 (${status})`,
    );
    this.name = "ApiError";
    this.status = status;
    if (typeof payload !== "string") {
      this.errorCode = payload.error_code;
      this.requestId = payload.request_id;
      this.details = payload.details;
    }
  }
}

function isJson(response: Response) {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return type === "application/json" || Boolean(type?.endsWith("+json"));
}

export async function throwApiError(response: Response): Promise<never> {
  let payload: ApiErrorPayload = {};
  try {
    const data: unknown = isJson(response) ? await response.json() : await response.text();
    if (typeof data === "object" && data !== null) {
      const value = data as Record<string, unknown>;
      payload = {
        error_code: typeof value.error_code === "string" ? value.error_code : undefined,
        message:
          typeof value.message === "string"
            ? value.message
            : typeof value.detail === "string"
              ? value.detail
              : undefined,
        request_id: typeof value.request_id === "string" ? value.request_id : undefined,
        details: value.details ?? value.detail,
      };
    } else if (typeof data === "string") payload.message = data;
  } catch {
    // 프록시의 빈 오류 응답도 HTTP 상태와 추적 ID는 보존한다.
  }
  payload.request_id ??= response.headers.get("x-request-id") ?? undefined;
  throw new ApiError(response.status, payload);
}

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  onUnauthorized?: () => void;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? "/api/backend").replace(/\/$/, "");
  // 사용자 상태/토큰은 모듈 전역에 저장하지 않는다. SSR은 요청별 인스턴스를 만든다.
  const transport: typeof globalThis.fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers.set("X-Requested-With", "XMLHttpRequest");
    }
    const response = await (options.fetch ?? globalThis.fetch)(input, { ...init, credentials: "include", headers });
    if (response.status === 401) options.onUnauthorized?.();
    if (!response.ok) await throwApiError(response);
    return response;
  };
  const client = createClient({ baseUrl, credentials: "include", fetch: transport, throwOnError: true });

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new TypeError("API path must be relative to the configured API origin");
    }
    const headers = new Headers(init.headers);
    if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    // FormData의 boundary는 fetch가 설정한다. JSON 헤더를 덮어씌우지 않는다.
    if (init.body instanceof FormData) headers.delete("Content-Type");
    const response = await transport(`${baseUrl}${path}`, { ...init, headers });
    if (response.status === 204) return {} as T;
    if (!isJson(response)) {
      throw new ApiError(response.status, { error_code: "INVALID_RESPONSE", message: "JSON 응답이 필요합니다" });
    }
    return (await response.json()) as T;
  }

  return { request, client };
}
