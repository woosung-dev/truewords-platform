import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

// 함께 읽는 모임 E2E (PLAN-HD-010 §9, hoondok-chromium). 두 브라우저 컨텍스트 = 두 계정.
// A 가입 → 모임 만들기 → 코드 · B 가입 → join?code= → 참여 · B 훈독 완료 → 한 줄 · A 상세에 B 만(A 없음) → 반응 ·
// B 내 한 줄에 반응 수 · A 설정에서 B 내보내기 → B 새로고침 시 "볼 수 없어요". 홈 모임 카드는 W2 몫이라 여기서 보지 않는다.
// 플래그(NEXT_PUBLIC_HOONDOK_TOGETHER=1)는 playwright.config webServer env 가 준다. 계정은 매번 새로 만든다(재실행 안전).
const headers = { "X-Requested-With": "XMLHttpRequest" };

async function newAccount(browser: Browser, prefix: string, displayName: string, width: number) {
  // browser.newContext 는 project use.baseURL 을 받지 않는다 — 직접 넘긴다
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: {
      email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "password1",
      display_name: displayName,
    },
  });
  expect(response.status()).toBe(201);
  return { context, page };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("두 계정 모임 왕복: 만들기 → 참여 → 한 줄 → 완료자만 → 반응 → 내보내기", async ({ browser }) => {
  test.setTimeout(90_000);
  const contexts: BrowserContext[] = [];
  try {
    const a = await newAccount(browser, "group-a", "리더에이", 1280);
    const b = await newAccount(browser, "group-b", "식구비", 390);
    contexts.push(a.context, b.context);
    const groupName = `모임${Date.now().toString().slice(-6)}`;

    // ---- A: 모임 만들기 → 초대 코드 ----
    const created = await a.page.goto("/hoondok/groups/new");
    expect(created?.status()).toBe(200);
    await a.page.getByLabel("모임 이름").fill(groupName);
    await expect(a.page.getByLabel("이 모임에서 쓸 내 이름")).toHaveValue("리더에이");
    await a.page.getByRole("button", { name: "모임 만들기" }).click();
    await expect(a.page.getByText("모임을 만들었어요")).toBeVisible();
    await expect(a.page).toHaveURL(/\/hoondok\/groups\/new\?created=/);
    const code = (await a.page.locator(".tg-code").innerText()).trim();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await expectNoHorizontalOverflow(a.page);
    await a.page.getByRole("link", { name: /모임으로 가기/ }).click();
    await expect(a.page).toHaveURL(/\/hoondok\/groups\/[0-9a-f-]{36}$/);
    const groupPath = new URL(a.page.url()).pathname;

    // ---- B: 링크(소문자·하이픈 없음으로 줘도 된다) → 미리보기 → 참여 ----
    await b.page.goto(`/hoondok/groups/join?code=${code.replace("-", "").toLowerCase()}`);
    await expect(b.page.getByRole("heading", { name: groupName })).toBeVisible();
    await expect(b.page.getByLabel("초대 코드")).toHaveValue(code);
    await expect(b.page.getByText("모임에 보이는 것")).toBeVisible();
    await expect(b.page.getByText(/리더 리더에이/)).toBeVisible();
    await expectNoHorizontalOverflow(b.page);
    await b.page.getByRole("button", { name: "모임에 참여하기" }).click();
    await expect(b.page).toHaveURL(new RegExp(`${groupPath}$`));
    // 훈독 전에는 한 줄 대신 훈독하기로 보낸다
    await expect(b.page.getByRole("link", { name: "훈독하기", exact: true })).toBeVisible();
    await expect(b.page.getByRole("link", { name: "한 줄 남기기", exact: true })).toHaveCount(0);

    // ---- B: 오늘 훈독 완료 → 한 줄 ----
    expect((await b.page.request.post("/api/backend/hoondok/missions/read/complete", { headers })).status()).toBe(201);
    await b.page.reload();
    await b.page.getByRole("link", { name: "한 줄 남기기", exact: true }).click();
    await expect(b.page).toHaveURL(new RegExp(`${groupPath}/share$`));
    await b.page.getByLabel(`${groupName}에 남길 한 줄`).fill("  오늘 말씀에 오래 머물렀어요.  ");
    await b.page.getByRole("button", { name: "한 줄 남기기" }).click();
    await expect(b.page).toHaveURL(new RegExp(`${groupPath}$`));
    await expect(b.page.getByText("오늘 말씀에 오래 머물렀어요.")).toBeVisible();
    await expect(b.page.getByText("0명이 함께 머물렀어요 · 나에게만 보여요")).toBeVisible();
    await expectNoHorizontalOverflow(b.page);

    // ---- A: 상세에는 완료자 B 만(A 는 안 읽었으므로 없다), 인원 수 없음 ----
    await a.page.reload();
    const readers = a.page.getByRole("list", { name: "오늘 함께 읽은 식구" });
    await expect(readers.getByRole("listitem")).toHaveCount(1);
    await expect(readers).toContainText("식구비");
    await expect(readers).not.toContainText("리더에이");
    await expect(readers).toContainText(/오[전후] \d{1,2}:\d{2}/);
    await expect(a.page.getByText("안 읽은 사람은 표시하지 않아요.", { exact: true })).toBeVisible();
    await expect(a.page.locator("body")).not.toContainText(/식구 \d+명/);
    // ---- A: 반응 "함께 머물렀어요" ----
    const stay = a.page.getByRole("button", { name: "함께 머물렀어요" });
    await expect(stay).toHaveAttribute("aria-pressed", "false");
    await stay.click();
    await expect(stay).toHaveAttribute("aria-pressed", "true");
    await expectNoHorizontalOverflow(a.page);

    // ---- B: 내 한 줄에만 반응 수 ----
    await b.page.reload();
    await expect(b.page.getByText("1명이 함께 머물렀어요 · 나에게만 보여요")).toBeVisible();

    // ---- A: 설정 — 식구 2명, 태블릿 폭 가로 넘침 0, B 내보내기 ----
    await a.page.setViewportSize({ width: 768, height: 900 });
    await a.page.goto(`${groupPath}/settings`);
    await expect(a.page.getByText("식구 2명")).toBeVisible();
    await expectNoHorizontalOverflow(a.page);
    await expect(a.page.getByRole("button", { name: "나가기" })).toBeDisabled();
    await a.page.getByRole("button", { name: "내보내기", expanded: false }).click();
    const confirm = a.page.getByRole("group", { name: "식구비 님 내보내기 확인" });
    await confirm.getByRole("button", { name: "내보내기" }).click();
    await expect(a.page.getByText("식구 1명")).toBeVisible();

    // ---- B: 새로고침하면 "이 모임을 볼 수 없어요" (오류 화면이 아니다) ----
    await b.page.reload();
    await expect(b.page.getByText("이 모임을 볼 수 없어요")).toBeVisible();
    await expect(b.page.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/hoondok");

    // ---- A: B 의 한 줄·읽음도 함께 사라진다 ----
    await a.page.goto(groupPath);
    await expect(a.page.getByText("오늘 말씀에 오래 머물렀어요.")).toHaveCount(0);
    await expect(a.page.getByRole("list", { name: "오늘 함께 읽은 식구" })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("비로그인 참여 링크는 코드를 실은 returnTo 로 온보딩에 보낸다", async ({ page }) => {
  const response = await page.goto("/hoondok/groups/join?code=7K2M-Q9XD");
  expect(response?.status()).toBe(200);
  const link = page.getByRole("link", { name: "가입하거나 로그인하기" });
  await expect(link).toHaveAttribute(
    "href",
    `/hoondok/onboarding?returnTo=${encodeURIComponent("/hoondok/groups/join?code=7K2M-Q9XD")}`,
  );
});
