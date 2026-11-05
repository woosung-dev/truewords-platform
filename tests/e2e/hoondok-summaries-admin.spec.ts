import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").click();
  await page.locator("#email").pressSequentially(ADMIN_EMAIL, { delay: 10 });
  await page.locator("#password").click();
  await page.locator("#password").pressSequentially("test1234", { delay: 10 });
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/chatbots", { timeout: 10_000 });
}

test("발행 관리: 트리에서 절을 골라 초안 → 검수 중 → 공개 → 내림", async ({ page }) => {
  await login(page);
  await page.goto("/hoondok/summaries");
  await expect(page.getByRole("heading", { name: "천성경 AI 요약 발행 관리" })).toBeVisible();

  // 시드한 절 중 3절(말씀이신 하나님)은 초안이다. 콘텐츠 없는 절은 링크가 아니라 버튼이다.
  await page.getByRole("link", { name: /3절 말씀이신 하나님/ }).click();
  await page.waitForURL("**/hoondok/summaries/*/edit");

  const settings = page.getByRole("complementary", { name: "게시글 설정" });
  const badge = (name: string) => settings.getByText(name, { exact: true }).first();
  const done = (message: string) => expect(page.getByText(message)).toBeVisible();
  await expect(badge("초안")).toBeVisible();

  await settings.getByRole("button", { name: "검수 요청" }).click();
  await done("검수를 요청했습니다.");
  await expect(badge("검수 중")).toBeVisible();

  await settings.getByRole("button", { name: "공개하기", exact: true }).click();
  await done("요약을 공개했습니다.");
  await expect(badge("공개")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await settings.getByRole("button", { name: "내리기" }).click();
  await done("요약을 내렸습니다.");
  await expect(badge("내림")).toBeVisible();
  await expect(settings.getByRole("button", { name: "내리기" })).toBeDisabled();

  // 목록 트리에도 내림으로 반영된다
  await page.goto("/hoondok/summaries");
  await expect(page.getByRole("link", { name: /3절 말씀이신 하나님/ })).toContainText("내림");
});
