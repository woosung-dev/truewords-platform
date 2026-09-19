import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// 훈독 CSS 스코프 검사 (PLAN-HD-001 Phase 1 sub-PR 1, DES-PWA-003 §7).
// 1) :root 선언 0  2) 첫 토큰 블록 밖 hex 색 0  3) min-width 브레이크포인트 ⊆ {768,1024,1224}  4) 폐기값 #d4562e 0
const root = fileURLToPath(new URL("../../", import.meta.url));
export const HOONDOK_CSS = "apps/web/src/app/hoondok.css";
export const ALLOWED_BREAKPOINTS = new Set([768, 1024, 1224]);
export const RETIRED_HEX = "#d4562e";
const TOKEN_SCOPE = '[data-app="hoondok"]';

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 첫 `[data-app="hoondok"] {` 블록을 토큰 구역으로 보고 (블록 안, 나머지) 로 나눈다. */
export function splitTokenBlock(source) {
  const css = stripComments(source);
  const start = css.indexOf(TOKEN_SCOPE);
  if (start < 0) return { tokens: "", rest: css, hasScope: false };
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return {
    tokens: css.slice(open + 1, close),
    rest: css.slice(0, start) + css.slice(close + 1),
    hasScope: true,
  };
}

export function checkSource(source) {
  const failures = [];
  const { tokens, rest, hasScope } = splitTokenBlock(source);
  if (!hasScope) failures.push(`토큰 블록 ${TOKEN_SCOPE} { … } 이 없습니다`);
  if (/:root\b/.test(stripComments(source)))
    failures.push(":root 선언은 금지입니다 (globals.css 의 시연 챗 토큰과 섞임)");
  if (stripComments(source).toLowerCase().includes(RETIRED_HEX))
    failures.push(`폐기값 ${RETIRED_HEX} 이 있습니다 — --accent(#c24721) 로 고치세요`);
  for (const match of rest.matchAll(/#[0-9a-f]{3,8}\b/gi))
    failures.push(`토큰 블록 밖 hex 색: ${match[0]} — var() 를 쓰세요`);
  for (const match of stripComments(source).matchAll(/min-width\s*:\s*(\d+)px/g)) {
    const px = Number(match[1]);
    if (!ALLOWED_BREAKPOINTS.has(px)) failures.push(`허용되지 않은 브레이크포인트 ${px}px (허용: 768·1024·1224)`);
  }
  if (hasScope && !/--accent\s*:\s*#c24721/i.test(tokens))
    failures.push("--accent 는 #c24721 이어야 합니다 (DES-PWA-003 §1.1)");
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = readFileSync(path.join(root, HOONDOK_CSS), "utf8");
  const failures = checkSource(source);
  if (failures.length) {
    console.error(failures.map((f) => `${HOONDOK_CSS}: ${f}`).join("\n"));
    process.exitCode = 1;
  } else console.log("훈독 CSS 스코프 통과 (:root 0 · 토큰 밖 hex 0 · 브레이크포인트 768/1024/1224 · #d4562e 0)");
}
