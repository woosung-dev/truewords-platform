import { test, expect, type Locator, type Page } from "@playwright/test";

const origins = {
  web: process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000",
  admin: process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001",
};

async function setDarkClass(page: Page, isDark: boolean) {
  // 테마 전환 UX를 추가하지 않고 기존 .dark CSS의 이동 회귀만 확인한다.
  await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), isDark);
}

async function expectColor(locator: Locator, property: string, expected: string) {
  // production의 CSS 최적화는 OKLCH를 Lab으로 바꿀 수 있어 문자열 대신 실제 색을 비교한다.
  await expect.poll(() => locator.evaluate((element, values) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const channels = (color: string) => {
      if (!CSS.supports("color", color)) throw new Error(`유효하지 않은 CSS 색상: ${color}`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const actual = channels(getComputedStyle(element).getPropertyValue(values.property));
    const reference = channels(values.expected);
    return Math.max(...actual.map((channel, index) => Math.abs(channel - reference[index])));
  }, { property, expected })).toBeLessThanOrEqual(1);
}

for (const app of ["web", "admin"] as const) {
  for (const mode of ["light", "dark"] as const) {
    test(`${app} ${mode}: 로컬 UI 크기·테마·모바일 Portal·키보드 보존`, async ({ page }, testInfo) => {
      const isDark = mode === "dark";
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`${origins[app]}/login`);
      const email = page.getByLabel("이메일");
      const password = page.getByLabel("비밀번호", { exact: true });
      await expect(email).toBeVisible();
      await setDarkClass(page, isDark);
      await expectColor(page.locator("body"), "background-color", isDark ? "oklch(0.18 0.012 50)" : "oklch(0.988 0.024 95)");
      await expect(email).toHaveCSS("height", "32px");
      await email.fill(app === "admin" ? (process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com") : "admin@test.com");
      await email.press("Tab");
      await expect(password).toBeFocused();
      await password.fill("test1234");
      await password.press("Tab");
      const login = page.getByRole("button", { name: "로그인", exact: true });
      await expect(login).toBeFocused();
      await expect(login).toHaveCSS("height", "32px");
      await login.press("Enter");

      if (app === "admin") {
        await expect(page).toHaveURL(`${origins.admin}/chatbots`);
        await expect(page.getByRole("table")).toBeVisible();
        await expect(page.locator("body")).toHaveClass(/admin-scope/);
        await setDarkClass(page, isDark);
        await expectColor(page.locator("body"), "background-color", isDark ? "oklch(0.18 0.012 50)" : "oklch(0.985 0.005 250)");
        await page.locator('[data-slot="sheet-trigger"]').click();
      } else {
        await page.getByLabel("이름", { exact: true }).fill("UI 회귀 검증");
        await page.getByLabel("카테고리 / 소속").fill("격리 테스트");
        await page.getByRole("button", { name: "채팅 시작" }).click();
        const send = page.getByRole("button", { name: "질문 보내기" });
        await expect(send).toBeDisabled();
        await expect(send).toHaveCSS("height", "48px");
        await expect(page.locator("body")).not.toHaveClass(/admin-scope/);
        await setDarkClass(page, isDark);
        await page.getByRole("button", { name: /^답변 모드/ }).click();
      }

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expectColor(dialog, "background-color", isDark ? "oklch(0.22 0.012 55)" : "oklch(1 0 0)");
      // Portal은 앱 body의 토큰을 상속해야 하며 다른 앱 CSS를 가져오지 않는다.
      const expectedBorder = app === "admin"
        ? (isDark ? "oklch(0.33 0.01 250)" : "oklch(0.91 0.005 250)")
        : (isDark ? "oklch(0.33 0.018 60)" : "oklch(0.89 0.025 78)");
      await expectColor(dialog, "--border", expectedBorder);
      if (app === "web") {
        await expect(dialog.getByRole("button", { name: "적용하기" })).toHaveCSS("height", "56px");
      }
      const screenshotPath = testInfo.outputPath(`${app}-${mode}-portal.png`);
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
      await testInfo.attach(`${app}-${mode}-portal`, { path: screenshotPath, contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
    });
  }
}
