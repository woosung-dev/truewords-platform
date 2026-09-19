import { expect, type Page, test } from "@playwright/test";

// 훈독 Phase 1 스모크 (PLAN-HD-001 §4 sub-PR 1). 플래그 ON 은 playwright.config webServer env 가 준다.
const PATHS = ["/hoondok", "/hoondok/read"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

for (const viewport of VIEWPORTS) {
  for (const path of PATHS) {
    test(`${viewport.name} ${path}: 가로 넘침 0 · 콘솔 오류 0 · noindex`, async ({ page }) => {
      const errors = await collectConsoleErrors(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
}

test("훈독 스코프 토큰은 시연 챗 :root --accent 를 바꾸지 않는다", async ({ page }) => {
  await page.goto("/hoondok");
  const scoped = await page.evaluate(() =>
    getComputedStyle(document.querySelector('[data-app="hoondok"]')!).getPropertyValue("--accent").trim(),
  );
  expect(scoped).toBe("#c24721");
  const rootOnHoondok = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(rootOnHoondok).not.toBe("#c24721");

  await page.goto("/design-system");
  const rootOnDesignSystem = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(rootOnDesignSystem).toBe(rootOnHoondok);
  expect(rootOnDesignSystem).toMatch(/oklch\(0\.539 0\.166 47\)|lab\(/);
});

test("비로그인 완료 → 온보딩 가입 → 당일 소급 → 홈 연속 1일", async ({ page }) => {
  await page.goto("/hoondok");
  // 데스크톱 홈은 앱바 h1 을 sr-only 로 접으므로 존재만 확인하고, 보이는 제목은 섹션 h2 로 본다.
  await expect(page.getByRole("heading", { name: "오늘 훈독" })).toBeAttached();
  await expect(page.getByRole("heading", { name: "오늘 말씀" })).toBeVisible();
  // make e2e 시드(scripts/seed_daily_readings.py)가 오늘 날짜를 채운다. 시드 데이터는 권리 확인 중(R)·미검수다.
  const card = page.getByRole("article").first();
  await expect(card).toBeVisible();
  await expect(card.getByText("권리 확인 중")).toBeVisible();
  await expect(card.getByText("확인되지 않음")).toBeVisible();
  await expect(page.getByRole("link", { name: /로그인 후 기록돼요/ })).toBeVisible();
  await page.getByRole("link", { name: /훈독하기/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  // 훈독하기: 출처 줄(화자·저작물) + 전문 + 완료 버튼 → 비로그인이라 로컬 완료 + 로그인 링크
  await expect(page.locator(".src").first()).toContainText("참");
  await expect(page.locator(".scripture")).toBeVisible();
  await page.getByRole("button", { name: "훈독 완료" }).click();
  await expect(page.getByRole("status")).toContainText("오늘 훈독을 마쳤어요");
  await page.getByRole("link", { name: /로그인하면 오늘 기록이 남아요/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/onboarding\?returnTo=%2Fhoondok%2Fread$/);

  // 온보딩 최소형: 베타 고지 · 교회 선택 없음 · 가입
  await expect(page.getByText(/독립 운영 베타/).first()).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  const email = `e2e-${Date.now()}@example.com`;
  await page.getByLabel(/이름/).fill("이투이");
  await page.getByLabel(/이메일/).fill(email);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();

  // returnTo 로 복귀 → 로컬 체크가 당일분으로 소급 기록되고 로그인 링크는 사라진다
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  await expect(page.getByRole("status")).toContainText("오늘 훈독을 마쳤어요");
  await expect(page.getByRole("link", { name: /로그인하면 오늘 기록이 남아요/ })).toHaveCount(0);
  await page.getByRole("link", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("이투이님")).toBeVisible();
  await expect(page.locator(".week__streak")).toContainText("연속 1일");
  await expect(page.locator(".week__day[data-today][data-done]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /훈독하기.*완료/ })).toHaveAttribute("aria-pressed", "true");

  // 같은 날 재요청은 409 — 화면은 완료 유지, 요약은 그대로 1회
  const again = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  expect(again.status()).toBe(409);
});

test("시드 사용자 로그인 → 훈독 완료 → 로그아웃 → 완료 API 401", async ({ page }) => {
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByLabel(/이메일/).fill("hoondok@example.com");
  await page.getByLabel(/비밀번호/).fill("test1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("시드식구님")).toBeVisible();

  const summaryBefore = await (await page.request.get("/api/backend/hoondok/me/summary")).json();
  const done = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  // 시드 사용자는 다른 테스트·재실행이 이미 완료했을 수 있다 — 201 또는 409 모두 "오늘 1회" 다
  expect([201, 409]).toContain(done.status());
  const summaryAfter = await (await page.request.get("/api/backend/hoondok/me/summary")).json();
  expect(summaryAfter.today.read).toBe(true);
  expect(summaryAfter.streak_days).toBeGreaterThanOrEqual(1);
  expect(summaryAfter.total_days).toBe(Math.max(summaryBefore.total_days, 1));

  // 로그아웃 → 완료·요약 API 는 401, 홈은 여전히 비로그인 열람
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("form", { name: "가입" })).toBeVisible();
  expect((await page.request.get("/api/backend/hoondok/me/summary")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/backend/hoondok/missions/read/complete", {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/hoondok");
  await expect(page.getByRole("heading", { name: "오늘 말씀" })).toBeVisible();
});

// Phase 3 C — PWA 설치 메타·정적 자산 (PLAN-HD-001 §6 C). 실기기 설치·standalone 증거는 운영 플래그 ON 뒤 G 단계다.
test("PWA 정적 자산: manifest·아이콘 4개·self-host 폰트 200, 스코프 /hoondok, 폰트 immutable", async ({ page }) => {
  const manifest = await page.request.get("/hoondok/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  expect(manifest.headers()["content-type"]).toContain("manifest+json");
  const body = await manifest.json();
  expect(body.scope).toBe("/hoondok");
  expect(body.start_url).toBe("/hoondok");
  expect(body.display).toBe("standalone");

  const iconPaths: string[] = [
    ...body.icons.map((icon: { src: string }) => icon.src),
    "/hoondok/icons/apple-touch-icon-180.png",
  ];
  for (const src of iconPaths) {
    const icon = await page.request.get(src);
    expect(icon.status(), src).toBe(200);
    expect(icon.headers()["content-type"], src).toContain("image/png");
  }

  const font = await page.request.get("/hoondok/fonts/PretendardVariable-1.3.9.woff2");
  expect(font.status()).toBe(200);
  expect(font.headers()["content-type"]).toContain("font/woff2");
  expect(font.headers()["cache-control"]).toContain("immutable");
});

test("설치 메타는 /hoondok 에만 붙고 self-host 폰트가 실제로 로드된다 · 시연 챗 /·/login 에는 없다", async ({
  page,
}) => {
  await page.goto("/hoondok");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/hoondok/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fbfaf8");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "훈독");

  // fonts.check() 는 매칭 face 가 없어도 true 라 쓰지 않는다. face 목록에서 loaded 를 직접 찾는다.
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some(
      (face) => face.family.includes("Pretendard Hoondok") && face.status === "loaded",
    );
  });
  expect(fontLoaded).toBe(true);

  for (const path of ["/", "/login"]) {
    await page.goto(path);
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(0);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(0);
  }
});

// Phase 3 D — 서비스워커 (PLAN-HD-001 §6 D). 오프라인 안내 폴백만, API·인증 응답 캐시 금지, 시연 챗 미제어.
test("SW: scope /hoondok 등록 · sw.js no-cache + Service-Worker-Allowed · manifest no-cache · /login 은 미제어", async ({
  page,
}) => {
  await page.goto("/hoondok");
  const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => new URL(r.scope).pathname));
  expect(scope).toBe("/hoondok");

  const sw = await page.request.get("/hoondok/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  expect(sw.headers()["service-worker-allowed"]).toBe("/hoondok");
  expect((await page.request.get("/hoondok/manifest.webmanifest")).headers()["cache-control"]).toContain("no-cache");

  // getRegistrations() 는 origin 전체를 돌려주므로 시연 챗은 "제어되지 않음" 으로 본다
  await page.goto("/login");
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(controlled).toBe(false);
});

test("오프라인: /hoondok/read 이동 시 /hoondok/offline 로 폴백 렌더(hydration 오류 0) · API·온보딩 응답은 CacheStorage 에 없음", async ({
  page,
  context,
}) => {
  const errors = await collectConsoleErrors(page);
  await page.goto("/hoondok");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(async () => (await caches.match("/hoondok/offline")) !== undefined);

  await context.setOffline(true);
  await page.goto("/hoondok/read");
  // 안내 HTML 을 /hoondok/read URL 에 그대로 내면 앱 셸(usePathname) 이 hydration 불일치를 내므로 SW 가 자기 URL 로 보낸다
  await expect(page).toHaveURL(/\/hoondok\/offline$/);
  await expect(page.getByRole("heading", { name: "지금은 오프라인이에요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "다시 시도" })).toBeVisible();
  await context.setOffline(false);
  expect(errors.filter((message) => /hydrat/i.test(message))).toEqual([]);

  const cache = await page.evaluate(async () => {
    const keys = await caches.keys();
    const hits: string[] = [];
    for (const key of keys) {
      const bucket = await caches.open(key);
      for (const path of ["/api/backend/hoondok/today", "/api/backend/hoondok/auth/me", "/hoondok/onboarding"]) {
        if (await bucket.match(path)) hits.push(`${key}:${path}`);
      }
    }
    return { keys, hits };
  });
  expect(cache.keys.filter((k) => k.startsWith("hoondok-"))).toHaveLength(1);
  expect(cache.hits).toEqual([]);
});
