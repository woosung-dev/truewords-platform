import { expect, type Page, test } from "@playwright/test";

// SCR-PWA-015 알림·설치 설정 (PLAN-HD-002 W1-S). 계정을 지우는 흐름이라 **매번 새 계정**을 만든다 —
// 시드 사용자(hoondok@example.com)는 다른 spec 이 계속 쓰므로 절대 삭제하지 않는다.
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;
const PASSWORD = "password1";
const XHR = { "X-Requested-With": "XMLHttpRequest" } as const;

// 비로그인 방문의 `GET /hoondok/auth/me` 401 은 계약이다(API-HD-003) — 브라우저가 리소스 오류로 찍는다.
// 이 한 건만 제외하고 나머지는 0 을 단언한다 (hoondok.spec.ts 와 같은 필터).
function isAnonymousAuthProbe(text: string, url: string) {
  return /status of 401/.test(text) && url.includes("/hoondok/auth/me");
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isAnonymousAuthProbe(message.text(), message.location().url)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function signUp(page: Page, email: string) {
  await page.goto("/hoondok/onboarding");
  await page.getByLabel(/이름/).fill("설정");
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/비밀번호/).fill(PASSWORD);
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("설정님")).toBeVisible();
}

test("설정: 알림 준비 중 · 설치 안내 상시 · 내 데이터 삭제 2단계 뒤 계정이 사라진다", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const email = `e2e-settings-${Date.now()}@example.com`;
  await signUp(page, email);

  await page.goto("/hoondok/settings");
  await expect(page.getByRole("heading", { name: "알림", exact: true })).toBeVisible();

  // 알림 4종 · 시간 · 잠금 화면 문구는 Phase 4 전까지 전부 비활성이다
  for (const label of ["훈독하기 알림", "기도하기 알림", "가정예배 알림", "공지 알림"]) {
    const toggle = page.getByRole("button", { name: label });
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  }
  // 탭 내비의 "말씀 검색 (준비 중)" 은 프리뷰 플래그에 따라 달라지므로 본문(main) 안만 센다
  await expect(page.locator("main").getByText("준비 중")).toHaveCount(6);
  await expect(page.getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("radio").first()).toBeDisabled();

  // 설치 안내는 완료 기록(자격) 없이도 설정에 늘 있다. 헤드리스라 prompt 미캡처 → 일반 안내(manual)
  expect(await page.evaluate(() => localStorage.getItem("hoondok:install:eligible"))).toBeNull();
  await expect(page.getByRole("heading", { name: /홈 화면에 추가하면/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "나중에" })).toHaveCount(0);

  // 390 · 1280 두 폭에서 가로 넘침 0
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, viewport.name).toBeLessThanOrEqual(0);
  }

  // 1단계 행 → 2단계 확인 → 지우기
  await page.getByRole("button", { name: /내 데이터 삭제/ }).click();
  const confirm = page.getByRole("group", { name: "내 데이터 삭제 확인" });
  await expect(confirm).toContainText("되돌릴 수 없어요");
  await confirm.getByRole("button", { name: "지우기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);

  // 쿠키가 지워졌고(요약 401), 같은 자격으로는 다시 로그인되지 않는다(계정 익명화, API-HD-011)
  expect((await page.request.get("/api/backend/hoondok/me/summary")).status()).toBe(401);
  const login = await page.request.post("/api/backend/hoondok/auth/login", {
    headers: XHR,
    data: { email, password: PASSWORD },
  });
  expect(login.status()).toBe(401);

  expect(errors).toEqual([]);
});
