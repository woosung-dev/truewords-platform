import { expect, type Page, test } from "@playwright/test";

const webOrigin = process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000";
const adminOrigin = process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001";
const apiOrigin = process.env.E2E_API_ORIGIN || "http://127.0.0.1:8000";

test("web·admin·API 응답에 보안 헤더가 있다", async ({ request }) => {
  for (const url of [`${webOrigin}/login`, `${webOrigin}/hoondok`, `${adminOrigin}/login`]) {
    const headers = (await request.get(url)).headers();
    expect(headers["content-security-policy"], url).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], url).toContain("object-src 'none'");
    expect(headers["x-frame-options"], url).toBe("DENY");
    expect(headers["x-content-type-options"], url).toBe("nosniff");
  }
  const api = (await request.get(`${apiOrigin}/health`)).headers();
  expect(api["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(api["x-content-type-options"]).toBe("nosniff");
});

// 비로그인 방문의 auth/me 401 은 계약이다 — 그 한 건만 제외하고 콘솔 오류·미처리 예외·CSP 위반을 모은다.
async function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/status of 401/.test(message.text()) && /\/auth\/me/.test(message.location().url)) return;
    problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return problems;
}

test("주요 진입 화면이 CSP 위반·콘솔 오류 없이 그려진다", async ({ page }) => {
  const problems = await collectProblems(page);
  await page.goto(`${webOrigin}/login`);
  await expect(page.getByRole("heading", { name: "TrueWords 로그인" })).toBeVisible();
  await page.goto(`${webOrigin}/hoondok`);
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await page.goto(`${adminOrigin}/login`);
  await expect(page.getByRole("heading", { name: "관리자 로그인" })).toBeVisible();
  expect(problems).toEqual([]);
});
