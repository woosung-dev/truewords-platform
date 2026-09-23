import { expect, test } from "@playwright/test";

const volume = "말씀선집 355권";
const wordsPath = `/hoondok/words/${encodeURIComponent(volume)}`;
// 시드가 두 권을 `father_anthology` 로 묶는다 (apps/api/scripts/seed_hoondok_journey.py)
const workTitle = "문선명선생 말씀선집";
const seriesPath = "/hoondok/library/father_anthology";
const headers = { "X-Requested-With": "XMLHttpRequest" };

async function signUp(page: import("@playwright/test").Page, prefix: string) {
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `${prefix}-${Date.now()}@example.com`, password: "password1", display_name: "서고" },
  });
  expect(response.status()).toBe(201);
}

for (const width of [375, 768, 1280]) {
  test(`말씀 실데이터 ${width}px: 서고 · 검색 · 원문 · 읽음`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/hoondok/library");
    expect(response?.status()).toBe(200);
    // 저작물 → 권 → 원문 3계층 (PLAN-HD-007)
    await page.getByRole("link", { name: new RegExp(workTitle) }).click();
    await expect(page).toHaveURL(new RegExp(`${seriesPath}$`));
    await expect(page.getByRole("link", { name: /001권/ })).toBeVisible();
    await page.getByRole("link", { name: /355권/ }).click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(volume)));
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
  const { items, works } = await library.json();
  // API-HD-014 확장 · 023 · 024 — 저작물 집계, 시리즈 404, 장 목차
  expect(works.find((work: { series: string }) => work.series === "father_anthology")).toMatchObject({
    allowed_count: 2,
    volume_count: 2,
  });
  const series = await request.get("/api/backend/hoondok/library/father_anthology");
  expect(series.status()).toBe(200);
  expect((await series.json()).volumes.map((item: { label: string }) => item.label)).toEqual(["001권", "355권"]);
  expect((await request.get("/api/backend/hoondok/library/없는시리즈")).status()).toBe(404);
  const sections = await request.get(`/api/backend/hoondok/sections/${encodeURIComponent(volume)}`);
  expect(sections.status()).toBe(200);
  expect((await sections.json()).sections).toHaveLength(3);
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
test("장 목차로 이동하고 기기 이어 읽기로 마지막 구간에 복귀한다", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(wordsPath);
  const toc = page.getByRole("complementary", { name: "목차" });
  await expect(toc.getByRole("link", { name: "제1편 감사의 길" })).toBeVisible();
  await expect(toc.getByRole("link", { name: "1장 이웃을 듣는 마음" })).toHaveAttribute("aria-current", "page");
  await toc.getByRole("link", { name: "제2편 참사랑의 실천" }).click();
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

// 기록(형광펜·북마크·이어 읽기)은 로그인 계정에 남고 새로고침·다른 화면에서도 같은 값을 본다.
test("단락 형광펜은 새로고침 뒤에도 남고 북마크는 서고에 모인다", async ({ page }) => {
  await signUp(page, "library");
  await page.goto(wordsPath);
  await page.getByRole("button", { name: "단락 1 표시하기" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "연두 형광펜" }).click();
  await expect(sheet.getByRole("button", { name: "연두 형광펜" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "닫기" }).click();
  await page.reload();
  await expect(page.locator("mark.hl-2")).toContainText("1번째 합성 문장");

  await page.getByRole("button", { name: "단락 2 표시하기" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "북마크", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "북마크 해제" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();

  await page.goto("/hoondok/library");
  await expect(page.getByRole("heading", { name: "북마크", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /단락 2$/ })).toBeVisible();
  // 이어 읽기는 서버 값으로 바뀐다 — 원문을 연 페이지의 첫 단락이 기준이다
  await expect(page.getByText("단락 1까지 읽었어요")).toBeVisible();
});
