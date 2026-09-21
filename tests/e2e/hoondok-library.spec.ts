import { expect, test } from "@playwright/test";

const volume = "말씀선집 355권";
const wordsPath = `/hoondok/words/${encodeURIComponent(volume)}`;

for (const width of [375, 768, 1280]) {
  test(`말씀 실데이터 ${width}px: 서고 · 검색 · 원문 · 읽음`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/hoondok/library");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("link", { name: new RegExp(volume) }).first()).toBeVisible();
    await expect(page.getByText("미리보기 예시 데이터입니다")).toHaveCount(0);
    await page.goto("/hoondok/search");
    await page.getByRole("searchbox").fill("감사");
    await page.getByRole("button", { name: "찾기" }).click();
    await expect(page.locator("main")).toContainText("합성 문장");
    await page.goto(wordsPath);
    await expect(page.locator("main")).toContainText("1번째 합성 문장");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
      0,
    );
    await page.getByRole("button", { name: "읽음", exact: true }).click();
    await page.goto("/hoondok");
    await expect(page.locator(".mission").filter({ hasText: "말씀 읽기" })).toHaveAttribute("data-done", "");
  });
}

test("공개 API: 기본 거부 · 검색 전용 · 20청크 구간 · 출처 직접 이동", async ({ request }) => {
  const library = await request.get("/api/backend/hoondok/library");
  expect(library.status()).toBe(200);
  const { items } = await library.json();
  expect(items.map((item: { volume: string }) => item.volume)).toContain(volume);
  expect(items.map((item: { volume: string }) => item.volume)).not.toContain("미승인 말씀");
  expect(items.map((item: { volume: string }) => item.volume)).not.toContain("철회 말씀");
  for (const denied of ["미승인 말씀", "철회 말씀", "검색전용 말씀"]) {
    expect((await request.get(`/api/backend/hoondok/words/${encodeURIComponent(denied)}`)).status()).toBe(404);
  }
  const first = await request.get(`/api/backend${wordsPath}`);
  expect(first.status()).toBe(200);
  const firstPage = await first.json();
  expect(firstPage.page_size).toBe(20);
  expect(firstPage.chunks).toHaveLength(20);
  expect(firstPage.chunks.map((chunk: { chunk_index: number }) => chunk.chunk_index)).toEqual(
    Array.from({ length: 20 }, (_, index) => index),
  );
  const second = await request.get(`/api/backend${wordsPath}?page=2`);
  const secondPage = await second.json();
  expect(secondPage.chunks).toHaveLength(5);
  const direct = await request.get(`/api/backend${wordsPath}?chunk_id=${secondPage.chunks[0].chunk_id}`);
  expect((await direct.json()).page).toBe(2);
  const search = await request.get("/api/backend/hoondok/search?q=감사&limit=50");
  expect(search.status()).toBe(200);
  const { results } = await search.json();
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((result: { volume: string }) => !["미승인 말씀", "철회 말씀"].includes(result.volume))).toBe(
    true,
  );
  expect(results.find((result: { volume: string }) => result.volume === "검색전용 말씀")?.can_read_full_text).toBe(
    false,
  );
});

test("정성: 같은 날 유지 · 실제 완료 · 전날 이력 뒤 다른 말씀 · 홈/read 일치", async ({ page }) => {
  const headers = { "X-Requested-With": "XMLHttpRequest" };
  const signup = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `journey-${Date.now()}@example.com`, password: "password1", display_name: "여정" },
  });
  expect(signup.status()).toBe(201);
  const create = await page.request.post("/api/backend/hoondok/me/jeongseong", {
    headers,
    data: { topic: "감사", duration_days: 7 },
  });
  expect(create.status()).toBe(201);
  const first = await (await page.request.get("/api/backend/hoondok/me/jeongseong/today")).json();
  expect(first.status).toBe("available");
  expect(first.reading.body).toContain("합성 문장");
  await page.goto("/hoondok/read");
  await expect(page.locator("main")).toContainText(first.reading.body);
  expect((await page.request.post("/api/backend/hoondok/missions/read/complete", { headers })).status()).toBe(201);
  const again = await (await page.request.get("/api/backend/hoondok/me/jeongseong/today")).json();
  expect(again.reading.id).toBe(first.reading.id);
  const previousDay = await page.request.post("/api/backend/__e2e/jeongseong/previous-day", { headers });
  expect(previousDay.status()).toBe(200);
  const next = await (await page.request.get("/api/backend/hoondok/me/jeongseong/today")).json();
  expect(next.status).toBe("available");
  expect(next.reading.body).not.toBe(first.reading.body);
  await page.goto("/hoondok");
  await expect(page.locator("main")).toContainText(next.reading.title);
  await page.goto("/hoondok/read");
  await expect(page.locator("main")).toContainText(next.reading.body);
  await page.getByRole("button", { name: "훈독 완료", exact: true }).click();
  await expect(page.getByText("연속 2일째 이어가고 있어요")).toBeVisible();
  await page.goto("/hoondok");
  await expect(page.getByText("2 / 7일", { exact: true })).toBeVisible();
  const current = await (await page.request.get("/api/backend/hoondok/me/jeongseong")).json();
  expect(current.period.duration_days).toBe(7);
  expect(current.period.progress.done_days).toBe(2);
  expect(current.period.progress.missed_days).toBe(0);
  const summary = await (await page.request.get("/api/backend/hoondok/me/summary")).json();
  expect(summary.streak_days).toBe(2);
  expect(summary.today.read).toBe(true);
});

test("AI 질문의 실제 응답 근거에서 인용한 원문 구간으로 이동한다", async ({ page }) => {
  await page.goto("/hoondok/ask");
  await page.getByLabel("무엇이 궁금하세요?").fill("감사의 의미를 알려주세요");
  await page.getByRole("button", { name: "물어보기", exact: true }).click();
  await expect(page.locator("main p").filter({ hasText: "참사랑은 함께 실천하는 사랑입니다." })).toBeVisible();
  await page.getByRole("link", { name: "원문 보기", exact: true }).first().click();
  await expect(page).toHaveURL(/\/hoondok\/words\/.+\?chunk_id=/);
  await expect(page.getByText("인용한 말씀이 포함된 원문 구간이에요.")).toBeVisible();
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("1번째 합성 문장");
});

// 기기 기록은 본문·검색어를 남기지 않고 실제 원문 구간으로 복귀해야 한다.
test("원문 구간 목록과 기기 이어 읽기로 마지막 구간에 복귀한다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(wordsPath);
  await page
    .getByRole("complementary", { name: "원문 구간" })
    .getByRole("link", { name: "원문 구간 2", exact: true })
    .click();
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("21번째 합성 문장");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("hoondok:read:last")))
    .toBe(JSON.stringify({ volume, page: 2 }));
  await page.goto("/hoondok/library");
  await expect(page.getByRole("heading", { name: "이어 읽기", exact: true })).toBeVisible();
  await page.locator("a.resume").click();
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("21번째 합성 문장");
});
