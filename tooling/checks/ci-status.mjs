import { pathToFileURL } from "node:url";

// 이 파일이 규칙을 아는 job. ci.yml 의 required.needs 에 job 을 추가하면 여기에도 규칙을 적어야 한다.
const KNOWN_JOBS = new Set(["changes", "repository", "backend-test", "frontend-test", "web-test", "contracts", "e2e"]);

export function checkCiStatus(needs) {
  const failures = [];
  for (const name of ["changes", "repository"]) {
    if (needs[name]?.result !== "success") failures.push(`${name} must succeed`);
  }
  // 규칙이 없는 job 은 성공만 허용한다. 목록 갱신을 잊은 채 새 job 의 실패·skip 이 조용히 통과하는 것을 막는다.
  for (const [job, info] of Object.entries(needs)) {
    if (!KNOWN_JOBS.has(job) && info?.result !== "success") {
      failures.push(`${job}: ${info?.result} (ci-status.mjs 에 규칙이 없는 job — 성공만 허용)`);
    }
  }
  const flags = needs.changes?.outputs ?? {};
  for (const [job, flag] of Object.entries({
    "backend-test": "api",
    "frontend-test": "admin",
    "web-test": "web",
    contracts: "contracts",
  })) {
    if (!["true", "false"].includes(flags[flag])) failures.push(`missing ${flag} output`);
    const expected = flags[flag] === "true" ? ["success"] : ["success", "skipped"];
    if (!expected.includes(needs[job]?.result)) failures.push(`${job}: ${needs[job]?.result}`);
  }
  const requiresE2e = [flags.api, flags.web, flags.admin].includes("true");
  if (!(requiresE2e ? ["success"] : ["success", "skipped"]).includes(needs.e2e?.result)) {
    failures.push(`e2e: ${needs.e2e?.result}`);
  }
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkCiStatus(JSON.parse(process.env.CI_NEEDS ?? "{}"));
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("모든 필수 검사 통과(허용된 변경 범위 skip 포함)");
}
