import type { Page } from "@playwright/test";
import { expect, test } from "./hoondok-test";

// 맞춤 말씀 앱 안 화면: 가입 직후 질문 흐름 → 홈 오늘의 책갈피 아래 한 줄(고르기 / 까닭·바꾸기) → 관심사 바꾸기.
// 답은 이 기기 localStorage 에만 있고 카드는 기기에서 고른다(프리뷰 플래그라 카드 목록은 fixture). 선택값은 요청에 실리지 않는다.
// 정적 경로(/hoondok/family 등)와 겹치지 않게 쿼리·조각과 요청 본문만 본다
const SELECTION = /family|tired|thankful|interests|moods/;
function carriesSelection(url: string, body: string | null): boolean {
  const { search, hash } = new URL(url);
  return SELECTION.test(search + hash) || SELECTION.test(body ?? "");
}

async function signUp(page: Page, name: string) {
  await page.goto("/hoondok/onboarding");
  await page.getByLabel(/이름/).fill(name);
  await page.getByLabel(/이메일/).fill(`e2e-personal-${Date.now()}@example.com`);
  await page.getByLabel(/비밀번호/).fill("password1");
  await page.getByRole("button", { name: "가입하고 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok\/start$/);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
}

test("질문 없이 시작하면 홈 책갈피 아래 '고르기' 줄이 질문 흐름으로 이어진다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page, "건너뛴식구");
  await page.getByRole("link", { name: "질문 없이 시작하기" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);
  await expect(page.getByRole("heading", { level: 2, name: "오늘의 책갈피" })).toBeVisible();
  await expect(page.getByText("관심 주제를 고르면 맞춘 장이 꽂혀요")).toBeVisible();
  const pick = page.getByRole("link", { name: "관심 주제 고르기" });
  await expect(pick).toHaveAttribute("href", "/hoondok/start");
  expect((await pick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noOverflow(page);
});

test("고르고 시작하면 홈 책갈피에 까닭 줄이 붙고, 바꾸기에서 고친 답이 이 기기에만 남는다", async ({ page }) => {
  test.setTimeout(60_000);
  const leaks: string[] = [];
  page.on("request", (request) => {
    if (carriesSelection(request.url(), request.postData())) leaks.push(request.url());
  });
  await signUp(page, "고른식구");
  await page.getByRole("button", { name: "시작하기" }).click();
  await page.getByRole("checkbox", { name: /가정과 부부/ }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("checkbox", { name: "지쳤어요" }).click();
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: "첫 말씀 보기" }).click();
  await expect(page.getByText("앱이 고른 원문 단락이에요. 공식 해설이나 지금 하신 말씀은 아니에요.")).toBeVisible();
  await page.getByRole("link", { name: "오늘 훈독으로" }).click();
  await expect(page).toHaveURL(/\/hoondok$/);

  // 홈: 맞춘 카드 + 고른 이름을 인용한 까닭 한 줄 + 바꾸기(44px)
  await expect(page.getByText(/고르셔서 꽂아 둔 장이에요/)).toBeVisible();
  await expect(page.getByText("관심 주제를 고르면 맞춘 장이 꽂혀요")).toHaveCount(0);
  const change = page.getByRole("link", { name: "관심사와 마음 바꾸기" });
  expect((await change.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await noOverflow(page);

  // 관심사와 마음: 위기 선택지 없음 · 저장은 이 기기에만
  await change.click();
  await expect(page).toHaveURL(/\/hoondok\/garden\/interests$/);
  await expect(page.getByRole("button", { name: /많이 힘들어요/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "가정과 부부" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "감사해요" }).click();
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByRole("status").filter({ hasText: "저장했어요" })).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("hoondok:personal:answers") ?? "{}"));
  expect(stored.moods).toEqual(["tired", "thankful"]);
  await noOverflow(page);

  // 선택값을 주소·요청에 싣지 않는다
  expect(leaks).toEqual([]);
});
