import { createHash } from "node:crypto";
import { expect, test } from "./hoondok-test";

// 시드(seed_hoondok_summaries.py)가 uuid5(NAMESPACE_URL, "truewords:summary:" + slug) 로 ID 를 고정한다.
function summaryId(slug: string): string {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex"); // NAMESPACE_URL
  const hash = createHash("sha1").update(namespace).update(`truewords:summary:${slug}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const PUBLISHED = { slug: "cheon-01-01-01", title: "하나님의 실존" };
const DRAFT = { slug: "cheon-01-01-02", title: "근원이요 본체이신 하나님" };

test("공개된 AI 요약 상세: 핵심 한 줄 · 요점 · 그림 토글 · 근거 링크 · 고정 안내", async ({ page }) => {
  await page.goto(`/summaries/${summaryId(PUBLISHED.slug)}`);
  await expect(page.getByRole("heading", { name: PUBLISHED.title, level: 2, exact: true })).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "AI가 만든 이해 도움 자료예요. 공식 해설이 아니에요." }),
  ).toBeVisible();

  await expect(page.getByRole("heading", { name: "핵심 한 줄" })).toBeVisible();
  await expect(page.locator(".sum-lead")).toContainText("천성경은 사람의 몸과 양심");
  await expect(page.getByRole("heading", { name: "요점", exact: true })).toBeVisible();
  await expect(page.locator(".sum-points li")).toHaveCount(3);

  // 그림 토글: 개념 → 장면
  const toggle = page.getByRole("group", { name: "그림 고르기" });
  const concept = toggle.getByRole("button", { name: "개념 그림" });
  const scene = toggle.getByRole("button", { name: "장면 그림" });
  await expect(concept).toHaveAttribute("aria-pressed", "true");
  const figure = page.locator(".sum-figure__frame img");
  const conceptSrc = await figure.getAttribute("src");
  await scene.click();
  await expect(scene).toHaveAttribute("aria-pressed", "true");
  await expect(concept).toHaveAttribute("aria-pressed", "false");
  await expect(figure).not.toHaveAttribute("src", conceptSrc ?? "");
  await expect.poll(() => figure.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // 근거마다 원문 링크가 있다
  const links = page.locator(".sum-evidence a");
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveAttribute("href", /^\/words\/.+chunk_id=/);
});

test("비공개(draft) 요약은 목록과 상세에서 보이지 않는다", async ({ page }) => {
  await page.goto("/summaries");
  await expect(page.getByRole("link", { name: new RegExp(PUBLISHED.title) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(DRAFT.title) })).toHaveCount(0);

  const draft = await page.request.get(`/api/backend/hoondok/ai-summaries/${summaryId(DRAFT.slug)}`);
  expect(draft.status()).toBe(404);
  await page.goto(`/summaries/${summaryId(DRAFT.slug)}`);
  await expect(page.getByText("지금은 읽을 수 없는 요약이에요")).toBeVisible();
  await expect(page.getByRole("heading", { name: DRAFT.title })).toHaveCount(0);
});
