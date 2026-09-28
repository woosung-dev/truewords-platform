import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkSource, listAgentsFiles, MAX_LINE } from "./agents-md.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("규칙만 적힌 문서는 통과한다", () => {
  assert.deepEqual(checkSource("# 앱\n\n- 서비스워커는 인증 응답을 캐시하지 않는다.\n"), []);
});

test("계획 ID·Phase·계획 문서 링크를 행 번호와 함께 잡는다", () => {
  const failures = checkSource("# 앱\n- 알림(PLAN-HD-006)\n- Phase 2 인증\n- [계획](../../docs/plans/active/x.md)\n");
  assert.equal(failures.length, 3);
  assert.match(failures[0], /^2행: 계획 ID "PLAN-HD-006"/);
  assert.match(failures[1], /^3행: Phase 표기/);
  assert.match(failures[2], /^4행: 계획 문서 링크/);
});

test(`${MAX_LINE}자를 넘는 줄을 잡는다`, () => {
  assert.deepEqual(checkSource("가".repeat(MAX_LINE)), []);
  assert.match(checkSource("가".repeat(MAX_LINE + 1))[0], new RegExp(`${MAX_LINE + 1}자`));
});

test("next dev 가 넣는 nextjs-agent-rules 블록은 검사하지 않는다", () => {
  const block = `<!-- BEGIN:nextjs-agent-rules -->\n${"x".repeat(MAX_LINE + 50)} Phase 1\n<!-- END:nextjs-agent-rules -->`;
  assert.deepEqual(checkSource(`# 앱\n\n${block}\n`), []);
  assert.equal(checkSource(`${block}\n- Phase 3 뒤에 붙인 기록\n`).length, 1); // 블록 뒤는 다시 검사한다
});

test("레포의 AGENTS.md 가 전부 기준을 지킨다", () => {
  const files = listAgentsFiles(root);
  assert.ok(files.includes("AGENTS.md") && files.includes("apps/web/AGENTS.md"), "AGENTS.md 목록을 찾지 못했다");
  for (const file of files) assert.deepEqual(checkSource(readFileSync(path.join(root, file), "utf8")), [], file);
});
