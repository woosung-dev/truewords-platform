import { createClient } from "./generated/client";
import { type ApiClientOptions, createTransport } from "./index";

// 생성 SDK(`./sdk`)에 넘기는 client. 앱의 일반 요청 경로(createApiClient)에서 분리해 번들에 실리지 않게 한다.
export function createSdkClient(options: ApiClientOptions = {}) {
  const { baseUrl, transport } = createTransport(options);
  return createClient({ baseUrl, credentials: "include", fetch: transport, throwOnError: true });
}
