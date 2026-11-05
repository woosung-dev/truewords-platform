import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 훈독 7일 정성 (읽기 정성 1a). 시드: `scripts.seed_reading_paths --publish --e2e`(cs7·ph7·cs21) + API HOONDOK_PATHS_ENABLED=true,
// 웹 NEXT_PUBLIC_HOONDOK_PATHS=1 (playwright.config). 시계는 바꾸지 않는다 — 운영 코드에 시계 오버라이드가 없으므로
// "며칠 지난 상태"는 DB fixture 가 그 계정의 started_on·completed_on 을 과거로 옮겨 만든다(격리 truewords_e2e 에서만).
// 플래그 OFF 회귀(홈 카드 없음·/path* 404)는 한 빌드로 두 값을 띄울 수 없는 하네스라 Vitest(hoondok-path.test.tsx)가 맡는다.

const API_DIR = path.resolve(__dirname, "../../apps/api");

// 계정 하나의 7일 정성 날짜를 days 만큼 과거로 옮긴다. 하루 한 장 unique(run_id, completed_on)를 지키려고 먼 과거로 한 번
// 보냈다가 되돌린다(한 번에 옮기면 행 순서에 따라 잠깐 겹칠 수 있다).
const SHIFT_PY = `
import asyncio, os, sys
from urllib.parse import urlparse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

url = os.environ["DATABASE_URL"]
if urlparse(url).path != "/truewords_e2e":
    raise SystemExit("e2e fixture 는 truewords_e2e 에서만 돈다")
email, days = sys.argv[1].lower(), int(sys.argv[2])

async def main():
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        runs = "SELECT r.id FROM path_runs r JOIN users u ON u.id = r.user_id WHERE u.email = :email"
        await conn.execute(text(f"UPDATE path_runs SET started_on = started_on - CAST(:d AS integer) WHERE id IN ({runs})"), {"email": email, "d": days})
        await conn.execute(text(f"UPDATE path_step_completions SET completed_on = completed_on - 1000 WHERE run_id IN ({runs})"), {"email": email})
        await conn.execute(text(f"UPDATE path_step_completions SET completed_on = completed_on + CAST(:d AS integer) WHERE run_id IN ({runs})"), {"email": email, "d": 1000 - days})
    await engine.dispose()

asyncio.run(main())
`;

function shiftPathDays(email: string, days: number) {
  execFileSync("uv", ["run", "--frozen", "python", "-c", SHIFT_PY, email, String(days)], {
    cwd: API_DIR,
    stdio: "pipe",
    env: process.env,
  });
}

const EXPECTED_401 = /status of 401/;
async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (EXPECTED_401.test(message.text()) && message.location().url.includes("/hoondok/auth/me")) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function signUp(page: Page, name: string): Promise<string> {
  const email = `e2e-paths-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/onboarding");
  await page.getByLabel(/이름/).fill(name);
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await page.getByRole("link", { name: "질문 없이 시작하기" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  return email;
}

/** 홈 시작 카드 → 질문 2개 → 첫 정성(cs7) 시작. 탭 4번이면 정성 홈이다. */
async function startPath(page: Page) {
  await page.getByRole("link", { name: "정성 시작하기" }).click();
  await expect(page).toHaveURL(/\/path$/);
  await expect(page.getByRole("heading", { name: "하루에 얼마나 읽을까요?" })).toBeVisible();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("heading", { name: "언제 읽으시겠어요?" })).toBeVisible();
  await page.getByRole("radio", { name: /새벽 기도 뒤/ }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await expect(page.getByRole("radio", { name: /천성경 7일 정성/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "이 정성 시작" }).click();
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  await expect(page.getByRole("heading", { name: "천성경 7일 정성" })).toBeVisible();
}

const FORBIDDEN = ["일째", "연속", "놓쳤", "실패", "늦었", "D-", "%"];

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("시작 → 숨 고르기 → 본문 → 다 읽었어요 → 마침 → 홈은 오늘 읽음", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "정성길");

  await expect(page.getByRole("heading", { name: "7일 정성으로 말씀을 읽어 보세요" })).toBeVisible();
  await startPath(page);

  const home = page.locator(".path-home");
  await expect(home.getByText("읽은 장 0/7")).toBeVisible();
  await expect(home.getByText(/^새벽 기도 뒤 · 약 \d+분$/)).toBeVisible();
  // 오늘 읽을 것은 정성 장 하나 — 히어로 훈독하기는 없고 오늘의 말씀은 접혀 있다
  await expect(page.locator(".shot").getByRole("link", { name: /훈독하기/ })).toHaveCount(0);
  const fold = page.locator("details.path-fold");
  await expect(fold).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "오늘의 실천" })).toBeHidden();
  await fold.locator("summary").click();
  await expect(page.getByRole("heading", { name: "오늘의 실천" })).toBeVisible();
  expect(await home.textContent()).not.toMatch(new RegExp(FORBIDDEN.map((w) => w.replace(/[-%]/g, "\\$&")).join("|")));
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 5번째 탭: 읽기 시작 → 숨 고르기(3초 자동)
  await home.getByRole("link", { name: "읽기 시작" }).click();
  await expect(page).toHaveURL(/\/path\/read\/1$/);
  await expect(page.getByRole("heading", { name: "숨을 한 번 고르고 시작해요" })).toBeVisible();
  await expect(page.locator(".verse").first()).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(".owl")).toHaveCount(0);

  const completed = page.waitForResponse(
    (r) => r.url().includes("/path-runs/current/steps/1/complete") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "다 읽었어요" }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "오늘 말씀을 읽었어요" })).toBeVisible();
  await expect(page.getByText(/읽은 장 1\/7/)).toBeVisible();
  await page.getByRole("link", { name: "오늘 훈독으로" }).click();

  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  await expect(home.getByRole("status")).toHaveText(/오늘 말씀을 읽었어요/);
  await expect(home.getByText("읽은 장 1/7")).toBeVisible();
  await expect(home.getByRole("link", { name: "읽기 시작" })).toHaveCount(0);
  // 이번 주 읽은 날 — 오늘 칸이 읽음
  await expect(page.locator('.path-home .week__day[aria-current="date"]')).toHaveAttribute("data-done", "");

  // 같은 날 두 번째 장은 서버가 막는다(하루 한 장)
  const second = await page.request.post("/api/backend/hoondok/me/path-runs/current/steps/2/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { mode: "full" },
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).error_code).toBe("ALREADY_READ_TODAY");

  expect(errors).toEqual([]);
});

test("사흘 쉬고 돌아온 날 시트 → 평소대로 읽기, 나중에는 같은 날 다시 뜨지 않는다", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await signUp(page, "돌아옴");
  await startPath(page);
  const headers = { "X-Requested-With": "XMLHttpRequest" };
  expect(
    (
      await page.request.post("/api/backend/hoondok/me/path-runs/current/steps/1/complete", { headers, data: {} })
    ).status(),
  ).toBe(200);

  shiftPathDays(email, 4);
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "쉬었다 오셔도 괜찮아요" });
  await expect(dialog).toBeVisible();
  expect(await dialog.textContent()).not.toMatch(/\d+일|일째|놓쳤/);
  await expect(dialog.locator(".owl")).toHaveCount(0);
  await dialog.getByRole("button", { name: "나중에" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.locator(".path-home")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 내일이 되면(다시 하루 옮김) 다시 뜬다 → 평소대로 읽기는 다음 장으로 간다
  shiftPathDays(email, 1);
  await page.goto("/");
  await page.getByRole("dialog").getByRole("link", { name: "평소대로 읽기" }).click();
  await expect(page).toHaveURL(/\/path\/read\/2$/);
});

test("7장을 모두 읽으면 마침표 → 오늘 훈독으로 하면 다시 시작 카드", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const email = await signUp(page, "마침표");
  await startPath(page);
  const headers = { "X-Requested-With": "XMLHttpRequest" };
  for (let day = 1; day <= 7; day += 1) {
    const response = await page.request.post(`/api/backend/hoondok/me/path-runs/current/steps/${day}/complete`, {
      headers,
      data: {},
    });
    expect(response.status(), `${day}장 완료`).toBe(200);
    if (day < 7) shiftPathDays(email, 1);
  }

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "천성경 7일 정성을 마쳤어요" })).toBeVisible();
  await page.getByRole("link", { name: "마침 화면 보기" }).click();
  await expect(page).toHaveURL(/\/path\/done$/);
  const done = page.locator(".path-done");
  await expect(done.getByRole("heading", { name: "천성경 7일 정성을 마쳤어요" })).toBeVisible();
  await expect(done.getByText("읽은 날 7일 · 읽은 장 7장")).toBeVisible();
  await expect(done.getByText("이번 정성에서 고른 구절은 없어요.")).toBeVisible();
  expect(await done.textContent()).not.toMatch(/%|배지|완벽|축하/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  const finished = page.waitForResponse((r) => r.url().includes("/path-runs/current/finish"));
  await done.getByRole("button", { name: "오늘 훈독으로" }).click();
  expect((await finished).request().postDataJSON()).toEqual({ action: "rest" });
  await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);
  await expect(page.getByRole("heading", { name: "7일 정성으로 말씀을 읽어 보세요" })).toBeVisible();
});

test("정성 기간이 진행 중이면 이미 드리는 정성 화면 → 마치고 새로 시작하면 질문 1", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "정성중");
  const headers = { "X-Requested-With": "XMLHttpRequest" };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const created = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers,
    data: { topic: "감사", duration_days: 21, started_on: today },
  });
  expect(created.status()).toBe(201);
  // 진행 중 정성 기간이 있으면 서버도 7일 정성 시작을 막는다
  const blocked = await page.request.post("/api/backend/hoondok/me/path-runs", {
    headers,
    data: { slug: "cs7", minutes_tier: 7 },
  });
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error_code).toBe("JEONGSEONG_ACTIVE");

  await page.goto("/path");
  await expect(page.getByRole("heading", { name: "이미 드리고 있는 정성이 있어요" })).toBeVisible();
  await expect(page.getByText("21일 정성 · 감사")).toBeVisible();
  expect(await page.locator("section.path-flow").textContent()).not.toMatch(/일째|일 동안/);
  await page.getByRole("button", { name: "지금 정성을 마치고 새로 시작" }).click();
  const sheet = page.getByRole("dialog", { name: "지금 정성을 마칠까요?" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "마치고 새로 시작" }).click();
  await expect(page.getByRole("heading", { name: "하루에 얼마나 읽을까요?" })).toBeVisible();
});

test("비로그인으로 /path 를 열면 질문 전에 로그인 안내", async ({ page }) => {
  await page.goto("/path");
  await expect(page.getByRole("heading", { name: "정성을 시작하려면 로그인해 주세요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인하고 시작하기" })).toHaveAttribute(
    "href",
    "/onboarding?returnTo=%2Fpath",
  );
});
