import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

// 훈독 스펙은 이 test 를 쓴다. 서버의 "오늘"(today_kst)은 실제 시계를 따르므로, 테스트 도중 KST 자정을 넘으면
// 앞서 받은 오늘 카드·편성이 어제 것이 되어 화면이 바뀐다(예: "책갈피 다시 꺼내기" → "책갈피로 돌아가기").
// 자정 직전이면 자정을 넘긴 뒤 시작한다. 시드의 오늘 편성은 20일치라 다음 날로 넘어가도 비지 않는다.
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const GUARD_MS = 120_000; // 가장 긴 훈독 테스트(90초)보다 길게
const SETTLE_MS = 2_000;

function msUntilKstMidnight(now = Date.now()): number {
  return DAY_MS - ((now + KST_OFFSET_MS) % DAY_MS);
}

export const test = base.extend<{ kstDayBoundary: undefined }>({
  kstDayBoundary: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture 는 첫 인자를 구조 분해로 받아야 한다
    async ({}, use, testInfo) => {
      const left = msUntilKstMidnight();
      if (left < GUARD_MS) {
        // 기다리는 시간도 테스트 시간 제한에 들어가므로 그만큼 늘린다.
        testInfo.setTimeout(testInfo.timeout + left + SETTLE_MS);
        await new Promise((resolve) => setTimeout(resolve, left + SETTLE_MS));
      }
      await use(undefined);
    },
    { auto: true },
  ],
});
