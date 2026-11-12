import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, setFakeGoogleIdentity, signInWithGoogle, signInWithPassword, test } from "./hoondok-test";

// 로그인 수단: 가입은 구글로만 열려 있다(비밀번호 가입 410). 가짜 제공자는 하네스(apps/api/tests/e2e_app.py)가 주입하지만
// start → 콜백 → 세션 쿠키 → /onboarding/done 은 실제 서버·웹 경로다. 매번 새 계정을 만들어 시드 사용자(hoondok@example.com)를 건드리지 않는다.
const API_DIR = path.resolve(__dirname, "../../apps/api");
const XHR = { "X-Requested-With": "XMLHttpRequest" } as const;
const PASSWORD = "test1234";

type Me = { user: { id: string; display_name: string; login_methods?: { provider: string; email?: string | null }[] } };

async function me(page: import("@playwright/test").Page): Promise<Me["user"]> {
  const response = await page.request.get("/api/backend/hoondok/auth/me");
  expect(response.status()).toBe(200);
  return ((await response.json()) as Me).user;
}

/** 예전 이메일 가입자를 하네스 시드 스크립트로 만든다(가입 API 는 닫혔다). make e2e 와 같은 DB env 를 상속한다. */
function seedPasswordUser(email: string, name: string) {
  execFileSync("uv", ["run", "--frozen", "python", "scripts/seed_hoondok_user.py", email, PASSWORD, "--name", name], {
    cwd: API_DIR,
    stdio: "pipe",
    env: process.env,
  });
}

test("구글로 가입한 뒤 다시 로그인하면 같은 계정이다", async ({ page }) => {
  const identity = await signInWithGoogle(page, { name: "재로그인" });
  // 신규 가입은 맞춤 첫 말씀 질문으로 들어온다
  await expect(page).toHaveURL(/\/start$/);
  const first = await me(page);
  expect(first.display_name).toBe("재로그인");
  expect(first.login_methods?.map((method) => method.provider)).toEqual(["google"]);

  expect((await page.request.post("/api/backend/hoondok/auth/logout", { headers: XHR })).status()).toBe(204);
  expect((await page.request.get("/api/backend/hoondok/auth/me")).status()).toBe(401);

  // 같은 구글 신원 → 새 계정이 아니라 기존 계정(signed_in)이고 returnTo(기본 홈)로 간다
  await signInWithGoogle(page, identity);
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  expect((await me(page)).id).toBe(first.id);

  // 다른 구글 신원은 다른 계정이다
  expect((await page.request.post("/api/backend/hoondok/auth/logout", { headers: XHR })).status()).toBe(204);
  await signInWithGoogle(page, { name: "다른식구" });
  expect((await me(page)).id).not.toBe(first.id);
});

test("구글 로그인을 취소하면 온보딩에 안내가 뜨고 로그인되지 않는다", async ({ page }) => {
  // 신원 쿠키가 없으면 가짜 제공자는 사용자가 동의 화면에서 취소한 것처럼 error 로 돌려보낸다
  await page.context().clearCookies();
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  // Next 라우트 안내(__next-route-announcer)도 role=alert 라 문구로 좁힌다
  await expect(page.getByRole("alert").filter({ hasText: "구글 로그인을 취소했어요" })).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\?error=cancelled/);
  expect((await page.request.get("/api/backend/hoondok/auth/me")).status()).toBe(401);
});

test("설정: 로그인 수단이 구글 하나뿐이면 연결 해제 버튼이 비활성이다", async ({ page }) => {
  const identity = await signInWithGoogle(page, { name: "수단하나", email: `e2e-single-${Date.now()}@example.com` });
  await page.goto("/settings");
  await expect(page.getByText(identity.email)).toBeVisible();
  const unlink = page.getByRole("button", { name: "구글 연결 해제" });
  await expect(unlink).toBeDisabled();
  await expect(page.getByText("마지막 로그인 수단은 해제할 수 없어요")).toBeVisible();
  // 이미 연결돼 있으니 연결 버튼은 없다
  await expect(page.getByRole("button", { name: "구글 계정 연결", exact: true })).toHaveCount(0);

  // 서버도 막는다 (409 LAST_LOGIN_METHOD) — 화면 비활성에만 기대지 않는다
  const [method] = (await me(page)).login_methods as unknown as { identity_id: string }[];
  const response = await page.request.delete(`/api/backend/hoondok/auth/identities/${method.identity_id}`, {
    headers: XHR,
  });
  expect(response.status()).toBe(409);
});

test("기존 비밀번호 계정: 로그인 → 연결 안내 → 구글 연결 → 설정에 구글 · 비밀번호 로그인은 실패", async ({ page }) => {
  const email = `e2e-legacy-${Date.now()}@example.com`;
  seedPasswordUser(email, "예전식구");

  await signInWithPassword(page, { email, password: PASSWORD }, { stopAtLinkPrompt: true });
  const before = await me(page);
  expect(before.login_methods?.map((method) => method.provider)).toEqual(["password"]);

  // 연결 안내에서 구글 연결 → (가짜 제공자) → 콜백 linked → 돌아온다
  const stamp = Date.now();
  const linked = { sub: `e2e-sub-link-${stamp}`, email: `e2e-linked-${stamp}@example.com`, name: "연결구글" };
  await setFakeGoogleIdentity(page, linked);
  await page.getByRole("button", { name: "구글 계정 연결하기" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));

  // 같은 계정에 구글이 붙었고 비밀번호 수단은 사라졌다
  const after = await me(page);
  expect(after.id).toBe(before.id);
  expect(after.login_methods?.map((method) => method.provider)).toEqual(["google"]);
  await page.goto("/settings");
  await expect(page.getByText("구글", { exact: true })).toBeVisible();
  await expect(page.getByText("이메일·비밀번호")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "구글 연결 해제" })).toBeDisabled();

  // 같은 비밀번호로는 더 이상 로그인되지 않는다
  expect((await page.request.post("/api/backend/hoondok/auth/logout", { headers: XHR })).status()).toBe(204);
  const login = await page.request.post("/api/backend/hoondok/auth/login", {
    headers: XHR,
    data: { email, password: PASSWORD },
  });
  expect(login.status()).toBe(401);

  // 그 구글 신원으로 로그인하면 같은 계정이다
  await signInWithGoogle(page, linked);
  expect((await me(page)).id).toBe(before.id);
});
