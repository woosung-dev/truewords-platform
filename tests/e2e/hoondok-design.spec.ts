import { expect, test } from "./hoondok-test";

test("글자 200%에서도 관심사 마지막 버튼이 저장 막대에 가리지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("hoondok:personal:answers", JSON.stringify({ interests: ["family"], moods: [] }));
  });
  await page.goto("/hoondok/garden/interests");
  const clear = page.getByRole("button", { name: "모두 지우기" });
  await expect(clear).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const button = await clear.boundingBox();
  const bar = await page.locator(".ps-bar").boundingBox();
  if (!button || !bar) throw new Error("마지막 버튼과 저장 막대가 보여야 합니다");
  expect(button.y + button.height).toBeLessThanOrEqual(bar.y);
  await clear.click();
  await expect(page.getByRole("group", { name: "고른 답 모두 지우기 확인" })).toBeVisible();
});

test("가로로 이어지는 교회장 목록을 키보드로 살펴볼 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto("/hoondok/worship");
  const pastors = page.getByRole("list", { name: "우리 지역 교회장" });
  await pastors.focus();
  await expect(pastors).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => pastors.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("폼의 키보드 초점이 하단 주 메뉴 뒤에 숨지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const signup = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { email: `design-focus-${Date.now()}@example.com`, password: "password1", display_name: "검토식구" },
  });
  expect(signup.status()).toBe(201);
  await page.goto("/hoondok/groups/new");
  const toggle = page.getByRole("button", { name: "모임 정성 열기" });
  await toggle.focus();
  const control = await toggle.boundingBox();
  const nav = await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox();
  if (!control || !nav) throw new Error("모임 정성 버튼과 주 메뉴가 보여야 합니다");
  expect(control.y + control.height).toBeLessThanOrEqual(nav.y);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});
