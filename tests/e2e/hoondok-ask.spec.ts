import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 훈독 AI 질문 (DEC-PWA-025 개편) — 목록 → "+ 질문하기" → 답 → 이어서 질문하기 → 저장 → 내 질문, 말씀 단락에서 질문.
// `/chat/stream` 은 page.route 로 스텁한다 — 실 LLM 호출 0 (CI 비용 원칙, docs/adr RAGAS 결정과 같은 이유).
// 공개 목록(`GET /hoondok/questions`)은 실제 e2e 서버를 읽는다(공개된 질문이 없으면 예시 질문이 보인다).

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

const QUESTION = "정성을 드린다는 게 정확히 뭘 하는 건가요?";
const ANSWER = "정성은 기간을 정해 드리는 실천입니다.";
const FOLLOW_ANSWER = "작은 약속부터 매일 지켜 보세요.";
const FOLLOWUP = "가족과 함께 정성을 드리려면 어떻게 하나요?";
const EVIDENCE = "참사랑은 직단거리를 갑니다.";
const SOURCES = [{ volume: "천성경 1편 3장", text: EVIDENCE, score: 0.71, source: "A", display_name: "천성경" }];

function sseBody(sources: unknown[], answer: string, followups: string[] = []) {
  return [
    `event: chunk\ndata: ${JSON.stringify({ text: answer })}\n\n`,
    `event: sources\ndata: ${JSON.stringify({
      sources,
      session_id: "e2e-session",
      message_id: "e2e-message",
      answer_mode: "standard",
      suggested_followups: followups,
    })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ disclaimer: "AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다" })}\n\n`,
  ].join("");
}

/** 스텁을 걸고 요청 본문을 들여다볼 수 있게 돌려준다. 이어 묻기(session_id 있음)는 다른 답을 준다. */
async function stubStream(page: Page, sources: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/backend/chat/stream", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const text = body.session_id
      ? sseBody(sources, FOLLOW_ANSWER)
      : sseBody(sources, ANSWER, sources.length > 0 ? [FOLLOWUP] : []);
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: text });
  });
  return requests;
}

test("목록 → 질문하기 → 답 → 이어서 질문 → 저장 → 내 질문 탭", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const requests = await stubStream(page, SOURCES);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/hoondok/ask");
  await expect(page.getByRole("heading", { name: "AI 질문" })).toBeAttached();
  // 질문 화면은 말씀 검색 아이콘 대신 질문 검색(돋보기)을 쓴다. 큰 입력창은 없다
  await expect(page.locator(".appbar").getByRole("link", { name: "말씀 검색" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "추천" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "질문 검색" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole("link", { name: "질문하기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/ask\/new$/);
  await expect(page.getByRole("button", { name: "보내기" })).toBeDisabled();
  await page.getByLabel("무엇이 궁금하세요?").fill(QUESTION);
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/ask\/[\w-]+$/);

  // 답 + 답한 모델 + 근거. 새 질문은 세션 없이 보낸다(자동이라 answer_mode 도 없다)
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText("자동으로 골랐어요")).toBeVisible();
  await expect(page.getByText("AI 설명 · 공식 해설 아님").first()).toBeVisible();
  await expect(page.getByText(EVIDENCE).first()).toBeVisible();
  // dev 서버(React StrictMode)는 마운트 효과를 두 번 실행해 첫 요청이 abort 된다 — 건수 대신 내용을 본다
  expect(requests.length).toBeGreaterThanOrEqual(1);
  for (const request of requests) {
    expect(request).not.toHaveProperty("session_id");
    expect(request).not.toHaveProperty("answer_mode");
    expect(request).toMatchObject({ chatbot_id: "all", query: QUESTION });
  }
  // 이어서 질문하기 막대가 있는 동안 하단 탭은 숨는다
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeHidden();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 저장
  const toggle = page.getByRole("button", { name: "이 질문 저장" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  // 관련 질문(서버 제안)은 이어서 질문하기 칸을 채우기만 한다
  const before = requests.length;
  await page.getByRole("button", { name: FOLLOWUP }).click();
  const field = page.getByRole("textbox", { name: "이어서 질문하기" });
  await expect(field).toHaveValue(FOLLOWUP);
  expect(requests.length).toBe(before);
  await page.getByRole("button", { name: "이어서 질문 보내기" }).click();
  await expect(page.getByText(FOLLOW_ANSWER)).toBeVisible();
  await expect(page.getByText("말씀 길잡이가 이어서 답했어요")).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ query: FOLLOWUP, session_id: "e2e-session" });
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // 예전 질문 기록 주소는 홈의 내 질문 탭으로 간다
  await page.goto("/hoondok/ask/log");
  await expect(page).toHaveURL(/\/hoondok\/ask\?tab=mine$/);
  await expect(page.getByRole("tab", { name: "내 질문" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: /정성을 드린다는 게/ })).toBeVisible();
  await page.getByRole("tab", { name: "저장" }).click();
  await expect(page.getByRole("link", { name: /정성을 드린다는 게/ })).toBeVisible();

  // 1280px 에서도 가로 넘침이 없고, 다시 열면 이어서 한 질문까지 그대로다
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("tab", { name: "내 질문" }).click();
  await page.getByRole("link", { name: /정성을 드린다는 게/ }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText(FOLLOW_ANSWER)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("근거가 0건이면 답을 보이지 않고 확인할 수 없음으로 끝낸다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await stubStream(page, []);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/hoondok/ask/new?q=아무도%20모르는%20질문");
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue("아무도 모르는 질문");
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(page.getByText("근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요")).toBeVisible();
  await expect(page.getByText(ANSWER)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("훈독하기에서 이 말씀에 질문하기로 들어오면 새 질문 화면에 문장이 채워져 있다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/read");
  const link = page.getByRole("link", { name: "이 말씀에 질문하기" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/hoondok\/ask\/new\?q=/);
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue(/말씀은 어떤 뜻인가요\?$/);
});

test("원문 단락을 누르고 이 단락으로 질문하기로 새 질문을 연다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/hoondok/words/${encodeURIComponent("말씀선집 355권")}`);
  await page.getByRole("button", { name: "단락 1 표시하기" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "이 단락으로 질문하기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/ask\/new\?q=/);
  const input = page.getByLabel("무엇이 궁금하세요?");
  await expect(input).toHaveValue(/1번째 합성 문장/);
  await expect(input).toHaveValue(/이 단락은 어떤 뜻인가요\?$/);
  // 새 질문 화면은 탭 없이 전체 화면이고, 보내기 전에는 아무것도 묻지 않는다
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /답변 모델: 자동/ })).toBeVisible();
});

// 공개 신청은 서버에 저장된 답(message_id)이 있어야 하므로 스텁 없이 e2e 서버의 고정 답을 쓴다.
test("로그인 사용자가 공개로 보내면 공개 검토 중으로 신청된다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const signup = await page.request.post("/api/backend/hoondok/auth/signup", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { email: `ask-public-${Date.now()}@example.com`, password: "password1", display_name: "질문" },
  });
  expect(signup.status()).toBe(201);

  await page.goto("/hoondok/ask/new");
  await page.getByLabel("무엇이 궁금하세요?").fill("감사의 의미를 알려주세요");
  await page.getByRole("button", { name: /공개 여부/ }).click();
  await page.getByRole("radio", { name: /공개하고 함께 나누기/ }).click();
  await page.getByRole("button", { name: "보내기" }).click();

  await expect(page.getByText("AI 설명 · 공식 해설 아님").first()).toBeVisible();
  await expect(page.getByText("공개 검토 중")).toBeVisible();
  const mine = await (await page.request.get("/api/backend/hoondok/me/questions")).json();
  expect(mine.items).toHaveLength(1);
  expect(mine.items[0].status).toBe("pending");
});
