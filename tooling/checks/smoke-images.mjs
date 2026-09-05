import assert from "node:assert/strict";

// 실행 중인 격리 smoke 컨테이너와 fixture API만 검사한다. 운영 origin은 거부한다.
const origins = [process.env.SMOKE_WEB_URL ?? "http://127.0.0.1:13000", process.env.SMOKE_ADMIN_URL ?? "http://127.0.0.1:13001"];
for (const origin of origins) {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "smoke는 로컬 격리 origin만 허용합니다");
}
const evidence = [];
for (const origin of origins) {
  const page = await fetch(`${origin}/login`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const css = html.match(/(?:href=")([^" ]+\.css(?:\?[^" ]*)?)/)?.[1];
  assert.ok(css, "standalone에 CSS 링크가 있어야 합니다");
  const asset = await fetch(new URL(css, origin));
  assert.equal(asset.status, 200);
  assert.ok((await asset.text()).length > 1000, "앱 UI/Tailwind CSS가 누락됐습니다");
  assert.equal((await fetch(`${origin}/api/backend/health`)).status, 200);
  assert.deepEqual(await (await fetch(`${origin}/api/chatbots`)).json(), await (await fetch(`${origin}/api/backend/chatbots`)).json());

  const login = await fetch(`${origin}/api/backend/admin/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ email: "jangwooseng97@gmail.com", password: "test1234" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "프록시 Set-Cookie 전달 실패");
  assert.equal((await fetch(`${origin}/api/backend/admin/auth/me`, { headers: { cookie } })).status, 200);
  const denied = await fetch(`${origin}/api/backend/admin/users`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(denied.status, 403);
  const validated = await fetch(`${origin}/api/backend/admin/users`, { method: "POST", headers: { cookie, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: "{}" });
  assert.equal(validated.status, 422); // CSRF 통과 후 body 검증; 실제 계정은 만들지 않는다.
  assert.equal((await fetch(`${origin}/api/backend/admin/auth/logout`, { method: "POST", headers: { cookie, "X-Requested-With": "XMLHttpRequest" } })).status, 200);
  evidence.push({ origin, login: 200, staticAssets: 200, csrfDenied: 403, legacyAlias: "equal" });
}

const streamRequest = { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" }, body: JSON.stringify({ chatbot_id: "all", query: "프록시 스트림 검증" }) };
const start = performance.now();
const response = await fetch(`${origins[0]}/api/backend/chat/stream`, streamRequest);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type"), /text\/event-stream/);
const reader = response.body.getReader();
const decoder = new TextDecoder();
const arrivals = [];
let body = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  arrivals.push(Math.round(performance.now() - start));
  const text = decoder.decode(value, { stream: true });
  if (arrivals.length === 1) assert.ok(!text.includes("event: done"), "프록시가 done까지 응답을 버퍼링했습니다");
  body += text;
}
assert.match(body, /event: chunk/);
assert.match(body, /event: done/);
assert.ok(arrivals.length >= 2 && arrivals.at(-1) - arrivals[0] >= 200, "지연 fixture의 점진 전달 증거가 없습니다");
const controller = new AbortController();
const cancellable = await fetch(`${origins[0]}/api/backend/chat/stream`, { ...streamRequest, signal: controller.signal });
const cancelledReader = cancellable.body.getReader();
await cancelledReader.read();
controller.abort();
await assert.rejects(cancelledReader.read(), { name: "AbortError" });
console.log(JSON.stringify({ apps: evidence, sseArrivalMs: arrivals, streamCancellation: "AbortError" }, null, 2));
