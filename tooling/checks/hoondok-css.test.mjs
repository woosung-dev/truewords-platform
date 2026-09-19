import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSource, HOONDOK_CSS } from "./hoondok-css.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const ok =
  '[data-app="hoondok"] { --accent: #c24721; --paper: #fbfaf8; }\n[data-app="hoondok"] { .x { color: var(--accent); } @media (min-width: 768px) { .y { color: var(--paper); } } }';

test("정상 스코프 CSS 는 통과한다", () => {
  assert.deepEqual(checkSource(ok), []);
});
test(":root 선언을 거부한다", () => {
  assert.ok(checkSource(`${ok}\n:root { --accent: #000; }`).some((f) => f.includes(":root")));
});
test("토큰 블록 밖 hex 를 거부하고 주석 안 hex 는 무시한다", () => {
  assert.ok(checkSource(`${ok}\n[data-app="hoondok"] .z { color: #fff; }`).some((f) => f.includes("#fff")));
  assert.deepEqual(checkSource(`${ok}\n/* #a03a1a on #fbe9e1 */`), []);
});
test("허용 밖 브레이크포인트와 폐기값을 거부한다", () => {
  assert.ok(checkSource(ok.replace("768px", "1440px")).some((f) => f.includes("1440px")));
  assert.ok(checkSource(ok.replace("#c24721", "#d4562e")).some((f) => f.includes("#d4562e")));
});
test("실제 hoondok.css 가 통과한다", () => {
  assert.deepEqual(checkSource(readFileSync(path.join(root, HOONDOK_CSS), "utf8")), []);
});
