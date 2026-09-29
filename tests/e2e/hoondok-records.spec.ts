import { expect, type Page, test } from "@playwright/test";

// C1 나의 기록 · 이 기기에만 있는 기록. 시드(apps/api/scripts/seed_hoondok_journey.py)의 합성 권
// `말씀선집 355권`(청크 25개, 목차: 1장 0~19 · 제2편 20~24)에 구절 형광펜(API-HD-053)·북마크(API-HD-026)를 남기고
// 정원 → 나의 기록 → 원문을 오간다.
const volume = "말씀선집 355권";
const headers = { "X-Requested-With": "XMLHttpRequest" };

type Chunk = { chunk_id: string; chunk_index: number; display_text: string };

async function signUp(page: Page, prefix: string) {
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `${prefix}-${Date.now()}@example.com`, password: "password1", display_name: "기록" },
  });
  expect(response.status()).toBe(201);
}

/** 원문 두 페이지의 청크(0~24). chunk_id 는 시드가 정하므로 API 로 읽는다. */
async function chunks(page: Page): Promise<Chunk[]> {
  const found: Chunk[] = [];
  for (const pageNo of [1, 2]) {
    const response = await page.request.get(`/api/backend/hoondok/words/${encodeURIComponent(volume)}?page=${pageNo}`);
    expect(response.status()).toBe(200);
    found.push(...((await response.json()).chunks as Chunk[]));
  }
  return found;
}

async function putBookmark(page: Page, chunk: Chunk) {
  const response = await page.request.put(`/api/backend/hoondok/me/marks/${chunk.chunk_id}`, {
    headers,
    data: { volume, chunk_index: chunk.chunk_index, kind: "bookmark", color: null, note: null },
  });
  expect(response.status()).toBe(200);
}

/** 그 단락의 "N번째 합성 문장입니다." 구절을 칠한다 — 원문 뷰가 글자를 골라 보내는 것과 같은 요청이다. */
async function postHighlight(page: Page, chunk: Chunk, body: { color: number; note?: string }) {
  const quote = `${chunk.chunk_index + 1}번째 합성 문장입니다.`;
  const start = chunk.display_text.indexOf(quote);
  expect(start).toBeGreaterThanOrEqual(0);
  const response = await page.request.post("/api/backend/hoondok/me/highlights", {
    headers,
    data: {
      volume,
      chunk_id: chunk.chunk_id,
      start_chunk_index: chunk.chunk_index,
      start_offset: start,
      end_chunk_index: chunk.chunk_index,
      end_offset: start + quote.length,
      quote,
      note: null,
      ...body,
    },
  });
  expect(response.status()).toBe(201);
}

/** 노랑(단락 2) · 초록(단락 22) · 분홍+노트(단락 4) · 북마크(단락 6). 마지막에 남긴 분홍이 최근 형광펜이다. */
async function seedMarks(page: Page) {
  const all = await chunks(page);
  const at = (index: number) => all.find((chunk) => chunk.chunk_index === index) as Chunk;
  await putBookmark(page, at(5));
  await postHighlight(page, at(1), { color: 1 });
  await postHighlight(page, at(21), { color: 2 });
  await postHighlight(page, at(3), { color: 3, note: "아이와 함께 읽기" });
  return { at };
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("정원 나의 기록: 세 가지 수·최근 형광펜 구절 → 노트 탭 · 분홍 칩 → 원문 → 뒤로 복원", async ({ page }) => {
  await signUp(page, "records");
  const { at } = await seedMarks(page);

  await page.goto("/hoondok/garden");
  const tally = page.getByRole("navigation", { name: "나의 기록 종류" });
  await expect(tally.getByRole("link", { name: "형광펜 3" })).toBeVisible();
  await expect(tally.getByRole("link", { name: "북마크 1" })).toBeVisible();
  await expect(tally.getByRole("link", { name: "노트 1" })).toBeVisible();
  // 최근 형광펜 = 분홍(단락 4). 고른 구절(quote) 그대로다
  const latest = page.getByRole("link", { name: /최근 형광펜/ });
  await expect(latest.locator("mark.hl-3")).toHaveText("4번째 합성 문장입니다.");
  await expect(latest).toContainText("단락 4");

  await tally.getByRole("link", { name: "노트 1" }).click();
  await expect(page).toHaveURL(/\/hoondok\/records\?tab=note$/);
  await expect(page.getByRole("tab", { name: "노트 1" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("아이와 함께 읽기");
  await expect(page.getByRole("tabpanel")).toContainText("4번째 합성 문장입니다.");

  await page.getByRole("tab", { name: "형광펜 3" }).click();
  await expect(page).toHaveURL(/\/hoondok\/records$/);
  await page.getByRole("group", { name: "형광펜 색" }).getByRole("button", { name: "분홍 1" }).click();
  await expect(page).toHaveURL(/\/hoondok\/records\?color=3$/);
  const items = page.getByRole("tabpanel").getByRole("link");
  await expect(items).toHaveCount(1);

  // 구절을 누르면 원문의 그 단락이 열리고 그 구절이 칠해져 있다
  await items.first().click();
  await expect(page).toHaveURL(new RegExp(`chunk_id=${at(3).chunk_id}`));
  await expect(page.getByRole("article", { name: "원문 본문" })).toContainText("4번째 합성 문장");
  await expect(page.locator("mark.hl-3")).toHaveText("4번째 합성 문장입니다.");
  await page.goBack();
  await expect(page).toHaveURL(/\/hoondok\/records\?color=3$/);
  await expect(page.getByRole("group", { name: "형광펜 색" }).getByRole("button", { name: "분홍 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("권을 고르면 목차 장 머리 아래 원문 순서로 놓인다", async ({ page }) => {
  await signUp(page, "records-volume");
  await seedMarks(page);
  await page.goto("/hoondok/records");
  await page.getByRole("group", { name: "권" }).getByRole("button", { name: /355권/ }).click();
  await expect(page).toHaveURL(/volume=/);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("heading", { name: "1장 이웃을 듣는 마음" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "제2편 참사랑의 실천" })).toBeVisible();
  // 원문 순서: 단락 2 → 4 → 22 (남긴 순서와 다르다)
  await expect(panel.locator(".rc-meta")).toHaveText([/단락 2/, /단락 4/, /단락 22/]);
});

test("원문이 막힌 권은 '원문 공개 확인 중' 이고 구절·원문 링크가 없다", async ({ page }) => {
  await signUp(page, "records-blocked");
  await seedMarks(page);
  // 권리 철회를 브라우저에서 만들 수 없어 서버 응답의 판정만 바꾼다(형광펜 readable=false, 북마크 발췌 null).
  // 서버 판정은 pytest 가 고정한다
  const isRecordList = (url: URL) =>
    url.pathname.endsWith("/api/backend/hoondok/me/highlights") ||
    (url.pathname.endsWith("/api/backend/hoondok/me/marks") && url.searchParams.get("excerpt") === "true");
  await page.route(isRecordList, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const item of body.items) {
      if ("quote" in item) item.readable = false;
      else item.excerpt = null;
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto("/hoondok/records");
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("원문 공개 확인 중")).toHaveCount(3);
  await expect(panel.getByRole("link")).toHaveCount(0);
  await expect(panel.getByText("합성 문장입니다.")).toHaveCount(0);
  await page.getByRole("tab", { name: "북마크 1" }).click();
  await expect(panel.getByText("원문 공개 확인 중")).toHaveCount(1);
  await expect(panel.getByRole("link")).toHaveCount(0);
  await page.goto("/hoondok/garden");
  await expect(page.getByRole("link", { name: /최근 형광펜/ })).toHaveCount(0);
  await expect(page.getByText("원문 공개 확인 중")).toBeVisible();
});

test("기록 0개 · 비로그인 · 시트 색 이름 · 390/1280 넘침 0", async ({ page }) => {
  await page.goto("/hoondok/records");
  await expect(page.getByRole("heading", { name: "로그인하면 형광펜·노트·북마크가 여기에 모여요" })).toBeVisible();

  await signUp(page, "records-empty");
  await page.goto("/hoondok/records");
  await expect(page.getByRole("heading", { name: "아직 남긴 기록이 없어요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "말씀 서고로 가기" })).toHaveAttribute("href", "/hoondok/library");

  await page.goto(`/hoondok/words/${encodeURIComponent(volume)}`);
  await page.getByRole("button", { name: "단락 1 표시하기" }).click();
  const sheet = page.getByRole("dialog");
  for (const name of ["노랑 형광펜", "초록 형광펜", "분홍 형광펜"])
    await expect(sheet.getByRole("button", { name })).toBeVisible();
  await sheet.getByRole("button", { name: "닫기" }).click();

  await seedMarks(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/hoondok/garden", "/hoondok/records?tab=note", "/hoondok/records?volume=말씀선집+355권"]) {
      await page.goto(path);
      await expect(page.locator(".rc-item, .rc-tally").first()).toBeVisible();
      expect(await overflow(page)).toBe(0);
    }
  }
});

test("이 기기에만 있는 기록: 날짜 최신순 · 한 번에 복사 · 저장한 AI 답 수 · 서버 요청 0", async ({ page }) => {
  // 클립보드는 권한 없이 확인하도록 writeText 를 기록만 하는 가짜로 바꾼다
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "__copied", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
      configurable: true,
    });
  });

  // 기록이 없으면 비로그인 정원에 입구가 없다
  await page.goto("/hoondok/garden");
  await expect(page.getByRole("link", { name: "시작하기" })).toBeVisible();
  await expect(page.getByRole("link", { name: /오늘의 한 줄/ })).toHaveCount(0);

  await page.evaluate(() => {
    localStorage.setItem("hoondok:note:2026-09-21", "새벽에 가족 이름 부르며 기도하기");
    localStorage.setItem("hoondok:note:2026-09-28", "아이에게 먼저 인사하기");
    localStorage.setItem("hoondok:note:2026-09-24", "끝까지 듣기");
    localStorage.setItem(
      "hoondok:ask:items",
      JSON.stringify([
        { id: "a1", question: "q1", status: "answered", createdAt: "2026-09-28T00:00:00Z", isSaved: true },
        { id: "a2", question: "q2", status: "answered", createdAt: "2026-09-27T00:00:00Z" },
      ]),
    );
  });
  await page.goto("/hoondok/garden");
  const entry = page.getByRole("link", { name: /오늘의 한 줄 3개 · 저장한 AI 답 1개/ });
  await expect(entry).toBeVisible();

  const backendCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/backend/")) backendCalls.push(request.url());
  });
  await entry.click();
  await expect(page).toHaveURL(/\/hoondok\/records\/device$/);
  await expect(page.locator(".rc-lines time")).toHaveText(["9월 28일 월요일", "9월 24일 목요일", "9월 21일 월요일"]);
  await page.getByRole("button", { name: "한 줄 모두 글로 복사" }).click();
  await expect(page.getByText("복사했어요")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toEqual([
    "2026년 9월 28일\n아이에게 먼저 인사하기\n\n2026년 9월 24일\n끝까지 듣기\n\n2026년 9월 21일\n새벽에 가족 이름 부르며 기도하기",
  ]);
  await expect(page.getByRole("link", { name: /AI 질문 기록에서 보기/ })).toHaveAttribute("href", "/hoondok/ask/log");
  await page.reload();
  await expect(page.locator(".rc-lines time")).toHaveCount(3);
  expect(backendCalls).toEqual([]);
});
