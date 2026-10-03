import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

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

// 설정 화면의 `GET /hoondok/push/config` 404 도 계약대로 "준비 중" 으로 다뤄진다 (PLAN-HD-006 C,
// hoondok.spec.ts 와 같은 필터). sub-PR A 머지 뒤에는 200 이라 이 예외는 더 걸리지 않는다.
function isPushConfigProbe(text: string, url: string) {
  return /status of 404/.test(text) && url.includes("/hoondok/push/config");
}

function collectConsoleErrors(page: Page) {
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

  // 로컬 backend 에는 VAPID 가 없다 — 훈독하기도 비활성이고, 나머지 알림은 토글 없이 '그 밖의 알림' 한 줄이다
  const toggle = page.getByRole("button", { name: "훈독하기 알림" });
  await expect(toggle).toBeDisabled();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  for (const label of ["기도하기 알림", "가정예배 알림", "공지 알림"]) {
    await expect(page.getByRole("button", { name: label })).toHaveCount(0);
  }
  await expect(page.getByText("기도하기 · 가정예배 · 공지")).toBeVisible();
  // 훈독하기 · 그 밖의 알림 · 조용한 시간. 탭 내비의 "말씀 검색 (준비 중)" 은 프리뷰 플래그에 따라 달라지므로 본문(main) 안만 센다
  await expect(page.locator("main").getByText("준비 중")).toHaveCount(3);
  await expect(page.locator("main").getByText("4종")).toHaveCount(0);
  await expect(page.locator("main").getByText("알림함")).toHaveCount(0);

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

// ---------- 훈독 시간 고르기 (추천 4칸 + 직접 정하기, API 변경 없음) ----------
// 로컬 backend 에는 VAPID 키가 없다 — 서버 설정은 가짜로 켜고, 권한·구독은 브라우저 안에서 흉내 낸다
// (hoondok.spec.ts stubPushBrowser 와 같은 방식). 설정 PUT(/hoondok/me/notifications) 은 실제 backend 로 간다.
const FAKE_VAPID_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const FAKE_ENDPOINT = "https://push.example/settings";

async function stubPushBrowser(page: Page, context: BrowserContext) {
  await context.grantPermissions(["notifications"]);
  await page.route("**/api/backend/hoondok/push/config", (route) =>
    route.fulfill({ json: { enabled: true, public_key: FAKE_VAPID_KEY } }),
  );
  await page.addInitScript(
    ({ endpoint }) => {
      const subscription = {
        endpoint,
        unsubscribe: async () => true,
        toJSON: () => ({ endpoint, keys: { p256dh: "fake-p256dh", auth: "fake-auth" } }),
      };
      PushManager.prototype.subscribe = async () => subscription as unknown as PushSubscription;
      PushManager.prototype.getSubscription = async () => subscription as unknown as PushSubscription;
      // 헤드리스 Chromium 은 grantPermissions 뒤에도 permission 을 "denied" 로 답한다 — 허용 이후의 계약만 본다
      Object.defineProperty(Notification, "permission", { get: () => "granted" });
      Notification.requestPermission = async () => "granted";
    },
    { endpoint: FAKE_ENDPOINT },
  );
  await page.route("**/api/backend/hoondok/me/push", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 201, json: { id: "e2e", endpoint: FAKE_ENDPOINT, created_at: "2026-09-29" } })
      : route.continue(),
  );
}

/** 설정 PUT 본문을 모은다 — "고르면 PUT 한 번" 을 센다. */
function collectPrefsPuts(page: Page) {
  const bodies: { read_enabled: boolean; read_time: string }[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/hoondok/me/notifications")) {
      bodies.push(request.postDataJSON());
    }
  });
  return bodies;
}

const prefsSaved = (page: Page) =>
  page.waitForResponse(
    (response) => response.url().includes("/hoondok/me/notifications") && response.request().method() === "PUT",
  );

/** 네이티브 라디오는 모양 칸(label) 안에 숨어 있다 — 사람처럼 칸을 누른다. */
function presetLabel(page: Page, name: RegExp) {
  return page.locator("label.st-preset").filter({ has: page.getByRole("radio", { name }) });
}

test("설정: 훈독 시간 — 06:00 은 직접 정하기 · 칸을 고르면 PUT 1회 · 화살표 이동 · 직접 21:00 · 끄면 비활성", async ({
  page,
  context,
}) => {
  const errors = collectConsoleErrors(page);
  await stubPushBrowser(page, context);
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, `e2e-read-time-${Date.now()}@example.com`);
  const puts = collectPrefsPuts(page);

  await page.goto("/hoondok/settings");
  const toggle = page.getByRole("button", { name: "훈독하기 알림" });
  await expect(toggle).toBeEnabled();
  const enabled = prefsSaved(page);
  await toggle.click();
  expect((await enabled).status()).toBe(200);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // ① 서버 기본 06:00 은 추천 칸에 없다 → 직접 정하기
  const group = page.getByRole("group", { name: "언제 알려 드릴까요?" });
  await expect(group.getByRole("radio")).toHaveCount(5);
  await expect(page.getByRole("radio", { name: /직접 정하기/ })).toBeChecked();
  await expect(page.getByLabel("훈독하기 알림 시간")).toHaveValue("06:00");
  const summary = page.getByRole("status").filter({ hasText: "에 알려드려요" });
  await expect(summary).toContainText("매일 오전 6:00에 알려드려요");
  // ⑤ 켤 수 있어도 그 밖의 알림 · 조용한 시간은 '준비 중', 알림함·'4종'·'아침 훈독' 문구는 없다
  await expect(page.locator("main").getByText("준비 중")).toHaveCount(2);
  await expect(page.locator("main").getByText("알림함")).toHaveCount(0);
  await expect(page.locator("main").getByText("4종")).toHaveCount(0);
  await expect(page.locator("main").getByText(/아침 훈독/)).toHaveCount(0);
  await expect(page.locator(".st-row", { hasText: "조용한 시간" }).locator("a, button")).toHaveCount(0);

  // ② 새벽 5:30 → PUT 한 번, '저장했어요'(status) · 요약 문장, 새로고침해도 그대로
  puts.length = 0;
  const saved = prefsSaved(page);
  await presetLabel(page, /새벽/).click();
  expect((await saved).status()).toBe(200);
  await expect(summary).toContainText("저장했어요");
  await expect(summary).toContainText("매일 오전 5:30에 알려드려요");
  expect(puts).toEqual([{ read_enabled: true, read_time: "05:30" }]);
  await page.reload();
  await expect(page.getByRole("radio", { name: /새벽/ })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "에 알려드려요" })).toContainText(
    "매일 오전 5:30에 알려드려요",
  );

  // ⑦ 키보드: 화살표로 다음 칸 → 그 칸이 선택되고 저장된다(포커스가 사라지지 않는다). 칸은 44px 이상
  for (const box of await Promise.all(
    (await page.locator("label.st-preset").all()).map((label) => label.boundingBox()),
  )) {
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }
  puts.length = 0;
  await page.getByRole("radio", { name: /새벽/ }).focus();
  const arrowSaved = prefsSaved(page);
  await page.keyboard.press("ArrowRight");
  expect((await arrowSaved).status()).toBe(200);
  await expect(page.getByRole("radio", { name: /아침/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /아침/ })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "에 알려드려요" })).toContainText(
    "매일 오전 7:30에 알려드려요",
  );
  expect(puts).toEqual([{ read_enabled: true, read_time: "07:30" }]);

  // ③ 직접 정하기: 여는 것만으로는 저장하지 않고, 21:00 을 넣으면 그 값으로 저장한다
  puts.length = 0;
  await presetLabel(page, /직접 정하기/).click();
  await expect(page.getByLabel("훈독하기 알림 시간")).toHaveValue("07:30");
  expect(puts).toEqual([]);
  const customSaved = prefsSaved(page);
  await page.getByLabel("훈독하기 알림 시간").fill("21:00");
  expect((await customSaved).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "에 알려드려요" })).toContainText(
    "매일 오후 9:00에 알려드려요",
  );
  expect(puts.at(-1)).toEqual({ read_enabled: true, read_time: "21:00" });
  const prefs = await (await page.request.get("/api/backend/hoondok/me/notifications")).json();
  expect(prefs.read_time).toBe("21:00");

  // ⑧ 390 · 1280 가로 넘침 0
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, viewport.name).toBeLessThanOrEqual(0);
  }

  // ④ 끄면 칸이 모두 비활성이고 요약 문장이 사라진다
  const disabled = prefsSaved(page);
  await toggle.click();
  expect((await disabled).status()).toBe(200);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
  await expect(page.getByText("에 알려드려요")).toHaveCount(0);

  // 비로그인 온보딩 첫 로드의 /auth/me 401 은 정상 리소스 로그다 (hoondok.spec 알림 제안 테스트와 같은 필터)
  expect(errors.filter((message) => !/status of 401/.test(message))).toEqual([]);
});

test("알림 제안 카드: 지금(KST)과 가까운 칸을 미리 고르고, 버튼 문구 · PUT 시각이 그 칸과 같다", async ({
  page,
  context,
}) => {
  const errors = collectConsoleErrors(page);
  await stubPushBrowser(page, context);
  // 오늘(KST) 07:40 으로 브라우저 시계를 고정한다 — 가장 가까운 칸은 아침 7:30. 날짜는 오늘 그대로 둔다.
  const todayKst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  await page.clock.setFixedTime(new Date(`${todayKst}T07:40:00+09:00`));
  await signUp(page, `e2e-prompt-time-${Date.now()}@example.com`);

  const card = page.locator(".push-prompt");
  const group = card.getByRole("radiogroup", { name: "매일 언제 훈독을 알려 드릴까요?" });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await expect(group.getByRole("radio", { name: /아침/ })).toBeChecked();
  const button = card.getByRole("button", { name: "오전 7:30에 알림 받기" });
  await expect(button).toBeVisible();

  const puts = collectPrefsPuts(page);
  const saved = prefsSaved(page);
  await button.click();
  expect((await saved).status()).toBe(200);
  expect(puts).toEqual([{ read_enabled: true, read_time: "07:30" }]);
  await expect(card).toContainText("매일 오전 7:30에 알려 드릴게요");

  // 설정에서도 같은 칸이 골라져 있다
  await page.goto("/hoondok/settings");
  await expect(page.getByRole("radio", { name: /아침/ })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: "에 알려드려요" })).toContainText(
    "매일 오전 7:30에 알려드려요",
  );
  expect(errors.filter((message) => !/status of 401/.test(message))).toEqual([]);
});
