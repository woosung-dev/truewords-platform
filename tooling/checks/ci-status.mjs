import { pathToFileURL } from "node:url";

export function checkCiStatus(needs) {
  const failures = [];
  for (const name of ["changes", "repository"]) {
    if (needs[name]?.result !== "success") failures.push(`${name} must succeed`);
  }
  const flags = needs.changes?.outputs ?? {};
  for (const [job, flag] of Object.entries({
    "backend-test": "api", "frontend-test": "admin", "web-test": "web", contracts: "contracts",
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
