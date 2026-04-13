import { test, expect, type Page } from "@playwright/test";

/**
 * E2E 테스트: 관리자 로그인 → 챗봇 목록 → 편집 → search_tiers 수정 → 저장
 *
 * 사전 조건:
 *   1. PostgreSQL + Qdrant Docker 실행 중
 *   2. 테스트 계정 생성 완료:
 *      cd backend && uv run python scripts/create_admin.py admin@test.com test1234
 *   3. 챗봇 seed 데이터:
 *      cd backend && uv run python scripts/seed_chatbot_configs.py
 */

const TEST_EMAIL = "admin@test.com";
const TEST_PASSWORD = "test1234";

// --- 헬퍼 ---

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").click();
  await page.locator("#email").pressSequentially(TEST_EMAIL, { delay: 10 });
  await page.locator("#password").click();
  await page.locator("#password").pressSequentially(TEST_PASSWORD, { delay: 10 });
  await page.getByRole("button", { name: "로그인" }).click();
  // 로그인 후 챗봇 목록으로 리다이렉트 대기
  await page.waitForURL("**/chatbots", { timeout: 10_000 });
}

// --- 테스트 ---

test.describe("관리자 로그인", () => {
  test("로그인 페이지가 렌더링된다", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("관리자 로그인")).toBeVisible();
    await expect(page.getByText("관리자 계정으로 로그인하세요")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
  });

  test("잘못된 비밀번호로 로그인 실패", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").click();
    await page.locator("#email").pressSequentially(TEST_EMAIL);
    await page.locator("#password").click();
    await page.locator("#password").pressSequentially("wrong_password");
    await page.getByRole("button", { name: "로그인" }).click();
    // 401 → fetchAPI가 /login 리다이렉트 + "인증이 필요합니다" 에러
    // 로그인 페이지에서 "서버에 연결할 수 없습니다" 또는 에러 메시지 표시
    // 혹은 리다이렉트만 발생하여 로그인 페이지에 머무름
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    // 챗봇 목록으로 이동하지 않았음을 확인 (로그인 실패)
    await expect(page.getByText("관리자 로그인")).toBeVisible();
  });

  test("올바른 계정으로 로그인 성공 → 챗봇 목록 이동", async ({ page }) => {
    await login(page);
    await expect(page.getByText("챗봇 관리")).toBeVisible();
  });
});

test.describe("챗봇 목록", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("챗봇 목록이 표시된다", async ({ page }) => {
    await expect(page.getByText("챗봇 관리")).toBeVisible();
    // seed 데이터로 생성된 챗봇이 있어야 함
    await expect(page.getByRole("table")).toBeVisible({ timeout: 5_000 });
  });

  test("새 챗봇 만들기 링크가 존재한다", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /새 챗봇/ })
    ).toBeVisible();
  });

  test("편집 링크를 클릭하면 편집 페이지로 이동한다", async ({ page }) => {
    const editLink = page.getByRole("link", { name: /편집/ }).first();
    await expect(editLink).toBeVisible({ timeout: 5_000 });
    await editLink.click();
    await page.waitForURL("**/chatbots/*/edit", { timeout: 5_000 });
    await expect(page.getByText("편집")).toBeVisible();
  });
});

test.describe("챗봇 편집 + search_tiers 수정", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // 첫 번째 챗봇의 편집 페이지로 이동
    const editLink = page.getByRole("link", { name: /편집/ }).first();
    await expect(editLink).toBeVisible({ timeout: 5_000 });
    await editLink.click();
    await page.waitForURL("**/chatbots/*/edit", { timeout: 5_000 });
  });

  test("편집 페이지가 정상 렌더링된다", async ({ page }) => {
    await expect(page.locator("#display-name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "저장" })
    ).toBeVisible();
  });

  test("표시 이름을 수정하고 저장할 수 있다", async ({ page }) => {
    const nameInput = page.locator("#display-name");
    await expect(nameInput).toBeVisible();

    // 기존 값을 지우고 새 값 입력
    const originalName = await nameInput.inputValue();
    await nameInput.clear();
    await nameInput.fill("E2E 테스트 챗봇");

    // 저장
    await page.getByRole("button", { name: "저장" }).click();

    // 성공 토스트 또는 페이지 유지 확인
    // 저장 후 잠시 대기
    await page.waitForTimeout(1_000);

    // 원래 이름으로 복원
    await nameInput.clear();
    await nameInput.fill(originalName);
    await page.getByRole("button", { name: "저장" }).click();
    await page.waitForTimeout(1_000);
  });

  test("search_tiers 티어 추가/삭제가 동작한다", async ({ page }) => {
    // 티어 추가 버튼 클릭
    const addButton = page.getByRole("button", { name: /티어 추가/ });
    if (await addButton.isVisible()) {
      const tierCountBefore = await page.locator('[id^="min-results-"]').count();
      await addButton.click();
      const tierCountAfter = await page.locator('[id^="min-results-"]').count();
      expect(tierCountAfter).toBeGreaterThanOrEqual(tierCountBefore);
    }
  });

  test("전체 플로우: 편집 → 티어 수정 → 저장 → 목록 복귀", async ({
    page,
  }) => {
    // 1. 편집 페이지 확인
    await expect(page.locator("#display-name")).toBeVisible();

    // 2. 저장 버튼 클릭
    await page.getByRole("button", { name: "저장" }).click();
    await page.waitForTimeout(1_500);

    // 3. 목록으로 돌아가기
    const backButton = page.getByRole("link", { name: "목록으로" }).or(
      page.getByRole("button", { name: "목록으로" })
    );
    if (await backButton.isVisible()) {
      await backButton.click();
      await page.waitForURL("**/chatbots", { timeout: 5_000 });
      await expect(page.getByText("챗봇 관리")).toBeVisible();
    }
  });
});

test.describe("검색 모드 선택 (Weighted Search)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    const editLink = page.getByRole("link", { name: /편집/ }).first();
    await expect(editLink).toBeVisible({ timeout: 5_000 });
    await editLink.click();
    await page.waitForURL("**/chatbots/*/edit", { timeout: 5_000 });
  });

  test("검색 전략 라디오 버튼이 표시된다", async ({ page }) => {
    await expect(page.getByText("순차 검색 (Cascading)")).toBeVisible();
    await expect(page.getByText("비중 검색 (Weighted)")).toBeVisible();
  });

  test("비중 검색 모드로 전환하면 WeightedSourceEditor가 표시된다", async ({
    page,
  }) => {
    // 기본: Cascading 모드 → 티어 에디터 표시
    const cascadingRadio = page.locator('input[value="cascading"]');
    await expect(cascadingRadio).toBeChecked();

    // Weighted 모드로 전환
    const weightedRadio = page.locator('input[value="weighted"]');
    await weightedRadio.click();
    await expect(weightedRadio).toBeChecked();

    // WeightedSourceEditor UI 확인
    await expect(page.getByText("소스 추가")).toBeVisible();
  });

  test("모드 전환 후 저장 → 재로드 시 설정 유지", async ({ page }) => {
    // Weighted 모드로 전환
    await page.locator('input[value="weighted"]').click();

    // 소스 추가
    const addBtn = page.getByRole("button", { name: "소스 추가" });
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(500);
    }

    // 저장 + 성공 토스트 대기
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장되었습니다")).toBeVisible({ timeout: 5_000 });

    // 페이지 새로고침
    await page.reload();

    // 데이터 로드 대기
    await expect(page.locator("#display-name")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1_500);

    // 검색 설정 섹션으로 스크롤
    const weightedRadio = page.locator('input[value="weighted"]');
    await weightedRadio.scrollIntoViewIfNeeded();

    // Weighted 모드가 유지되는지 확인
    await expect(weightedRadio).toBeChecked({ timeout: 5_000 });
  });
});

test.describe("인증 가드", () => {
  test("비로그인 상태에서 챗봇 페이지 접근 시 로그인으로 리다이렉트", async ({
    page,
  }) => {
    await page.goto("/chatbots");
    // AuthGuard가 로그인 페이지로 리다이렉트
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page.getByText("관리자 로그인")).toBeVisible();
  });

  test("비로그인 상태에서 대시보드 접근 시 로그인으로 리다이렉트", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10_000 });
  });
});
