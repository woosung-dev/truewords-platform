import { expect, type Page, test } from "@playwright/test";

// 훈독 Phase 1 스모크 (PLAN-HD-001 §4 sub-PR 1). 플래그 ON 은 playwright.config webServer env 가 준다.
const PATHS = ["/hoondok", "/hoondok/read", "/hoondok/garden", "/hoondok/settings"] as const;
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
] as const;

// 비로그인 방문의 `GET /hoondok/auth/me` 401 은 계약이다(API-HD-003). 쿠키가 HttpOnly 라
// 클라이언트는 물어보기 전에 로그인 여부를 알 수 없고, 브라우저는 그 401 을 콘솔 오류로 찍는다.
// 이 한 건만 제외하고 나머지는 그대로 0건을 단언한다 — URL 까지 맞을 때만 빼므로 다른 401 은 잡힌다.
const EXPECTED_401 = /status of 401/;
function isAnonymousAuthProbe(text: string, url: string) {
  return EXPECTED_401.test(text) && url.includes("/hoondok/auth/me");
}

// 설정 화면은 `GET /hoondok/push/config` 로 알림을 켤 수 있는지 먼저 묻는다 (PLAN-HD-006 C).
// 이 엔드포인트는 sub-PR A 가 들어오기 전까지 404 고, 화면은 그걸 "준비 중" 으로 다룬다 —
// 브라우저는 404 도 리소스 오류로 찍으므로 그 한 건만 뺀다. A 머지 뒤에는 200 이라 이 예외는 더 걸리지 않는다.
function isPushConfigProbe(text: string, url: string) {
  return /status of 404/.test(text) && url.includes("/hoondok/push/config");
}

async function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isAnonymousAuthProbe(message.text(), message.location().url)) return;
    if (isPushConfigProbe(message.text(), message.location().url)) return;
    errors.push(message.text());
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
  // 홈에는 말씀 본문이 없다 — 정본이 today 에서 `.lede` 를 숨기고 PRD SCR-PWA-002 도 미션 3종만 둔다.
  // 오늘 말씀은 미션 카드의 제목으로만 드러나고 전문은 /hoondok/read 가 갖는다.
  await expect(page.getByRole("heading", { name: "오늘의 실천" })).toBeVisible();
  await expect(page.locator(".scripture")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /로그인 후 기록돼요/ })).toBeVisible();
  await page.getByRole("link", { name: /훈독하기/ }).click();
  await expect(page).toHaveURL(/\/hoondok\/read$/);
  // 훈독하기: 출처 줄(화자·저작물) + 전문 + 완료 버튼 → 비로그인이라 로컬 완료 + 로그인 링크
  await expect(page.locator(".src").first()).toContainText("참");
  await expect(page.locator(".scripture")).toBeVisible();
  // make e2e 시드(scripts/seed_daily_readings.py)가 오늘 날짜를 채운다. 시드 데이터는 권리 확인 중(R)·미검수다.
  const card = page.getByRole("article").first();
  await expect(card.getByText("권리 확인 중")).toBeVisible();
  await expect(card.getByText("확인되지 않음", { exact: true })).toBeVisible();
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
  // 소급 동기화(sync)로 기록된 완료는 설치 안내 자격이 아니다 (Phase 3 E)
  await expect(page.getByRole("heading", { name: /홈 화면에 추가하면/ })).toHaveCount(0);

  // 같은 날 재요청은 409 — 화면은 완료 유지, 요약은 그대로 1회
  const again = await page.request.post("/api/backend/hoondok/missions/read/complete", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  expect(again.status()).toBe(409);
});

// PLAN-HD-009 함께 읽는 사람들 1단계 — 익명 숫자 카드. E2E 시드는 오늘 완료자가 10명 미만이라 보통 대체 문구지만,
// 재실행·다른 테스트가 완료를 쌓을 수 있어 두 문구를 모두 허용하고 API 응답과 화면이 맞는지만 본다.
test("홈 함께 읽는 사람들: 익명 카드 1장 · 기준 미만이면 숫자 없이 대체 문구", async ({ page }) => {
  await page.goto("/hoondok");
  await expect(page.getByRole("heading", { name: "함께 읽는 사람들" })).toBeVisible();
  const card = page.locator(".card.together");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("누가 읽었는지는 보이지 않아요");

  const together = await (await page.request.get("/api/backend/hoondok/today/together")).json();
  expect(together.threshold).toBe(10);
  if (together.is_shown) {
    await expect(card).toContainText(`오늘 함께 읽은 식구 ${together.count.toLocaleString("ko-KR")}명`);
  } else {
    expect(together.count).toBeNull();
    await expect(card).toContainText("오늘도 식구들과 함께 읽어요");
    await expect(card).not.toContainText(/\d+명/);
  }
});

// Phase 3 E — 설치 안내 카드 (PLAN-HD-001 §6 E). 헤드리스 Chromium 은 beforeinstallprompt 를 발사하지 않으므로 일반 안내(manual)
// 변형과 자격·숨김 규칙만 본다. prompt()·iOS 공유 분기는 실기기 증거(G 뒤)로 대체한다. 시드 사용자는 재실행 시 이미 완료(체크 disabled)라
// 새 계정으로 직접 완료(user → 201 recorded)를 만든다.
test("설치 안내: 직접 완료 뒤 홈 카드 노출 · reload 유지 · 나중에 30일 숨김", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await page.goto("/hoondok/onboarding");
  await page.getByLabel(/이름/).fill("설치");
  await page.getByLabel(/이메일/).fill(`e2e-install-${Date.now()}@example.com`);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByText("설치님")).toBeVisible();
  const title = page.getByRole("heading", { name: /홈 화면에 추가하면/ });
  await expect(title).toHaveCount(0);

  // 홈 미션 카드 체크 = 직접 완료(user) → 201 recorded → 자격. 헤드리스라 prompt 미캡처 → 일반 안내(manual) 변형
  const check = page.getByRole("button", { name: /훈독하기.*완료/ });
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "true");
  await expect(title).toBeVisible();
  await expect(page.getByText(/브라우저 메뉴의 '홈 화면에 추가'/)).toBeVisible();
  await expect(page.getByRole("button", { name: "지금 추가" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hoondok:install:eligible"))).toBe("1");

  await page.reload();
  await expect(title).toBeVisible();

  await page.getByRole("button", { name: "나중에" }).click();
  await expect(title).toHaveCount(0);
  const hiddenUntil = await page.evaluate(() => localStorage.getItem("hoondok:install:hidden-until"));
  const hiddenDays = (Date.parse(hiddenUntil ?? "") - Date.now()) / 86_400_000;
  expect(hiddenDays).toBeGreaterThan(29.9);
  expect(hiddenDays).toBeLessThanOrEqual(30);
  await page.reload();
  await expect(title).toHaveCount(0);
  // 비로그인 온보딩 첫 로드의 /auth/me 401 은 정상 리소스 로그다. 카드 자체의 오류(getSnapshot 캐시 경고 등)만 0 이어야 한다.
  expect(errors.filter((message) => !/status of 401/.test(message))).toEqual([]);
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
  await expect(page.getByRole("heading", { name: "오늘의 실천" })).toBeVisible();
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

// ===== Phase 4 알림 (PLAN-HD-006 C) =====
// VAPID 공개키(P-256 비압축 65바이트)를 base64url 로. 가짜 구독을 만들 때 subscribe 가 이 값을 받는다.
const FAKE_VAPID_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const FAKE_ENDPOINT = "https://push.example/abc";

async function loginAsSeedUser(page: Page) {
  await page.goto("/hoondok/onboarding");
  await page.getByRole("button", { name: "로그인" }).click();
  await page.getByLabel(/이메일/).fill("hoondok@example.com");
  await page.getByLabel(/비밀번호/).fill("test1234");
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
}

test("알림: backend 에 VAPID 가 없으면 훈독하기도 '준비 중' 이고 켤 수 없다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await loginAsSeedUser(page);
  await page.goto("/hoondok/settings");

  const toggle = page.getByRole("button", { name: "훈독하기 알림" });
  await expect(page.locator("main").getByText("준비 중")).toHaveCount(6);
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // 켤 수 없으므로 시간도 고를 수 없다 (input 대신 꺼진 행)
  await expect(page.getByLabel("훈독하기 알림 시간")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// 구독 저장(POST /hoondok/me/push)과 설정(PUT /hoondok/me/notifications) 은 API-HD-020·021(sub-PR A, 머지됨)이다.
// 여기서는 브라우저 쪽 계약(권한 → subscribe → POST 본문 → PUT) 을 끝까지 확인한다.
test("알림: 권한 허용 → 구독 저장 → 설정 PUT, reload 뒤에도 켜짐", async ({ page, context }) => {
  await context.grantPermissions(["notifications"]);
  // 서버 설정은 가짜로 켠다 — 로컬 backend 에는 VAPID 키가 없다.
  await page.route("**/api/backend/hoondok/push/config", (route) =>
    route.fulfill({ json: { enabled: true, public_key: FAKE_VAPID_KEY } }),
  );
  // 실제 푸시 서비스에 등록하지 않는다. endpoint·keys 모양만 계약대로 돌려준다.
  await page.addInitScript(
    ({ endpoint }) => {
      const subscription = {
        endpoint,
        unsubscribe: async () => true,
        toJSON: () => ({ endpoint, keys: { p256dh: "fake-p256dh", auth: "fake-auth" } }),
      };
      PushManager.prototype.subscribe = async () => subscription as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () => subscription as unknown as PushSubscription;
      // 헤드리스 Chromium 은 grantPermissions 뒤에도 Notification.permission 을 "denied" 로 답한다(2026-09-22 실측).
      // 권한 자체는 실기기 증거가 확인하고, 여기서는 허용 이후의 계약(subscribe → POST → PUT)만 본다.
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async () => "granted";
    },
    { endpoint: FAKE_ENDPOINT },
  );
  const subscribeBodies: unknown[] = [];
  await page.route("**/api/backend/hoondok/me/push", async (route) => {
    subscribeBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { id: "e2e", endpoint: FAKE_ENDPOINT, created_at: "2026-09-22" } });
  });

  await loginAsSeedUser(page);
  await page.goto("/hoondok/settings");
  const toggle = page.getByRole("button", { name: "훈독하기 알림" });
  await expect(toggle).toBeEnabled();

  const savedPrefs = page.waitForResponse(
    (response) => response.url().includes("/hoondok/me/notifications") && response.request().method() === "PUT",
  );
  await toggle.click();
  expect((await savedPrefs).status()).toBe(200);
  expect(subscribeBodies).toEqual([
    { endpoint: FAKE_ENDPOINT, keys: { p256dh: "fake-p256dh", auth: "fake-auth" }, user_agent: expect.any(String) },
  ]);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("훈독하기 알림 시간")).toBeVisible();

  // 켜짐의 근거는 서버다 — 새로고침해도, API 로 직접 물어도 같다.
  await page.reload();
  await expect(page.getByRole("button", { name: "훈독하기 알림" })).toHaveAttribute("aria-pressed", "true");
  const prefs = await (await page.request.get("/api/backend/hoondok/me/notifications")).json();
  expect(prefs.read_enabled).toBe(true);

  // 뒷정리: 시드 사용자는 다른 스펙도 쓴다 — 켠 채로 두지 않는다.
  await page.getByRole("button", { name: "훈독하기 알림" }).click();
  await expect(page.getByRole("button", { name: "훈독하기 알림" })).toHaveAttribute("aria-pressed", "false");
});
