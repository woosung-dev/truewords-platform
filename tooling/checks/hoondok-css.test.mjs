import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSource, HOONDOK_CSS, listHoondokCssFiles } from "./hoondok-css.mjs";

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
test("@media 안의 허용 밖 브레이크포인트는 여전히 거부한다", () => {
  const css = `${ok}\n[data-app="hoondok"] { @media (min-width: 900px) { .t { gap: 8px; } } }`;
  assert.ok(checkSource(css).some((f) => f.includes("900px")));
});
test("@media 밖 min-width 선언은 브레이크포인트로 보지 않는다", () => {
  assert.deepEqual(checkSource(`${ok}\n[data-app="hoondok"] { .t { min-width: 24px; } }`), []);
});
test("실제 hoondok.css 가 통과한다", () => {
  assert.deepEqual(checkSource(readFileSync(path.join(root, HOONDOK_CSS), "utf8")), []);
});
test("보조 파일은 첫 블록 안 hex 도 거부하고 --accent 를 요구하지 않는다", () => {
  const aux = '[data-app="hoondok"] { .garden { color: var(--ink); } @media (min-width: 1024px) { .g { gap: 8px; } } }';
  assert.deepEqual(checkSource(aux, { hasTokens: false }), []);
  const withHex = '[data-app="hoondok"] { --local: #fff; .garden { color: var(--local); } }';
  assert.ok(checkSource(withHex, { hasTokens: false }).some((f) => f.includes("#fff")));
  assert.ok(checkSource(withHex, { hasTokens: false }).every((f) => !f.includes("--accent")));
});
test("보조 파일도 스코프 없으면 실패한다", () => {
  assert.ok(checkSource(".garden { color: var(--ink); }", { hasTokens: false }).some((f) => f.includes("스코프")));
});
test("실제 훈독 CSS 전 파일이 통과한다", () => {
  const files = listHoondokCssFiles(root);
  assert.equal(files[0], HOONDOK_CSS);
  assert.ok(files.length > 1, "_hoondok/*.css 화면 그룹 파일이 있어야 한다");
  for (const file of files) {
    const failures = checkSource(readFileSync(path.join(root, file), "utf8"), { hasTokens: file === HOONDOK_CSS });
    assert.deepEqual(failures, [], file);
  }
});
