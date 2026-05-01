import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: ADR-30 Phase 3 — volume(파일) 영구 삭제 dialog (typed-confirm) 검증
 *
 * 운영 데이터 영향을 피하기 위해 카테고리/볼륨/삭제 API는 모두 page.route로 mock.
 * 사전 조건은 admin-flow.spec.ts와 동일 (테스트 계정 admin@test.com / test1234).
 *
 * 5가지 시나리오:
 *   1. typed-confirm 정확 입력 → 활성 → 클릭 → API 호출 + 토스트
 *   2. typed input 불일치 시 destructive 버튼 disable
 *   3. 삭제 중 spinner + 버튼 disable (응답 지연 시뮬레이션)
 *   4. skip 케이스 — backend에서 skipped 응답 시 토스트에 "스킵 N" 포함
 *   5. a11y — Tab 순서 / aria-label / role="alert" / aria-describedby
 */

const TEST_EMAIL = "admin@test.com";
const TEST_PASSWORD = "test1234";

const TEST_VOLUME = "test_volume_001.pdf";
const TEST_CATEGORY = "TEST";
const TEST_CHUNKS = 23;

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").click();
  await page.locator("#email").pressSequentially(TEST_EMAIL, { delay: 5 });
  await page.locator("#password").click();
  await page.locator("#password").pressSequentially(TEST_PASSWORD, { delay: 5 });
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL("**/chatbots", { timeout: 10_000 });
}

/** 카테고리/볼륨/통계 + 운영 데이터 영향 없는 삭제 응답을 mock으로 inject. */
async function setupMockData(page: Page, options: { deleteHandler?: (route: Route) => Promise<void> | void } = {}) {
  // 카테고리 목록 — 1개만
  await page.route("**/admin/data-source-categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "11111111-1111-1111-1111-111111111111",
          key: TEST_CATEGORY,
          name: "테스트",
          description: "E2E 테스트용",
          color: "indigo",
          sort_order: 0,
          is_active: true,
          is_searchable: true,
          created_at: "2026-04-27T00:00:00Z",
          updated_at: "2026-04-27T00:00:00Z",
        },
      ]),
    });
  });

  // 카테고리 통계 — TEST_VOLUME 1개 포함
  await page.route("**/admin/data-sources/category-stats", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          source: TEST_CATEGORY,
          total_chunks: TEST_CHUNKS,
          volumes: [TEST_VOLUME],
          volume_count: 1,
        },
      ]),
    });
  });

  // 전체 volume 목록 — chunk_count 포함 (DeleteConfirmDialog 데이터 매핑용)
  await page.route("**/admin/data-sources/volumes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { volume: TEST_VOLUME, sources: [TEST_CATEGORY], chunk_count: TEST_CHUNKS },
      ]),
    });
  });

  // 인제스트 status (사이드바 "처리 중" badge용 — 빈 응답)
  await page.route("**/admin/data-sources/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        completed: {},
        failed: {},
        in_progress: {},
        summary: { total_files: 1, completed_count: 1, failed_count: 0, total_chunks: TEST_CHUNKS },
      }),
    });
  });

  // 삭제 API — 호출자가 deleteHandler를 넘기면 우선 사용. 기본은 정상 200 응답.
  await page.route("**/admin/data-sources/volumes/*", async (route) => {
    if (options.deleteHandler) {
      await options.deleteHandler(route);
      return;
    }
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deleted_volumes: [TEST_VOLUME],
          total_chunks_deleted: TEST_CHUNKS,
          skipped: [],
        }),
      });
    } else {
      await route.continue();
    }
  });
}

/** 카테고리 탭 → TEST 카테고리 확장 → volume 행 표시까지의 공용 흐름. */
async function openCategoryAndExpand(page: Page) {
  await page.goto("/data-sources");
  await page.getByRole("button", { name: "카테고리 관리" }).click();
  // 카테고리 행이 렌더되기를 대기
  await expect(page.getByRole("row", { name: new RegExp(TEST_CATEGORY) })).toBeVisible({
    timeout: 10_000,
  });
  // 카테고리 row 클릭하여 확장 (volume 목록 노출)
  await page.getByRole("row", { name: new RegExp(TEST_CATEGORY) }).first().click();
  await expect(page.getByText(TEST_VOLUME)).toBeVisible();
}

test.describe("ADR-30 Phase 3 — volume 영구 삭제 다이얼로그", () => {
  test.beforeEach(async ({ page }) => {
    await setupMockData(page);
    await login(page);
  });

  test("(2) typed input 불일치 시 destructive 버튼 disable", async ({ page }) => {
    await openCategoryAndExpand(page);
    await page.getByRole("button", { name: `${TEST_VOLUME} 영구 삭제` }).click();

    // 모달 표출 확인
    await expect(page.getByText("파일 영구 삭제")).toBeVisible();

    // 잘못된 값 입력 → destructive 버튼 비활성
    const confirmInput = page.getByLabel(/확인을 위해/);
    await confirmInput.fill("wrong_input");
    const deleteBtn = page.getByRole("dialog").getByRole("button").filter({ hasText: /영구 삭제|삭제 중/ });
    await expect(deleteBtn).toBeDisabled();

    // helper text — 일치 안내가 사라지고 정확 일치 안내 유지
    await expect(page.getByText(/정확히 일치하지 않으면/)).toBeVisible();
  });

  test("(1) typed-confirm 정확 입력 → 활성 → API 호출 + 성공 토스트", async ({ page }) => {
    await openCategoryAndExpand(page);
    await page.getByRole("button", { name: `${TEST_VOLUME} 영구 삭제` }).click();

    const confirmInput = page.getByLabel(/확인을 위해/);
    await confirmInput.fill(TEST_VOLUME);

    // 정확 일치 시 ✓ 안내 + 버튼 활성
    await expect(page.getByText(/일치합니다/)).toBeVisible();
    const deleteBtn = page.getByRole("dialog").getByRole("button").filter({ hasText: /영구 삭제|삭제 중/ });
    await expect(deleteBtn).toBeEnabled();

    // DELETE 요청을 캡처할 수 있도록 클릭 직전 listener 등록
    const deletePromise = page.waitForRequest((req) =>
      req.url().includes(`/admin/data-sources/volumes/${encodeURIComponent(TEST_VOLUME)}`) &&
      req.method() === "DELETE",
    );

    await deleteBtn.click();
    await deletePromise;

    // 성공 토스트 — chunk 수 포함
    await expect(page.getByText(/영구 삭제 완료/)).toBeVisible({ timeout: 5_000 });
  });

  test("(3) 삭제 중 spinner + 버튼 disable (응답 지연)", async ({ page }) => {
    // 응답 1.5초 지연으로 in-flight 상태 캡처. Playwright route는 LIFO이므로
    // beforeEach 등록 라우트보다 새로 등록한 핸들러가 우선 적용된다.
    await page.route("**/admin/data-sources/volumes/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await new Promise((r) => setTimeout(r, 1500));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            deleted_volumes: [TEST_VOLUME],
            total_chunks_deleted: TEST_CHUNKS,
            skipped: [],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await openCategoryAndExpand(page);
    await page.getByRole("button", { name: `${TEST_VOLUME} 영구 삭제` }).click();
    await page.getByLabel(/확인을 위해/).fill(TEST_VOLUME);
    const deleteBtn = page.getByRole("dialog").getByRole("button").filter({ hasText: /영구 삭제|삭제 중/ });
    await deleteBtn.click();

    // 클릭 직후 — "삭제 중..." 텍스트 + spinner + 버튼 disable
    await expect(page.getByText("삭제 중...")).toBeVisible({ timeout: 1_000 });
    await expect(deleteBtn).toBeDisabled();

    // 마무리: 응답 도착 후 토스트
    await expect(page.getByText(/영구 삭제 완료/)).toBeVisible({ timeout: 5_000 });
  });

  test("(4) skip 케이스 — 토스트에 'skip' 카운트 포함", async ({ page }) => {
    // backend가 일부를 skipped로 응답한 경우 — 토스트에 표시되어야 함.
    // LIFO이므로 새 라우트가 우선.
    await page.route("**/admin/data-sources/volumes/*", async (route) => {
      if (route.request().method() === "DELETE") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            deleted_volumes: [],
            total_chunks_deleted: 0,
            skipped: [{ volume: TEST_VOLUME, reason: "Qdrant/DB 어디에도 데이터 없음" }],
          }),
        });
      } else {
        await route.continue();
      }
    });

    await openCategoryAndExpand(page);
    await page.getByRole("button", { name: `${TEST_VOLUME} 영구 삭제` }).click();
    await page.getByLabel(/확인을 위해/).fill(TEST_VOLUME);
    await page.getByRole("dialog").getByRole("button").filter({ hasText: /영구 삭제|삭제 중/ }).click();

    // 토스트 — 스킵 카운트 표시
    await expect(page.getByText(/스킵 1/)).toBeVisible({ timeout: 5_000 });
  });

  test("(5) a11y — aria-* 속성 + Tab 키 focus 순서", async ({ page }) => {
    await openCategoryAndExpand(page);
    await page.getByRole("button", { name: `${TEST_VOLUME} 영구 삭제` }).click();

    // role="alert" + aria-live="polite" 위험 안내가 노출되어 스크린리더에 announce
    const alertNode = page.getByRole("alert").filter({ hasText: /되돌릴 수 없는/ });
    await expect(alertNode).toBeVisible();

    // 닫기 버튼 aria-label
    await expect(page.getByRole("button", { name: "닫기" })).toBeVisible();

    // 모달 진입 시 input에 자동 focus (focus-management)
    const confirmInput = page.getByLabel(/확인을 위해/);
    await expect(confirmInput).toBeFocused();

    // 잘못된 입력 → aria-invalid="true" 반영
    await confirmInput.fill("wrong");
    await expect(confirmInput).toHaveAttribute("aria-invalid", "true");

    // 정확 입력 → aria-invalid="false"
    await confirmInput.fill(TEST_VOLUME);
    await expect(confirmInput).toHaveAttribute("aria-invalid", "false");

    // Tab 순서: input → 취소 → 영구 삭제
    await confirmInput.focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "취소" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("dialog").getByRole("button").filter({ hasText: /영구 삭제|삭제 중/ }),
    ).toBeFocused();
  });
});
