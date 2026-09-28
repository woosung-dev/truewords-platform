import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// AGENTS.md 가 작업 기록장으로 자라지 않게 막는다 (루트 AGENTS.md "AGENTS.md 작성 기준").
// 기능 PR 마다 계획 ID·Phase·계획 문서 링크를 한 줄에 덧붙이던 패턴을 기계적으로 잡는다.
// `next dev` 가 다시 써 넣는 nextjs-agent-rules 블록은 우리 문장이 아니므로 검사하지 않는다.
const root = fileURLToPath(new URL("../../", import.meta.url));
export const MAX_LINE = 300;
const RULES = [
  [/PLAN-[A-Z]+-\d+/, "계획 ID"],
  [/\bPhase \d/, "Phase 표기"],
  [/docs\/plans\//, "계획 문서 링크"],
];
const BLOCK_BEGIN = "<!-- BEGIN:nextjs-agent-rules -->";
const BLOCK_END = "<!-- END:nextjs-agent-rules -->";

/** git 이 보는 AGENTS.md (추적 + 무시되지 않은 미추적). 레포 상대 posix 경로. */
export function listAgentsFiles(rootDir) {
  const output = execFileSync(
    "git",
    ["-C", rootDir, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*AGENTS.md"],
    { encoding: "utf8" },
  );
  return output.split("\0").filter((file) => path.posix.basename(file) === "AGENTS.md");
}

export function checkSource(source) {
  const failures = [];
  let inBlock = false;
  source.split("\n").forEach((line, index) => {
    if (line.trim() === BLOCK_BEGIN) inBlock = true;
    if (!inBlock) {
      for (const [pattern, label] of RULES) {
        const match = line.match(pattern);
        if (match)
          failures.push(`${index + 1}행: ${label} "${match[0]}" — 기록은 스펙·PR 에 두고 AGENTS.md 에는 규칙만 쓴다`);
      }
      if (line.length > MAX_LINE)
        failures.push(`${index + 1}행: ${line.length}자 (최대 ${MAX_LINE}) — 한 줄에 한 규칙만 쓴다`);
    }
    if (line.trim() === BLOCK_END) inBlock = false;
  });
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = listAgentsFiles(root);
  const failures = files.flatMap((file) =>
    checkSource(readFileSync(path.join(root, file), "utf8")).map((f) => `${file}: ${f}`),
  );
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log(`AGENTS.md 기준 통과 (${files.length}개 파일 · 계획 ID·Phase·계획 링크 0 · 줄 ≤ ${MAX_LINE}자)`);
}
