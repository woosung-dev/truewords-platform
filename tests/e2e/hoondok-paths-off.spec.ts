import { expect, test } from "./hoondok-test";

// 7일 정성 플래그 OFF 회귀 — 홈 시작 카드가 없고 /path* 는 404 다.
// NEXT_PUBLIC_HOONDOK_PATHS 는 빌드 시 고정이고 Next 개발 서버는 한 앱 폴더에 하나만 뜨므로, 기본 하네스(플래그 ON)로는
// 이 스펙을 돌릴 수 없다. 플래그 없이 띄운 웹(예: `next build && next start --port 3002`)의 주소를
// E2E_WEB_PATHS_OFF_ORIGIN 으로 줄 때만 돈다. API 는 같은 서버(HOONDOK_PATHS_ENABLED=true)를 그대로 쓴다.
const offOrigin = process.env.E2E_WEB_PATHS_OFF_ORIGIN;
test.skip(!offOrigin, "E2E_WEB_PATHS_OFF_ORIGIN(NEXT_PUBLIC_HOONDOK_PATHS 없이 띄운 웹)이 없어 건너뜀");

test("플래그 OFF — 로그인한 홈에 정성 시작 카드가 없고 /path* 는 404", async ({ page }) => {
  const email = `e2e-paths-off-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/onboarding");
  await page.getByLabel(/이름/).fill("정성끔");
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await page.getByRole("link", { name: "질문 없이 시작하기" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);

  // 홈은 그대로 뜨고(오늘의 실천) 정성 카드·정성 홈은 없다
  await expect(page.getByRole("heading", { name: "오늘의 실천" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "7일 정성으로 말씀을 읽어 보세요" })).toHaveCount(0);
  // "정성 시작하기" 이름은 정성 기간 카드(/?sheet=jeongseong)도 쓰므로 /path 로 가는 링크만 본다
  await expect(page.locator('a[href^="/path"]')).toHaveCount(0);
  await expect(page.locator(".path-home")).toHaveCount(0);

  for (const route of ["/path", "/path/read/1", "/path/done"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(404);
  }
});
