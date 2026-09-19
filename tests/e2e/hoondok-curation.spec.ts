import { expect, type Page, test } from "@playwright/test";

/**
 * E2E: 훈독 편성 admin 화면 (PLAN-HD-001 Phase 3 sub-PR B).
 *
 * 편성 → 노출 루프: admin 에서 오늘 편성의 제목을 바꾸면 web `/hoondok` 홈이 새 제목을 보여야 한다.
 * web 홈은 서버 컴포넌트가 매 요청 API 를 읽으므로(cache: no-store) 다음 로드에 바로 반영된다.
 *
 * 사전 조건은 admin-flow.spec.ts 와 같다(게이트 계정 E2E_ADMIN_EMAIL / test1234).
 * `make e2e` 의 seed_daily_readings.py 가 KST 오늘부터 20일분을 채우므로 오늘 행이 있어야 한다 — 없으면 실패한다.
 */

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";
const TEST_PASSWORD = "test1234";
// admin 프로젝트의 baseURL 은 admin origin 이다. web 홈 확인만 절대 URL 로 간다.
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN || "http://127.0.0.1:3000";

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").click();
  await page.locator("#email").pressSequentially(ADMIN_EMAIL, { delay: 10 });
  await page.locator("#password").click();
  await page.locator("#password").pressSequentially(TEST_PASSWORD, { delay: 10 });
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/chatbots", { timeout: 10_000 });
}

test.describe("훈독 편성", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("사이드바 → 오늘부터 15행 · 오늘 행에 시드 편성", async ({ page }) => {
    await page.getByRole("link", { name: "훈독 편성" }).click();
    await page.waitForURL("**/hoondok", { timeout: 5_000 });
    await expect(page.getByRole("heading", { name: "훈독 편성" })).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(15);
    const todayRow = page.locator('tr[data-today="true"]');
    await expect(todayRow).toHaveCount(1);
    await expect(todayRow.getByText("오늘")).toBeVisible();
    await expect(todayRow.getByRole("link", { name: "편집" })).toBeVisible();
    // 시드는 권리 확인 중(R)·미검수다.
    await expect(todayRow.getByText("권리 확인 중")).toBeVisible();
    await expect(todayRow.getByText("확인되지 않음")).toBeVisible();
  });

  test("오늘 편성 제목 수정 → web /hoondok 홈에 새 제목 → 원복", async ({ page }) => {
    await page.goto("/hoondok");
    const todayRow = page.locator('tr[data-today="true"]');
    await expect(todayRow.getByRole("link", { name: "편집" })).toBeVisible({ timeout: 5_000 });
    await todayRow.getByRole("link", { name: "편집" }).click();
    await page.waitForURL("**/hoondok/*/edit", { timeout: 5_000 });

    const editUrl = page.url();
    const title = page.locator("#title");
    await expect(title).toBeVisible();
    const original = await title.inputValue();
    expect(original.length).toBeGreaterThan(0);
    const next = `E2E 편성 ${Date.now()}`;

    await title.fill(next);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장되었습니다")).toBeVisible();
    // 헤더 h1 은 재조회 후 새 제목으로 바뀐다.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(next);

    // 편성 → 노출: web 홈(다른 origin, 공개 라우트)
    await page.goto(`${WEB_ORIGIN}/hoondok`);
    await expect(page.locator("article.malssum h2")).toHaveText(next);

    // 원복 — 다른 훈독 스펙은 제목을 단언하지 않지만 시드 상태를 남긴다.
    await page.goto(editUrl);
    await expect(title).toHaveValue(next);
    await title.fill(original);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(original);
    await page.reload();
    await expect(title).toHaveValue(original);
  });

  test("새 편성 ?date= 프리필 · 필수 미입력 저장은 인라인 오류로 멈춘다", async ({ page }) => {
    // 시드 범위(20일) 밖 날짜 — 실제로 저장하지 않으므로 DB 에 남지 않는다.
    const today = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
    );
    const [y, m, d] = today.split("-").map(Number);
    const farDate = new Date(Date.UTC(y, m - 1, d + 40)).toISOString().slice(0, 10);

    await page.goto(`/hoondok/new?date=${farDate}`);
    await expect(page.getByRole("heading", { name: "새 편성" })).toBeVisible();
    await expect(page.locator("#reading-date")).toHaveValue(farDate);

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/admin/hoondok/daily-readings"))
        requests.push(request.url());
    });
    await page.getByRole("button", { name: "등록" }).click();
    await expect(page.getByRole("alert").first()).toContainText("필수");
    await expect(page).toHaveURL(/\/hoondok\/new\?date=/);
    expect(requests).toEqual([]);
  });
});
