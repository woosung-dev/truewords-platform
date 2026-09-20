import { expect, type Page, test } from "@playwright/test";

// 훈독 AI 질문 (PLAN-HD-002 W2 · SCR-PWA-005·005b·006).
// `/chat/stream` 은 page.route 로 스텁한다 — 실 LLM 호출 0 (CI 비용 원칙, docs/adr RAGAS 결정과 같은 이유).
// 질문·답·근거는 기기 저장소에만 있으므로 로그인은 필요 없다.

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

const ANSWER = "정성은 기간을 정해 드리는 실천입니다.";
const EVIDENCE = "참사랑은 직단거리를 갑니다.";
const SOURCES = [{ volume: "천성경 1편 3장", text: EVIDENCE, score: 0.71, source: "A", display_name: "천성경" }];

function sseBody(sources: unknown[]) {
  return [
    `event: chunk\ndata: ${JSON.stringify({ text: "정성은 " })}\n\n`,
    `event: chunk\ndata: ${JSON.stringify({ text: "기간을 정해 드리는 실천입니다." })}\n\n`,
    `event: sources\ndata: ${JSON.stringify({ sources, session_id: "e2e", message_id: "e2e" })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ disclaimer: "AI 설명은 참고용이며 교회장의 지도를 대체하지 않습니다" })}\n\n`,
  ].join("");
}

/** 스텁을 걸고 마지막 요청 본문을 들여다볼 수 있게 돌려준다. */
async function stubStream(page: Page, sources: unknown[]) {
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/backend/chat/stream", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: sseBody(sources) });
  });
  return requests;
}

test("질문 → 근거 있는 답 → 저장 → 기록에서 다시 열기", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  const requests = await stubStream(page, SOURCES);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/hoondok/ask");
  await expect(page.getByRole("heading", { name: "AI 질문" })).toBeAttached();
  await expect(page.getByRole("button", { name: "물어보기" })).toBeDisabled();

  // 시작 문장은 입력을 채우기만 한다 (AC-017-03)
  await page.getByRole("button", { name: "정성을 드린다는 게 정확히 뭘 하는 건가요?" }).click();
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue("정성을 드린다는 게 정확히 뭘 하는 건가요?");
  expect(requests).toHaveLength(0);

  await page.getByRole("button", { name: "물어보기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/ask\/[\w-]+$/);

  // 답 본문 + 근거 카드 1. 무기억이라 session_id 를 보내지 않는다
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText(EVIDENCE)).toBeVisible();
  await expect(page.getByText("AI 설명 · 공식 해설 아님")).toBeVisible();
  // dev 서버(React StrictMode)는 마운트 효과를 두 번 실행해 첫 요청이 abort 된다 — 건수 대신 모든 요청이 무기억인지 본다
  expect(requests.length).toBeGreaterThanOrEqual(1);
  for (const request of requests) {
    expect(request).not.toHaveProperty("session_id");
    expect(request).toMatchObject({ chatbot_id: "all", query: "정성을 드린다는 게 정확히 뭘 하는 건가요?" });
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  const toggle = page.getByRole("button", { name: "이 질문 저장" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await page.goto("/hoondok/ask/log");
  await expect(page.getByRole("tab", { name: /내 질문 1/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /저장한 답 1/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /식구들 질문/ })).toBeDisabled();

  // 1280px 에서도 가로 넘침이 없다
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: /정성을 드린다는 게/ }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("근거가 0건이면 답을 보이지 않고 확인할 수 없음으로 끝낸다", async ({ page }) => {
  const errors = await collectConsoleErrors(page);
  await stubStream(page, []);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/hoondok/ask?q=아무도%20모르는%20질문");
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue("아무도 모르는 질문");
  await page.getByRole("button", { name: "물어보기" }).click();

  await expect(page.getByText("근거 말씀을 찾지 못했어요. 다른 표현으로 물어봐 주세요")).toBeVisible();
  await expect(page.getByText(ANSWER)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("훈독하기에서 이 말씀에 질문하기로 들어오면 문장이 채워져 있다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/hoondok/read");
  const link = page.getByRole("link", { name: "이 말씀에 질문하기" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/hoondok\/ask\?q=/);
  await expect(page.getByLabel("무엇이 궁금하세요?")).toHaveValue(/말씀은 어떤 뜻인가요\?$/);
});
