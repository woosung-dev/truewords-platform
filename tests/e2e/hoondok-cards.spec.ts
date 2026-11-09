import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 오늘의 책갈피 (PLAN-HD-012, SCR-PWA-022~026). 시드 seed_hoondok_journey.py 의 active 카드 3장 중 오늘 회전 카드를 쓴다.
// 플래그 NEXT_PUBLIC_HOONDOK_CARDS=1 은 playwright.config webServer env 가 준다. 계정은 매번 새로 만든다(재실행 안전).
const headers = { "X-Requested-With": "XMLHttpRequest" };

type TodayCard = {
  id: string;
  text: string;
  volume: string;
  chunk_id: string;
  work_title: string;
  source_label: string;
};

async function todayCard(page: Page): Promise<TodayCard> {
  const response = await page.request.get("/api/backend/hoondok/cards/today");
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.card).not.toBeNull();
  return body.card;
}

async function signUp(page: Page) {
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `cards-${Date.now()}@example.com`, password: "password1", display_name: "책갈피" },
  });
  expect(response.status()).toBe(201);
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** 겹친 부채에서 그 카드가 맨 위로 보이는 한 점(옆 카드의 드러난 띠)을 찾는다. 도는 중이면 멈출 때까지 기다린다 */
async function visiblePoint(target: Locator) {
  const point = await target.evaluate(async (el) => {
    const deck = el.closest(".bks-fan__deck") ?? el;
    await Promise.all(deck.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const r = el.getBoundingClientRect();
    for (let fy = 0.2; fy <= 0.8; fy += 0.1)
      for (let fx = 0.95; fx >= 0.05; fx -= 0.05) {
        const x = r.left + r.width * fx;
        const y = r.top + r.height * fy;
        if (x < 0 || x >= window.innerWidth) continue;
        if (el.contains(document.elementFromPoint(x, y))) return { x, y };
      }
    return null;
  });
  if (!point) throw new Error("카드가 보이는 자리가 없다");
  return point;
}

async function grantClipboard(context: BrowserContext, origin: string) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
}

test("홈 카드 → 받기 → 읽기 → 건네기 시트 → 원문 밑줄 → 다시 꺼내기 (비로그인)", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const card = await todayCard(page);

  await page.goto("/");
  const home = page.locator(".bmhome");
  await expect(page.getByRole("heading", { name: "오늘의 책갈피" })).toBeVisible();
  await expect(home).toContainText(card.volume);
  await home.getByRole("link", { name: "책갈피 꺼내기" }).click();

  await expect(page).toHaveURL(/\/bookmark$/);
  const reinsert = page.getByRole("button", { name: /책에 다시 꽂기/ });
  await expect(reinsert).toBeEnabled();
  await expect(page.locator(".bmk-card")).toContainText(card.text);
  await expect(page.locator(".bmk-card")).toContainText(card.source_label);
  expect(await page.evaluate(() => window.localStorage.getItem("hoondok:card:received"))).toContain(card.id);
  expect(await overflow(page)).toBe(0);

  // 사진 카드 시트: 서버 이미지 미리보기 + 크기·바탕·출처 고르기가 저장 링크 주소에 그대로 실린다
  await grantClipboard(page.context(), baseURL ?? "");
  await page.getByRole("button", { name: "건네기" }).click();
  const sheet = page.getByRole("dialog", { name: "사진 카드로 건네기" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("img", { name: /건넬 사진 카드/ })).toBeVisible();
  // 서버 이미지를 받아 둔 뒤에만 보내기 버튼이 열린다
  await expect(sheet.getByRole("button", { name: /카카오톡·다른 앱으로 건네기/ })).toBeEnabled();
  const save = sheet.getByRole("link", { name: "사진 저장" });
  await expect(save).toHaveAttribute("href", /f=feed&bg=\w+&src=full/);
  await sheet.getByRole("radio", { name: "9:16 스토리" }).click();
  await sheet.getByRole("radio", { name: "책 색" }).click();
  await sheet.getByRole("radio", { name: "책 이름만" }).click();
  await expect(save).toHaveAttribute("href", `/c/${card.id}/image?f=story&bg=book&src=book`);
  await expect(sheet).toContainText("출처와 훈독 표시는 카드에 늘 함께 가요");
  expect(await overflow(page)).toBe(0);
  await sheet.getByRole("button", { name: "글로 복사" }).click();
  await expect(sheet.locator(".bmk-toast")).toContainText("복사했어요");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/c/${card.id}`);
  await sheet.getByRole("button", { name: "닫기" }).click();

  // 책에 다시 꽂기 → 서고 원문: 인용 단락 안 문장 밑줄 + 여백 리본
  await reinsert.click();
  await expect(page).toHaveURL(new RegExp(`card=${card.id}`));
  await expect(page.getByText("오늘의 책갈피가 꽂힌 자리예요.")).toBeVisible();
  await expect(page.locator(".verse--card .wd-card-ul")).toContainText(card.text.slice(0, 10));
  await expect(page.locator(".verse--card .wd-card-rib")).toBeVisible();
  expect(await overflow(page)).toBe(0);

  // 책갈피 다시 꺼내기 → 오늘 이미 받았으므로 모션 없이 읽기
  await page.getByRole("button", { name: "책갈피 다시 꺼내기" }).click();
  await expect(page).toHaveURL(/\/bookmark\?from=words$/);
  await expect(page.locator(".bmk--read")).toBeVisible();
  await expect(page.locator(".bmk-moment")).toBeHidden();
});

test("받은 사람 화면은 로그인 없이 열리고 OG 는 2:1 이미지를 가리킨다", async ({ page, request }) => {
  const card = await todayCard(page);
  await page.goto(`/c/${card.id}`);
  await expect(page.locator(".rcv .bm")).toContainText(card.text);
  const original = page.getByRole("link", { name: "원문에서 앞뒤 읽기" });
  await expect(original).toHaveAttribute("href", new RegExp(`chunk_id=.*&card=${card.id}`));
  await expect(page.getByRole("link", { name: "훈독에서 매일 한 장 받기" })).toHaveAttribute("href", "/");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    `오늘의 책갈피 · ${card.work_title}`,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/c\/.+\/image\?f=link$/);

  for (const query of ["f=link", "f=square", "f=story", "f=feed&bg=lake&src=book", "f=story&bg=book&src=full"]) {
    const image = await request.get(`/c/${card.id}/image?${query}`);
    expect(image.status(), query).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  // 이번 달 콜라주: 정적 c/collage 가 동적 [id] 보다 먼저 잡힌다
  const collage = await request.get(`/c/collage/image?ids=${card.id}&theme=night&f=story`);
  expect(collage.status()).toBe(200);
  expect(collage.headers()["content-type"]).toContain("image/png");
  expect((await request.get("/c/collage/image")).status()).toBe(400);
  expect((await request.get("/c/00000000-0000-4000-8000-000000000000")).status()).toBe(404);

  await original.click();
  await expect(page.locator(".verse--card .wd-card-ul")).toBeVisible();
  // 오늘 카드이므로 "다시 꺼내기" 가 보인다
  await expect(page.getByRole("button", { name: "책갈피 다시 꺼내기" })).toBeVisible();
});

test("비로그인으로 받은 뒤 가입하면 당일분이 나의 책갈피에 소급되고, 건넴이 남는다", async ({ page, baseURL }) => {
  const card = await todayCard(page);
  await page.goto("/bookmarks");
  await expect(page.getByRole("heading", { name: "로그인하면 받은 책갈피가 모여요" })).toBeVisible();

  await page.goto("/bookmark");
  await expect(page.getByRole("button", { name: /책에 다시 꽂기/ })).toBeEnabled();
  await signUp(page);

  // 가입 뒤 어느 책갈피 화면이든 열면 익명 기록을 receive 로 소급한다
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/bookmarks");
  await expect(page.getByRole("tab", { name: "책장" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".bks-spine")).toHaveCount(1);
  await expect(page.locator(".bks-spine")).toContainText(card.work_title);
  await expect(page.locator(".bks-item")).toContainText(card.text);
  await expect(page.locator(".bks-collage")).toContainText("이번 달 모은 말씀");
  expect(await overflow(page)).toBe(0);

  // 책등 → 부채(1장이면 넘김 버튼·위치 알약 없이 카드 하나) → 이 말씀 건네기 → 사진 카드 시트
  await page.getByRole("button", { name: `${card.work_title}, 책갈피 1장 펼치기` }).click();
  const fan = page.getByRole("dialog", { name: card.work_title });
  await expect(fan.getByRole("button", { name: card.text })).toHaveAttribute("aria-current", "true");
  await expect(fan.getByRole("button", { name: "다음 말씀" })).toHaveCount(0);
  await expect(fan.locator(".bks-fan__count")).toHaveCount(0);
  await fan.getByRole("button", { name: "이 말씀 건네기" }).click();
  await expect(page.getByRole("dialog", { name: "사진 카드로 건네기" })).toBeVisible();
  await page.getByRole("dialog", { name: "사진 카드로 건네기" }).getByRole("button", { name: "닫기" }).click();

  // 이번 달 콜라주 시트: 미리보기 주소는 /c/collage/image
  await page.getByRole("button", { name: /한 장으로 만들기/ }).click();
  const collage = page.getByRole("dialog", { name: "이번 달 모은 말씀" });
  await expect(collage.getByRole("link", { name: "사진 저장" })).toHaveAttribute(
    "href",
    `/c/collage/image?ids=${card.id}&theme=paper&f=feed`,
  );
  await expect(collage.getByRole("button", { name: card.text })).toHaveAttribute("aria-pressed", "true");
  await collage.getByRole("button", { name: card.text }).click();
  await expect(collage).toContainText("한 장은 남겨 두어야 해요");
  await collage.getByRole("button", { name: "닫기" }).click();

  // 건네기(클립보드 폴백) → 내 카드 갤러리 탭, 바탕을 바꿔 건넨 모양이 다시 건넬 때 그대로 열린다
  await grantClipboard(page.context(), baseURL ?? "");
  await page.goto("/bookmark");
  await page.getByRole("button", { name: "건네기" }).click();
  const sheet = page.getByRole("dialog", { name: "사진 카드로 건네기" });
  await sheet.getByRole("radio", { name: "호수" }).click();
  await sheet.getByRole("button", { name: "글로 복사" }).click();
  await expect(sheet.locator(".bmk-toast")).toContainText("복사했어요");
  await expect
    .poll(
      async () => (await (await page.request.get("/api/backend/hoondok/me/cards?filter=shared")).json()).items.length,
    )
    .toBe(1);
  await page.goto("/bookmarks?filter=shared");
  await expect(page.getByRole("tab", { name: /내 카드 갤러리/ })).toHaveAttribute("aria-selected", "true");
  const again = page.getByRole("button", { name: /그대로 다시 건네기: / });
  await expect(again).toHaveCount(1);
  expect(await overflow(page)).toBe(0);
  await again.click();
  await expect(
    page.getByRole("dialog", { name: "사진 카드로 건네기" }).getByRole("link", { name: "사진 저장" }),
  ).toHaveAttribute("href", /f=feed&bg=lake&src=full/);
  await page.getByRole("dialog", { name: "사진 카드로 건네기" }).getByRole("button", { name: "닫기" }).click();

  // 나의 정원 진입 링크
  await page.goto("/garden");
  await page.getByRole("link", { name: /나의 책갈피/ }).click();
  await expect(page).toHaveURL(/\/bookmarks$/);
});

test("부채 돌리기: 버튼·방향키·카드 누르기·드래그로 한 장씩 넘기고, 끝에서는 돌아 감지 않는다", async ({ page }) => {
  await signUp(page);
  // 시드 active 카드를 모두 받아 같은 책(말씀선집) 부채를 여러 장으로 만든다
  const list = await page.request.get("/api/backend/hoondok/cards");
  expect(list.status()).toBe(200);
  const cards: TodayCard[] = (await list.json()).items;
  expect(cards.length).toBeGreaterThanOrEqual(3);
  for (const card of cards) {
    const response = await page.request.post(`/api/backend/hoondok/me/cards/${card.id}/receive`, { headers });
    expect(response.status()).toBe(200);
  }
  const mine = (await (await page.request.get("/api/backend/hoondok/me/cards")).json()).items as {
    card: TodayCard;
  }[];
  const title = mine[0].card.work_title;
  const book = mine.filter((item) => item.card.work_title === title).map((item) => item.card);
  const n = Math.min(book.length, 7);
  expect(n).toBeGreaterThanOrEqual(3);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/bookmarks");
    await page.getByRole("button", { name: `${title}, 책갈피 ${book.length}장 펼치기` }).click();
    const fan = page.getByRole("dialog", { name: title });
    const count = fan.locator(".bks-fan__count");
    const prev = fan.getByRole("button", { name: "이전 말씀" });
    const next = fan.getByRole("button", { name: "다음 말씀" });
    const live = fan.locator(".bks-fan__live");
    await expect(count).toHaveText(`1 / ${n}`);
    await expect(fan.getByRole("button", { name: book[0].text })).toHaveAttribute("aria-current", "true");
    // 가로 스크롤 없이, 모바일도 대화상자 안에서 세로 스크롤 없이 한 화면에 든다
    expect(await overflow(page)).toBe(0);
    expect(await fan.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    expect(await fan.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);

    // 첫 장에서 이전: 흐려진 채 포커스는 받고, 돌아 감지 않고 알려 준다
    // (aria-disabled 는 Playwright 가 "비활성"으로 보아 force 로 실제 마우스 클릭을 보낸다)
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await prev.click({ force: true });
    await expect(count).toHaveText(`1 / ${n}`);
    await expect(live).toHaveText("첫 번째 말씀이에요");

    await next.click();
    await expect(count).toHaveText(`2 / ${n}`);
    await expect(fan.locator(".bks-fan__say[data-on] .bks-fan__q")).toHaveText(book[1].text);
    await page.keyboard.press("End");
    await expect(count).toHaveText(`${n} / ${n}`);
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowRight");
    await expect(count).toHaveText(`${n} / ${n}`);
    await expect(live).toHaveText("마지막 말씀이에요");
    await page.keyboard.press("Home");
    await expect(count).toHaveText(`1 / ${n}`);

    // 보이는 옆 카드를 누르면 그 카드가 가운데로 돈다
    const side = await visiblePoint(fan.getByRole("button", { name: book[1].text }));
    await page.mouse.click(side.x, side.y);
    await expect(count).toHaveText(`2 / ${n}`);

    // 가로로 끌면 손가락을 따라 돌고, 휙 넘겨도 한 장만 간다
    const box = await fan.locator(".bks-fan__stage").boundingBox();
    if (!box) throw new Error("무대가 보이지 않는다");
    const y = box.y + box.height * 0.35;
    await page.mouse.move(box.x + box.width * 0.7, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.1, y, { steps: 3 });
    await page.mouse.up();
    await expect(count).toHaveText(`3 / ${n}`);

    // 이 말씀 건네기 → 고른 카드로 사진 카드 시트
    await fan.getByRole("button", { name: "이 말씀 건네기" }).click();
    const sheet = page.getByRole("dialog", { name: "사진 카드로 건네기" });
    await expect(sheet).toBeVisible();
    const image = sheet.getByRole("img", { name: /건넬 사진 카드/ });
    await expect(image).toBeVisible();
    expect(await image.getAttribute("alt")).toContain(book[2].text);
    await sheet.getByRole("button", { name: "닫기" }).click();
  }
});
