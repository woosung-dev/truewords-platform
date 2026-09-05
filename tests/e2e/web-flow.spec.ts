import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill("admin@test.com");
  await page.getByLabel("비밀번호", { exact: true }).fill("test1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("heading", { name: "TrueWords 시연 참여" })).toBeVisible();
}

async function enterChat(page: Page) {
  await login(page);
  await page.getByLabel("이름", { exact: true }).fill("E2E 참여자");
  await page.getByLabel("카테고리 / 소속").fill("격리 검증");
  await page.getByRole("button", { name: "채팅 시작" }).click();
  await expect(page.getByRole("textbox", { name: "질문 입력" })).toBeEnabled();
}

test("미인증 사용자 웹은 자체 로그인으로 이동한다", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "TrueWords 로그인" })).toBeVisible();
});

test("로그인 → 시연 게이트 → 내 기록 → 로그아웃", async ({ page }) => {
  await enterChat(page);
  await page.getByRole("button", { name: "대화 기록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "대화 기록" })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  const me = await page.request.get("/api/backend/admin/auth/me");
  expect(me.status()).toBe(401);
});

test("모바일 뷰에서 SSE 답변·출처 원문을 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/backend/api/sources/chunks/fixture-chunk?*", (route) => route.fulfill({
    json: {
      chunk_id: "fixture-chunk", text: "인용 원문 검증", volume: "말씀선집 001권",
      sources: ["A"], chunk_index: 0, merged_text: "인용 원문 검증", main_offset_start: 0, main_offset_end: 8,
    },
  }));
  await enterChat(page);
  const input = page.getByRole("textbox", { name: "질문 입력" });
  await input.fill("참사랑을 알려주세요");
  await input.press("Control+Enter");
  // 최종 body를 한 번에 버퍼링하면 이 중간 텍스트는 관찰할 수 없다.
  await expect(page.getByText("참사랑은", { exact: true })).toBeVisible();
  await expect(page.getByText("참사랑은 함께 실천하는 사랑입니다.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("참사랑은 함께 실천하는 사랑입니다.", { exact: true })).toBeVisible();
  await page.getByText("클릭하여 원문 보기 →").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("인용 원문 검증", { exact: true })).toBeVisible();
});

test("스트림 HTTP 오류는 오류 코드 원문 대신 사용자 안내로 표시한다", async ({ page }) => {
  await page.route("**/api/backend/chat/stream", (route) => route.fulfill({
    status: 503,
    json: { error_code: "SEARCH_FAILED", message: "내부 검색 오류", request_id: "fixture-error" },
  }));
  await enterChat(page);
  const input = page.getByRole("textbox", { name: "질문 입력" });
  await input.fill("검색 오류 검증");
  await input.press("Control+Enter");
  await expect(page.getByText("검색 서비스에 일시적 장애가 발생했어요. 잠시 후 다시 시도해주세요.")).toBeVisible();
  await expect(page.getByText("fixture-error", { exact: true })).toHaveCount(0);
});

test("사용자 중단은 이미 받은 부분 답변을 남긴다", async ({ page }) => {
  await enterChat(page);
  const input = page.getByRole("textbox", { name: "질문 입력" });
  await input.fill("답변 중단 검증");
  await input.press("Control+Enter");
  await expect(page.getByText("참사랑은", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "응답 생성 중단" }).click();
  await expect(page.getByText("(사용자가 응답 생성을 중단했습니다.)", { exact: true })).toBeVisible();
  await expect(page.getByText("참사랑은", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "응답 생성 중단" })).toHaveCount(0);
});

test("done 없이 종료된 연결은 부분 답변과 오류 안내를 남긴다", async ({ page }) => {
  await page.route("**/api/backend/chat/stream", (route) => route.fulfill({
    contentType: "text/event-stream",
    body: 'event: chunk\ndata: {"text":"부분 답변 보존"}\n\n',
  }));
  await enterChat(page);
  const input = page.getByRole("textbox", { name: "질문 입력" });
  await input.fill("연결 종료 검증");
  await input.press("Control+Enter");
  await expect(page.getByText("부분 답변 보존", { exact: true })).toBeVisible();
  await expect(page.getByText(/일시적인 오류가 발생했어요/)).toBeVisible();
  await expect(page.getByRole("button", { name: "응답 생성 중단" })).toHaveCount(0);
});
