import { test, expect } from "@playwright/test";

const webOrigin = process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000";
const adminOrigin = process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001";
// 시연 관리자 게이트 계정. API 의 DEMO_ADMIN_EMAIL 과 같아야 한다 (playwright.config 가 주입).
const adminEmail = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";
const csrf = { "X-Requested-With": "XMLHttpRequest" };

test("기존 관리 URL은 독립 관리자 origin으로 연결된다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(`${adminOrigin}/login`);
  await expect(page.getByRole("heading", { name: "관리자 로그인" })).toBeVisible();
});

test("호스트가 다른 웹/관리자 로그인 쿠키는 자동 공유되지 않는다", async ({ context }) => {
  expect(new URL(webOrigin).hostname).not.toBe(new URL(adminOrigin).hostname);
  const login = await context.request.post(`${webOrigin}/api/backend/admin/auth/login`, {
    headers: csrf, data: { email: adminEmail, password: "test1234" },
  });
  expect(login.status()).toBe(200);
  expect((await context.request.get(`${webOrigin}/api/backend/admin/auth/me`)).status()).toBe(200);
  expect((await context.request.get(`${adminOrigin}/api/backend/admin/auth/me`)).status()).toBe(401);
});

test("정규 API 프록시와 구 alias가 같은 응답을 제공한다", async ({ request }) => {
  const canonical = await request.get(`${webOrigin}/api/backend/chatbots`);
  const legacy = await request.get(`${webOrigin}/api/chatbots`);
  expect(canonical.status()).toBe(200);
  expect(await canonical.json()).toEqual(await legacy.json());
  const canonicalReaction = await request.get(`${webOrigin}/api/backend/api/chat/messages/00000000-0000-4000-8000-000000000000/reactions`);
  const legacyReaction = await request.get(`${webOrigin}/api/chat/messages/00000000-0000-4000-8000-000000000000/reactions`);
  expect(canonicalReaction.status()).toBe(legacyReaction.status());
  expect(await canonicalReaction.json()).toEqual(await legacyReaction.json());
});

test("관리자 mutation은 프록시를 거쳐도 CSRF 헤더가 필요하다", async ({ request }) => {
  await request.post(`${adminOrigin}/api/backend/admin/auth/login`, {
    headers: csrf, data: { email: adminEmail, password: "test1234" },
  });
  const data = { email: `csrf-${Date.now()}@example.com`, password: "test1234", role: "admin" };
  const denied = await request.post(`${adminOrigin}/api/backend/admin/users`, { data });
  expect(denied.status()).toBe(403);
  const allowed = await request.post(`${adminOrigin}/api/backend/admin/users`, { headers: csrf, data });
  expect(allowed.status()).toBe(201);
});

test("같은 API를 써도 다른 계정의 실제 대화 기록은 열 수 없다", async ({ playwright }) => {
  const owner = await playwright.request.newContext({ baseURL: webOrigin });
  const other = await playwright.request.newContext({ baseURL: webOrigin });
  try {
    expect((await owner.post("/api/backend/admin/auth/login", {
      headers: csrf, data: { email: adminEmail, password: "test1234" },
    })).status()).toBe(200);
    expect((await other.post("/api/backend/admin/auth/login", {
      headers: csrf, data: { email: "admin@test.com", password: "test1234" },
    })).status()).toBe(200);
    const bots = await (await owner.get("/api/backend/chatbots")).json();
    const created = await owner.post("/api/backend/chat", {
      headers: csrf, data: { query: "대화 소유권 검증", chatbot_id: bots[0].chatbot_id },
    });
    expect(created.status()).toBe(200);
    const { session_id: sessionId } = await created.json();
    expect((await owner.get(`/api/backend/chat/sessions/${sessionId}`)).status()).toBe(200);
    expect((await other.get(`/api/backend/chat/sessions/${sessionId}`)).status()).toBe(404);
  } finally {
    await owner.dispose();
    await other.dispose();
  }
});
