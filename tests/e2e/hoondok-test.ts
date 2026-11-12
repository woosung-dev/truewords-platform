import { randomBytes } from "node:crypto";
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

export { expect };

// 훈독 스펙은 이 test 를 쓴다. 서버의 "오늘"(today_kst)은 실제 시계를 따르므로, 테스트 도중 KST 자정을 넘으면
// 앞서 받은 오늘 카드·편성이 어제 것이 되어 화면이 바뀐다(예: "책갈피 다시 꺼내기" → "책갈피로 돌아가기").
// 자정 직전이면 자정을 넘긴 뒤 시작한다. 시드의 오늘 편성은 20일치라 다음 날로 넘어가도 비지 않는다.
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const GUARD_MS = 120_000; // 가장 긴 훈독 테스트(90초)보다 길게
const SETTLE_MS = 2_000;

/** KST 자정까지 windowMs 보다 적게 남았으면 자정을 넘길 때까지 기다린다. testInfo 를 주면 그만큼 시간 제한을 늘린다. */
export async function waitPastKstMidnight(windowMs: number, testInfo?: TestInfo): Promise<void> {
  const left = DAY_MS - ((Date.now() + KST_OFFSET_MS) % DAY_MS);
  if (left >= windowMs) return;
  testInfo?.setTimeout(testInfo.timeout + left + SETTLE_MS);
  await new Promise((resolve) => setTimeout(resolve, left + SETTLE_MS));
}

export const test = base.extend<{ kstDayBoundary: undefined }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use) => {
    // 별도 방문자들이 loopback IP 한 개의 제한을 공유하지 않게 한다. 같은 테스트 안의 제한은 유지한다.
    const visitorIp = `2001:db8:${randomBytes(12)
      .toString("hex")
      .replace(/.{4}(?=.)/g, "$&:")}`;
    await use({ ...extraHTTPHeaders, "CF-Connecting-IP": visitorIp });
  },
  kstDayBoundary: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture 는 첫 인자를 구조 분해로 받아야 한다
    async ({}, use) => {
      await waitPastKstMidnight(GUARD_MS);
      await use(undefined);
    },
    // 자기 시간 슬롯 — 기다린 시간이 테스트 시간 제한(본문의 test.setTimeout 포함)을 쓰지 않게.
    // beforeAll 은 이 fixture 보다 먼저 돈다. 거기서 오늘 데이터를 만지는 스펙은 waitPastKstMidnight 를 직접 부른다.
    { auto: true, timeout: GUARD_MS + SETTLE_MS + 10_000 },
  ],
});

// --- 구글 로그인 -----------------------------------------------------------------------------------------
// 이메일·비밀번호 가입은 닫혔다(410). 신규 계정은 구글 OIDC 로만 생긴다. 하네스 API(apps/api/tests/e2e_app.py)는 가짜 제공자를
// 주입해 실제 start → 콜백 → 세션 쿠키 경로를 그대로 태운다. 사용자는 웹 origin 의 `e2e_fake_google` 쿠키로 지정한다.
export type GoogleIdentity = { sub?: string; email?: string; name?: string };
export type ResolvedGoogleIdentity = Required<GoogleIdentity>;

const FAKE_IDENTITY_COOKIE = "e2e_fake_google";
const XHR = { "X-Requested-With": "XMLHttpRequest" } as const;

function resolveIdentity(identity: GoogleIdentity): ResolvedGoogleIdentity {
  const id = randomBytes(6).toString("hex");
  return {
    sub: identity.sub ?? `e2e-sub-${id}`,
    email: identity.email ?? `e2e-${id}@example.com`,
    name: identity.name ?? "구글식구",
  };
}

/** 다음 구글 로그인에 쓸 신원을 이 브라우저 컨텍스트에 지정한다. */
export async function setFakeGoogleIdentity(page: Page, identity: ResolvedGoogleIdentity): Promise<void> {
  const origin = test.info().project.use.baseURL ?? process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
  await page.context().addCookies([
    { name: FAKE_IDENTITY_COOKIE, value: Buffer.from(JSON.stringify(identity)).toString("base64url"), url: origin },
  ]);
}

/**
 * 실제 화면의 `Google로 계속하기` 로 가입·로그인한다 — start → (가짜 제공자) → 콜백 → /onboarding/done → 최종 화면.
 * 신규 계정이면 맞춤 첫 말씀 질문(/start)으로, 기존 계정이면 returnTo(기본 홈)로 도착한다. 도착한 뒤 돌아온다.
 */
export async function signInWithGoogle(
  page: Page,
  identity: GoogleIdentity & { returnTo?: string } = {},
): Promise<ResolvedGoogleIdentity> {
  const resolved = resolveIdentity(identity);
  await setFakeGoogleIdentity(page, resolved);
  await page.goto(identity.returnTo ? `/onboarding?returnTo=${encodeURIComponent(identity.returnTo)}` : "/onboarding");
  await page.getByRole("button", { name: "Google로 계속하기" }).click();
  // /onboarding/done 은 /me 를 부른 뒤 곧 이동한다 — 온보딩 밖(최종 화면)에 도착할 때까지 기다린다
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));
  return resolved;
}

/**
 * 화면 없이 같은 서버 경로(start → 콜백 → 세션 쿠키)를 request 컨텍스트로 탄다. 계정만 필요한 API 중심 스펙용이다.
 * 쿠키는 page 컨텍스트와 공유되므로 이후 page.goto 가 로그인 상태다.
 */
export async function signInWithGoogleApi(
  page: Page,
  identity: GoogleIdentity = {},
): Promise<ResolvedGoogleIdentity & { status: "created" | "signed_in" }> {
  const resolved = resolveIdentity(identity);
  await setFakeGoogleIdentity(page, resolved);
  const start = await page.request.post("/api/backend/hoondok/auth/oauth/google/start", {
    headers: XHR,
    data: { intent: "login" },
  });
  expect(start.status()).toBe(200);
  const { authorization_url } = (await start.json()) as { authorization_url: string };
  // 제공자 → 콜백은 둘 다 302 다. 리다이렉트를 직접 따라가 Set-Cookie(세션)를 컨텍스트에 남긴다
  const authorize = await page.request.get(authorization_url, { maxRedirects: 0 });
  expect(authorize.status()).toBe(302);
  const callback = await page.request.get(authorize.headers().location, { maxRedirects: 0 });
  expect(callback.status()).toBe(302);
  const status = new URL(callback.headers().location).searchParams.get("status");
  expect(callback.headers().location).toMatch(/\/onboarding\/done\?status=(created|signed_in)/);
  return { ...resolved, status: status as "created" | "signed_in" };
}

/**
 * 예전 이메일 가입자의 비밀번호 로그인(임시 경로). 소셜 수단이 없으면 구글 연결 안내가 먼저 뜨므로 `나중에 할게요` 로 넘기고 returnTo 에 도착한다.
 * 구글 연결까지 이어가려면 stopAtLinkPrompt 를 true 로 두고 안내에서 멈춘다(호출자가 `구글 계정 연결하기` 를 누른다).
 */
export async function signInWithPassword(
  page: Page,
  credentials: { email: string; password: string },
  options: { stopAtLinkPrompt?: boolean } = {},
): Promise<void> {
  await page.goto("/onboarding");
  await page.getByRole("button", { name: "예전에 이메일로 가입했어요" }).click();
  const form = page.getByRole("form", { name: "이메일 로그인" });
  await form.getByLabel("이메일", { exact: true }).fill(credentials.email);
  await form.getByLabel("비밀번호", { exact: true }).fill(credentials.password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  const prompt = page.getByRole("group", { name: "구글 계정 연결 안내" });
  await expect(prompt).toBeVisible();
  if (options.stopAtLinkPrompt) return;
  await prompt.getByRole("button", { name: "나중에 할게요" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/onboarding"));
}
