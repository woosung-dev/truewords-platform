import { expect, type Page, test } from "@playwright/test";

/**
 * E2E: 훈독 권리 원장 admin 화면 (PLAN-HD-007 트랙 C).
 *
 * `make e2e` 의 seed_hoondok_journey.py 가 넣는 권리 행에 `book_series` 가 있으면 시리즈 요약이 차고,
 * 없으면 요약은 비어 빈 상태 문구가 뜬다 — 두 경우 모두 통과하도록 분기한다(시드는 이 트랙이 건드리지 않는다).
 *
 * 사전 조건은 admin-flow.spec.ts 와 같다(게이트 계정 E2E_ADMIN_EMAIL / test1234).
 * 일괄 변경은 되돌리기 어려우므로 다이얼로그를 열고 취소까지만 확인한다.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";
const TEST_PASSWORD = "test1234";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").click();
  await page.locator("#email").pressSequentially(ADMIN_EMAIL, { delay: 10 });
  await page.locator("#password").click();
  await page.locator("#password").pressSequentially(TEST_PASSWORD, { delay: 10 });
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/chatbots", { timeout: 10_000 });
}

test.describe("훈독 권리 원장", () => {
  test("시리즈 요약 → 일괄 변경 다이얼로그 열고 취소", async ({ page }) => {
    await login(page);
    await page.goto("/hoondok/rights");
    await expect(page.getByRole("heading", { name: "훈독 권리 원장" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "저작물별 현황" })).toBeVisible();

    const bulkButtons = page.getByRole("button", { name: /일괄 변경$/ });
    await expect
      .poll(
        async () => (await bulkButtons.count()) > 0 || (await page.getByText(/권리 원장이 비어 있어요/).count()) > 0,
      )
      .toBe(true);

    if ((await bulkButtons.count()) === 0) {
      // 시드에 book_series 가 없는 경우 — 빈 상태 안내까지가 이 화면의 계약이다.
      await expect(page.getByText(/seed_content_rights_from_qdrant\.py/)).toBeVisible();
      return;
    }

    await bulkButtons.first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/권이 전부 바뀝니다/)).toBeVisible();
    await expect(dialog.getByLabel("승인 상태")).toHaveValue("allowed");
    await expect(dialog.getByLabel("공식성 등급")).toHaveValue("keep");
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect(dialog).toBeHidden();
  });
});
