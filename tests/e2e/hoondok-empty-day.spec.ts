import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 편성 없는 날(C3 안 A). 시드는 KST 오늘부터 20일분이라 오늘 편성을 관리자 API(API-HD-007)로 60일 뒤로 옮겨
// 진짜 빈 날(행 없음)을 만들고, 끝나면 반드시 되돌린다. workers=1 이라 다른 스펙과 겹치지 않는다.
// 합성 코퍼스 "말씀선집 355권"(seed_hoondok_journey.py)으로 이어 읽기 기록을 만든다.
const adminOrigin = process.env.E2E_ADMIN_ORIGIN || "http://localhost:3001";
const adminEmail = process.env.E2E_ADMIN_EMAIL || "demo-admin@example.com";
const csrf = { "X-Requested-With": "XMLHttpRequest" };
const volume = "말씀선집 355권";
const wordsPath = `/hoondok/words/${encodeURIComponent(volume)}`;

function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

let admin: APIRequestContext;
let moved: { id: string; date: string } | null = null;

async function moveReading(id: string, readingDate: string) {
  const response = await admin.put(`/api/backend/admin/hoondok/daily-readings/${id}`, {
    headers: csrf,
    data: { reading_date: readingDate },
  });
  expect(response.status()).toBe(200);
}

function missionOrder(page: Page) {
  return page
    .locator(".missions > *")
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        node.classList.contains("day-quiet") ? "안내" : (node.querySelector(".mission__kind")?.textContent ?? ""),
      ),
    );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }) => {
  admin = await playwright.request.newContext({ baseURL: adminOrigin });
  const login = await admin.post("/api/backend/admin/auth/login", {
    headers: csrf,
    data: { email: adminEmail, password: "test1234" },
  });
  expect(login.status()).toBe(200);
  const today = kstToday();
  const list = await admin.get(`/api/backend/admin/hoondok/daily-readings?from=${today}&to=${today}`);
  const rows = (await list.json()) as { id: string; reading_date: string }[];
  expect(rows).toHaveLength(1); // 시드 전제 — 오늘 편성이 있어야 비울 수 있다
  moved = { id: rows[0].id, date: today };
  await moveReading(moved.id, addDaysIso(today, 60));
});

test.afterAll(async () => {
  if (moved) await moveReading(moved.id, moved.date);
  await admin?.dispose();
});

test("기록 없음: 홈은 오늘 상태 한 줄 → 서고 카드, 함께 읽기 숫자 없음 · 훈독하기는 서고가 주 버튼", async ({
  page,
}) => {
  await page.goto("/hoondok");
  const line = page.locator(".day-quiet");
  await expect(line).toContainText("오늘은 정해진 말씀이 없어요");
  await expect(line).toContainText("서고에서 한 권 골라 읽어 보세요.");
  await expect.poll(() => missionOrder(page)).toEqual(["안내", "말씀 읽기 · 이어 읽기", "기도하기 · 1분 · 준비 중"]);
  // 서고로 가는 길은 첫 카드 하나 — 떠 있던 "오늘 말씀 대신 서고에서 읽기" 버튼이 없다
  await expect(page.locator('.missions a[href="/hoondok/library"]')).toHaveCount(1);
  await expect(page.getByText(/기다리고 있어요|편성되면|오늘 말씀 대신/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "함께 읽는 사람들" })).toHaveCount(0);

  await page.goto("/hoondok/read");
  await expect(page.locator(".empty__title")).toHaveText("오늘은 정해진 말씀이 없어요");
  const primary = page.getByRole("link", { name: "말씀 서고에서 고르기" });
  await expect(primary).toHaveAttribute("href", "/hoondok/library");
  await expect(page.locator(".scripture")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "훈독 완료" })).toHaveCount(0);
});

test("이 기기에서 읽던 곳이 있으면 홈·훈독하기 모두 이어 읽기가 첫 행동이다", async ({ page }) => {
  await page.goto(wordsPath);
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("1번째 합성 문장");

  await page.goto("/hoondok");
  await expect(page.locator(".day-quiet")).toContainText("읽던 말씀을 이어서 읽어 보세요.");
  const first = page.locator(".missions > .mission").first();
  await expect(first.locator(".mission__meta")).toHaveText("1단락부터 이어 읽어요 · 이 기기에서 읽던 곳");

  await page.goto("/hoondok/read");
  const resume = page.locator(".day-go .card.resume");
  await expect(resume).toContainText("1단락부터 이어 읽어요");
  await expect(page.getByRole("link", { name: "말씀 서고로 가기" })).toBeVisible();
  await resume.click();
  await expect(page).toHaveURL(/\/hoondok\/words\/.+\?page=1&from=resume$/);
  await expect(page.getByRole("status").filter({ hasText: "여기서부터 이어 읽어요" })).toBeVisible();
});
