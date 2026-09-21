// 검색어가 Next rewrite 프록시의 연결 실패 로그에 남지 않도록 이 공개 경로만 직접 전달한다.
// 검색·권리·검증·요청 제한은 FastAPI가 계속 소유한다. 개인 쿠키는 전달하지 않는다.
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function GET(request: Request): Promise<Response> {
  try {
    const target = new URL(`${API_ORIGIN.replace(/\/$/, "")}/hoondok/search`);
    target.search = new URL(request.url).search;
    const headers = new Headers({ Accept: "application/json" });
    // 기존 프록시와 동일한 Cloudflare 우선 IP 제한을 유지한다.
    for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const upstream = await fetch(target, {
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
    });
    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    for (const name of ["content-type", "retry-after", "x-request-id"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // 본문 수신 중 단절도 여기서 잡아 프레임워크 오류 로그로 검색 URL이 전파되지 않게 한다.
    const body = await upstream.arrayBuffer();
    return new Response(body, { status: upstream.status, headers: responseHeaders });
  } catch {
    // 예외 객체·요청 URL·검색어를 기록하지 않는다. 클라이언트는 고정 코드의 api_5xx 이벤트만 보고한다.
    return Response.json(
      { error_code: "SEARCH_FAILED", message: "검색에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
