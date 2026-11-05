import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 훈독 AI 질문 (DEC-PWA-025 2차) — 로그인 필수 · 계정 보관 · 하루 5회.
// 답은 e2e 서버의 고정 답(`apps/api/tests/e2e_app.py` — LLM 만 fixture, 로그인·횟수·계정 기록은 실제 코드)을 쓴다.
// 실 LLM 호출 0 (CI 비용 원칙). 근거 0건 화면만 `/hoondok/ask/stream` 을 page.route 로 스텁한다.

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

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

const headers = { "X-Requested-With": "XMLHttpRequest" };

async function signUp(page: Page, prefix: string) {
  const response = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers,
    data: { email: `${prefix}-${Date.now()}@example.com`, password: "password1", display_name: "질문" },
  });
  expect(response.status()).toBe(201);
}

/** `/hoondok/ask/stream` 요청 본문을 모은다(스텁하지 않고 그대로 보낸다). */
function watchAskRequests(page: Page) {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/backend/hoondok/ask/stream"))
      bodies.push(request.postDataJSON() as Record<string, unknown>);
  });
  return bodies;
}

const QUESTION = "정성을 드린다는 게 정확히 뭘 하는 건가요?";
// e2e 서버 고정 답 (contracts/fixtures/chat-stream.json normal)
const ANSWER = "참사랑은 함께 실천하는 사랑입니다.";
const EVIDENCE = "출처 예시";
const FOLLOWUP = "어떻게 실천할 수 있나요?";
const SESSION_URL = /\/ask\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("비로그인은 추천만 보고, 질문·내 질문은 로그인 안내를 받는다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/ask");
  await expect(page.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
  // 모바일 앱바에도 말씀 검색이 있다(PC 헤더와 같게)
  await expect(page.locator(".appbar").getByRole("link", { name: "말씀 검색" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.getByRole("tab", { name: "내 질문" }).click();
  await expect(page.getByText("로그인하면 내 질문을 볼 수 있어요")).toBeVisible();

  await page.goto(`/ask/new?q=${encodeURIComponent(QUESTION)}`);
  await expect(page.getByText("질문하려면 로그인이 필요해요")).toBeVisible();
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveCount(0);
  const login = page.getByRole("link", { name: "로그인하기" });
  await expect(login).toHaveAttribute("href", /\/onboarding\?returnTo=/);
  // 질문 원문은 주소(returnTo)에 싣지 않고 이 탭의 sessionStorage 에 맡긴다
  expect(decodeURIComponent((await login.getAttribute("href")) ?? "")).not.toContain(QUESTION);
  expect(decodeURIComponent((await login.getAttribute("href")) ?? "")).toContain("/ask/new?resume=1");

  // 서버도 막는다 — 로그인 없이 보낸 질문은 401
  const anonymous = await page.request.post("/api/backend/hoondok/ask/stream", {
    headers,
    data: { query: QUESTION },
  });
  expect(anonymous.status()).toBe(401);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors.filter((text) => !EXPECTED_401.test(text))).toEqual([]);
});

test("로그인 → 질문 → 답 → 이어서 질문 → 저장 → 다시 열어도 계정에 남아 있다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const requests = watchAskRequests(page);
  await signUp(page, "ask-flow");
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/ask");
  await page.getByRole("link", { name: "질문하기" }).click();
  await expect(page).toHaveURL(/\/ask\/new$/);
  await expect(page.getByText("오늘 남은 질문 5회")).toBeVisible();
  await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();
  await page.getByLabel("무엇이 궁금하세요?").fill(QUESTION);
  await page.getByRole("button", { name: "보내기" }).click();

  // 답이 끝나면 계정 대화 주소로 바뀐다
  await expect(page).toHaveURL(SESSION_URL);
  await expect(page.getByText(ANSWER).first()).toBeVisible();
  await expect(page.getByText("이 모델이 답변했어요")).toBeVisible();
  await expect(page.getByText(EVIDENCE).first()).toBeVisible();
  // 보내기 한 번 = 요청 한 번(dev StrictMode 에서도) — 하루 횟수를 두 번 쓰지 않는다
  expect(requests).toEqual([{ query: QUESTION }]);
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeHidden();
  await expect(page.getByText("오늘 남은 질문 4회")).toBeVisible();
  const sessionId = page.url().split("/").at(-1);

  const toggle = page.getByRole("button", { name: "저장" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // 관련 질문(서버 제안)은 이어서 질문하기 칸을 채우기만 한다
  await page.getByRole("button", { name: FOLLOWUP }).click();
  await expect(page.getByRole("textbox", { name: "이어서 질문하기" })).toHaveValue(FOLLOWUP);
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "이어서 질문 보내기" }).click();
  await expect(page.getByRole("region", { name: "이어서 한 질문" }).getByText(ANSWER)).toBeVisible();
  expect(requests.at(-1)).toEqual({ query: FOLLOWUP, session_id: sessionId });
  await expect(page.getByText("오늘 남은 질문 3회")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 기기에는 남기지 않는다 — 계정에서 다시 읽는다
  expect(await page.evaluate(() => localStorage.getItem("hoondok:ask:items"))).toBeNull();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByRole("region", { name: "이어서 한 질문" }).getByText(ANSWER)).toBeVisible();
  await expect(page.getByRole("button", { name: "저장" })).toHaveAttribute("aria-pressed", "true");
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 예전 질문 기록 주소는 홈의 내 질문 탭으로 간다
  await page.goto("/ask/log");
  await expect(page).toHaveURL(/\/ask\?tab=mine$/);
  const row = page.getByRole("link", { name: /정성을 드린다는 게/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("말씀 길잡이");
  await page.getByRole("tab", { name: "저장" }).click();
  await expect(page.getByRole("link", { name: /정성을 드린다는 게/ })).toBeVisible();

  // 상세에서 ← 는 보던 탭으로 돌아간다
  await page.getByRole("link", { name: /정성을 드린다는 게/ }).click();
  await expect(page).toHaveURL(SESSION_URL);
  await page.locator(".appbar").getByRole("link", { name: "뒤로" }).click();
  await expect(page).toHaveURL(/\/ask\?tab=saved$/);
  expect(errors).toEqual([]);
});

test("하루 5번을 다 쓰면 보내기를 잠그고, 서버도 429 로 막는다", async ({ page }) => {
  await signUp(page, "ask-limit");
  for (let index = 0; index < 5; index += 1) {
    const response = await page.request.post("/api/backend/hoondok/ask/stream", {
      headers,
      data: { query: `질문 ${index + 1}` },
    });
    expect(response.status()).toBe(200);
    expect((await response.body()).length).toBeGreaterThan(0);
  }
  const over = await page.request.post("/api/backend/hoondok/ask/stream", { headers, data: { query: "여섯 번째" } });
  expect(over.status()).toBe(429);
  expect((await over.json()).error_code).toBe("ASK_DAILY_LIMIT");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/ask/new?q=${encodeURIComponent("여섯 번째")}`);
  await expect(page.getByText("오늘 질문을 모두 썼어요. 내일 다시 물어볼 수 있어요(자정 초기화)")).toBeVisible();
  await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();

  // 내 질문에는 5건이 계정에 남아 있다
  await page.goto("/ask?tab=mine");
  await expect(page.locator(".ql-list li")).toHaveCount(5);
});

test("근거가 0건이면 답을 보이지 않고 확인할 수 없음으로 끝낸다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await signUp(page, "ask-gate");
  await page.route("**/api/backend/hoondok/ask/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `event: chunk\ndata: ${JSON.stringify({ text: "근거 없는 답" })}\n\n`,
        `event: sources\ndata: ${JSON.stringify({ sources: [], session_id: "", message_id: "", answer_mode: "standard" })}\n\n`,
        `event: done\ndata: ${JSON.stringify({ disclaimer: "" })}\n\n`,
      ].join(""),
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/ask/new?q=아무도%20모르는%20질문");
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue("아무도 모르는 질문");
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(page.getByText("근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요")).toBeVisible();
  await expect(page.getByText("근거 없는 답")).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("훈독하기에서 이 말씀에 질문하기로 들어오면 새 질문 화면에 문장이 채워져 있다", async ({ page }) => {
  await signUp(page, "ask-read");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/read");
  const link = page.getByRole("link", { name: "이 말씀에 질문하기" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/ask\/new\?q=/);
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue(/말씀은 어떤 뜻인가요\?$/);
});

test("원문 단락을 누르고 이 단락으로 질문하기로 새 질문을 연다", async ({ page }) => {
  await signUp(page, "ask-passage");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/words/${encodeURIComponent("말씀선집 355권")}`);
  await page.getByRole("button", { name: "단락 1 표시하기" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "이 단락으로 질문하기" }).click();
  await expect(page).toHaveURL(/\/ask\/new\?q=/);
  const input = page.getByLabel("무엇이 궁금하세요?");
  await expect(input).toHaveValue(/1번째 합성 문장/);
  await expect(input).toHaveValue(/이 단락은 어떤 뜻인가요\?$/);
  // 새 질문 화면은 탭 없이 전체 화면이고, 보내기 전에는 아무것도 묻지 않는다
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /답변 모델: 자동/ })).toBeVisible();
  // 보내기 버튼이 본문 열 밖으로 튀어나오지 않는다
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("공개를 골라 보내면 공개 허용으로 신청되고, 확인을 거쳐 내리면 다시 허용할 수 있다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "ask-public");

  await page.goto("/ask/new");
  await page.getByLabel("무엇이 궁금하세요?").fill("감사의 의미를 알려주세요");
  await page.getByRole("button", { name: /공개 여부/ }).click();
  await expect(page.getByText(/관리자가 골라 추천 질문으로 올릴 수 있어요/)).toBeVisible();
  await page.getByRole("radio", { name: /공개하고 함께 나누기/ }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(page).toHaveURL(SESSION_URL);
  await expect(page.getByText("AI 설명 · 공식 해설 아님").first()).toBeVisible();
  await expect(page.locator(".ask-q__meta").getByText("공개 허용")).toBeVisible();
  const mine = await (await page.request.get("/api/backend/hoondok/me/questions")).json();
  expect(mine.items).toHaveLength(1);
  expect(mine.items[0].status).toBe("pending");

  await page.getByRole("button", { name: "공개 허용 취소" }).click();
  const dialog = page.getByRole("dialog", { name: "공개 허용을 취소할까요?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소하기" }).click();
  await expect(page.getByText("공개 허용을 취소했어요. 내 계정에서만 볼 수 있어요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 공개 허용하기" })).toBeVisible();
  const after = await (await page.request.get("/api/backend/hoondok/me/questions")).json();
  expect(after.items).toHaveLength(0);
});
