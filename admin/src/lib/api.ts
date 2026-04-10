// 공통 API fetch 유틸리티
export async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.method && ["POST", "PUT", "DELETE"].includes(options.method))
      ? { "X-Requested-With": "XMLHttpRequest" }
      : {}),
  };

  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new Error("인증이 필요합니다");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `요청 실패 (${res.status})`);
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
