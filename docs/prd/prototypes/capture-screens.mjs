// 훈독(가안) 프로토타입 스크린샷 캡처.
// 실행: 저장소 루트에서 `pnpm install --frozen-lockfile` 후 `node docs/prd/prototypes/capture-screens.mjs [a|b]`
// tests/e2e 의 @playwright/test 를 빌려 쓰며, 폰 6장은 2배 해상도, 보드는 1배로 저장한다.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const require = createRequire(path.join(root, "tests/e2e/package.json"));
const { chromium } = require("@playwright/test");

const DATE = "2026-09-09";
const keys = process.argv[2] ? [process.argv[2]] : ["a", "b"];
const out = path.join(here, "screenshots", DATE);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];

for (const key of keys) {
  const url = pathToFileURL(path.join(here, `${DATE}-hoondok-${key}.html`)).href;

  // 폰 6장 (2x)
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${key}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${key}: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  for (let i = 1; i <= 6; i++) {
    const box = await page.locator(`#s${i} .device`).boundingBox();
    const pad = 16;
    await page.screenshot({
      path: path.join(out, `${key}-0${i}.png`),
      fullPage: true,
      clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
    });
  }
  // 각 화면 콘텐츠가 폰 밖으로 새지 않는지 (overflow hidden 이므로 잘림만 확인)
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".device")].map((d, i) => ({ i: i + 1, w: d.scrollWidth, h: d.scrollHeight })),
  );
  console.log(key, "device scroll sizes", JSON.stringify(overflow));
  await page.close();

  // 보드 1장 (1x)
  const board = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await board.goto(url, { waitUntil: "networkidle" });
  await board.evaluate(() => document.fonts.ready);
  await board.waitForTimeout(400);
  await board.screenshot({ path: path.join(out, `${key}-board.png`), fullPage: true });
  await board.close();
}

await browser.close();
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("ok", out);
