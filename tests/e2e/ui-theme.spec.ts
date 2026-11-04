import { expect, type Locator, test } from "@playwright/test";

const origins = {
  web: process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000",
  admin: process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001",
};

async function expectColor(locator: Locator, property: string, expected: string) {
  // production의 CSS 최적화는 OKLCH를 Lab으로 바꿀 수 있어 문자열 대신 실제 색을 비교한다.
  await expect
    .poll(() =>
      locator.evaluate(
        (element, values) => {
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
        },
        { property, expected },
      ),
    )
    .toBeLessThanOrEqual(1);
}

// 관리자 앱은 라이트 테마만 지원한다(다크 팔레트 제거). 라이트 토큰·크기·Portal·키보드만 확인한다.
// 웹은 시연 챗 로그인·채팅 화면을 지웠다(DEC-PWA-026). 훈독 화면의 토큰·폭은 hoondok*.spec.ts 가 본다.
for (const app of ["admin"] as const) {
  test(`${app}: 로컬 UI 크기·테마·모바일 Portal·키보드 보존`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origins[app]}/login`);
    const email = page.getByLabel("이메일");
    const password = page.getByLabel("비밀번호", { exact: true });
    await expect(email).toBeVisible();
    await expectColor(page.locator("body"), "background-color", "oklch(0.988 0.024 95)");
    await expect(email).toHaveCSS("height", "44px");
    await email.fill(process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com");
    await email.press("Tab");
    await expect(password).toBeFocused();
    await password.fill("test1234");
    await password.press("Tab");
    await expect(page.getByRole("button", { name: "비밀번호 표시", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    const login = page.getByRole("button", { name: "로그인", exact: true });
    await expect(login).toBeFocused();
    await expect(login).toHaveCSS("height", "44px");
    await login.press("Enter");

    await expect(page).toHaveURL(`${origins.admin}/chatbots`);
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/admin-scope/);
    await expectColor(page.locator("body"), "background-color", "oklch(0.985 0.005 250)");
    await page.locator('[data-slot="sheet-trigger"]').click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectColor(dialog, "background-color", "oklch(1 0 0)");
    // Portal은 앱 body의 토큰을 상속해야 하며 다른 앱 CSS를 가져오지 않는다.
    await expectColor(dialog, "--border", "oklch(0.91 0.005 250)");
    const screenshotPath = testInfo.outputPath(`${app}-portal.png`);
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    await testInfo.attach(`${app}-portal`, { path: screenshotPath, contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}
