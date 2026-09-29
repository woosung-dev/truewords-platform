import { expect, type Page, test } from "@playwright/test";

// 훈독 정성 기간 (PLAN-HD-002 W1-J · SCR-PWA-004 시트 + SCR-PWA-002 홈 카드).
// 시드 사용자는 이미 정성이 있을 수 있어(409) 매 실행 새 계정을 만든다.

// 비로그인 방문의 `GET /hoondok/auth/me` 401 은 계약이다(API-HD-003) — hoondok.spec.ts 와 같은 한 건만 제외한다.
const EXPECTED_401 = /status of 401/;
function isAnonymousAuthProbe(text: string, url: string) {
  return EXPECTED_401.test(text) && url.includes("/hoondok/auth/me");
}

async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isAnonymousAuthProbe(message.text(), message.location().url)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** 새 계정으로 가입해 홈으로 돌아온다 (hoondok.spec.ts 의 가입 흐름). */
async function signUp(page: Page, name: string) {
  await page.goto("/hoondok/onboarding");
  await page.getByLabel(/이름/).fill(name);
  await page.getByLabel(/이메일/).fill(`e2e-jeongseong-${Date.now()}@example.com`);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText(`${name}님`)).toBeVisible();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** KST 오늘 + days → `YYYY-MM-DD` (서버 today_kst 와 같은 기준) */
function kstIso(days = 0) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** `2026-09-05` → `9월 5일` */
function monthDay(iso: string) {
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

// 빠진 날을 셀 수 있는 표시 — 읽은 날 수·분수·퍼센트·D-day·고정 "새벽" (DEC-PWA-023)
const MISSED_DAY_HINTS = ["진행한 날", "/ 21일", "/21일", "%", "D-", "새벽", "밀린 날"];

test("정성 시트에서 21일 정성을 만들면 홈 카드가 1일차 · 20일 남았어요로 바뀐다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "정성");

  // 정성이 없으면 홈은 시트로 보내는 CTA 만 둔다
  await expect(page.getByRole("link", { name: "정성 시작하기" })).toBeVisible();
  await page.getByRole("link", { name: "정성 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok\?sheet=jeongseong$/);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "정성 기간 만들기" })).toBeVisible();
  // 가족 챌린지 토글은 W3 범위라 이 시트에 없다
  await expect(dialog.getByText(/가족 챌린지/)).toHaveCount(0);
  // 정성 알림은 훈독하기 알림에 합쳤다 — 시각 입력 대신 설정 › 훈독하기 링크만 있다
  await expect(dialog.locator('input[type="time"]')).toHaveCount(0);
  const notifyLink = dialog.getByRole("link", { name: "설정 › 훈독하기" });
  await expect(notifyLink).toHaveAttribute("href", "/hoondok/settings");
  // 본문 속 링크여도 터치 영역은 44px (시각 크기는 그대로, 음수 여백으로 넓힌다)
  expect((await notifyLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.locator(".js-opt").filter({ hasText: "세 주" }).click();
  await expect(page.locator(".js-opt[data-on]")).toContainText("21");
  await page.getByRole("button", { name: "감사" }).click();
  const created = page.waitForRequest(
    (request) => request.url().includes("/hoondok/me/jeongseong") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "정성 시작하기" }).click();
  // 알림 시각은 보내지 않는다 (훈독하기 알림 시각 한 곳)
  expect((await created).postDataJSON()).not.toHaveProperty("reminder_time");

  // 성공하면 URL 에서 sheet 가 빠지고 홈 카드가 진행 상태로 바뀐다 (오늘 시작 → 1일차 · 남은 20일)
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("21일 정성 · 감사")).toBeVisible();
  await expect(page.getByText("1일차", { exact: true })).toBeVisible();
  await expect(page.getByText("20일 남았어요")).toBeVisible();
  await expect(page.getByText(`${monthDay(kstIso())}에 시작했어요`)).toBeVisible();
  await expect(page.getByText(/매일 오전/)).toHaveCount(0);
  // 막대는 날짜 기준(일차 / 기간)이다
  const bar = page.getByRole("progressbar", { name: "21일 정성 중 1일차" });
  await expect(bar).toHaveAttribute("aria-valuenow", "1");
  await expect(bar).toHaveAttribute("aria-valuemax", "21");
  const homeCard = page.locator(".sect").filter({ has: page.getByRole("heading", { name: "정성 기간", exact: true }) });
  for (const hint of MISSED_DAY_HINTS) await expect(homeCard).not.toContainText(hint);

  // 사용자당 active 1건 (API-HD-009) — 같은 계정의 재요청은 409
  const again = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { topic: "감사", duration_days: 21 },
  });
  expect(again.status()).toBe(409);

  // ≥1024px 은 중앙 모달 520px (DES-PWA-003 §2.7)
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/hoondok?sheet=jeongseong");
  const panel = page.locator(".sheet__panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBeGreaterThan(500);
  expect(box?.width).toBeLessThan(540);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 닫기 = URL 에서 sheet 를 지우는 것 하나. Esc·백드롭도 <dialog> 의 close 이벤트로 같은 경로를 탄다.
  await page.getByRole("button", { name: "닫기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  expect(errors).toEqual([]);
});

test("정원 달력은 완료한 칸에만 원을 그리고, 정성 카드는 날짜 기준 · 시작 전은 막대 없이 보인다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "정원");
  const headers = { "X-Requested-With": "XMLHttpRequest" };

  // 새 계정은 이번 달에 완료한 날이 없다 — 지난날·오늘 모두 날짜만 보인다
  const created = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers,
    data: { topic: "감사", duration_days: 21, started_on: kstIso() },
  });
  expect(created.status()).toBe(201);
  await page.goto("/hoondok/garden");
  await expect(page.getByRole("heading", { name: "말씀과 함께한 시간" })).toBeVisible();

  const todayCell = page.locator(".gd-cal__day[data-today]");
  await expect(todayCell).toHaveAttribute("aria-label", `${monthDay(kstIso())} 오늘`);
  await expect(page.locator(".gd-cal__day:not([data-done]) .gd-cal__dot")).toHaveCount(0);
  await expect(page.locator('.gd-cal__day[aria-label*="아직"]')).toHaveCount(0);
  // 완료하지 않은 지난날(어제)은 "9월 N일" 만 읽는다. 오늘이 1일이면 어제는 지난달이라 건너뛴다
  if (Number(kstIso().slice(8, 10)) > 1) {
    await expect(page.locator(`.gd-cal__day[aria-label="${monthDay(kstIso(-1))}"]`)).toHaveCount(1);
  }
  const legend = page.locator(".gd-cal__legend > span");
  await expect(legend).toHaveCount(1);
  await expect(legend).toHaveText("완료");

  // 정원 정성 카드 = 홈과 같은 날짜 기준 표시
  const gardenCard = page
    .locator(".sect")
    .filter({ has: page.getByRole("heading", { name: "진행 중인 정성", exact: true }) });
  await expect(gardenCard.getByText("1일차", { exact: true })).toBeVisible();
  await expect(gardenCard.getByText("20일 남았어요")).toBeVisible();
  await expect(gardenCard.getByRole("progressbar", { name: "21일 정성 중 1일차" })).toHaveAttribute(
    "aria-valuenow",
    "1",
  );
  for (const hint of MISSED_DAY_HINTS) await expect(gardenCard).not.toContainText(hint);

  // 그만두고 3일 뒤 시작으로 다시 만들면 시작 전 — 막대 없이 시작일만
  expect((await page.request.delete("/api/backend/hoondok/me/jeongseong", { headers })).status()).toBe(204);
  const upcoming = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers,
    data: { topic: "감사", duration_days: 21, started_on: kstIso(3) },
  });
  expect(upcoming.status()).toBe(201);
  const upcomingLabel = `시작 전 · ${monthDay(kstIso(3))}부터`;

  await page.goto("/hoondok/garden");
  await expect(gardenCard.getByText(upcomingLabel)).toBeVisible();
  await expect(gardenCard.getByRole("progressbar")).toHaveCount(0);

  await page.goto("/hoondok");
  const homeCard = page.locator(".sect").filter({ has: page.getByRole("heading", { name: "정성 기간", exact: true }) });
  await expect(homeCard.getByText(upcomingLabel)).toBeVisible();
  await expect(homeCard.getByRole("progressbar")).toHaveCount(0);
  await expect(homeCard).not.toContainText("남았어요");

  for (const path of ["/hoondok", "/hoondok/garden"]) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await expect(page.getByText(upcomingLabel)).toBeVisible();
      expect(await horizontalOverflow(page), `${path} ${width}px 가로 넘침`).toBeLessThanOrEqual(0);
    }
  }

  expect(errors).toEqual([]);
});
