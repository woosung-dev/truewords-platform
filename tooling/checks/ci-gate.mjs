// 수동 배포의 CI 게이트 — 배포할 sha 에 main push 로 돈 CI 가 성공했는지 본다.
//
// release.yml 의 meta job 이 workflow_dispatch 일 때만 부른다(workflow_run 은 이벤트가 이미 CI 성공을 보장한다):
//   gh api "repos/<owner>/<repo>/actions/workflows/ci.yml/runs?head_sha=<sha>&event=push&branch=main" > runs.json
//   node tooling/checks/ci-gate.mjs --sha <40자> --runs runs.json [--rollback]
//
// 근거는 check-run(`CI Required`)이 아니라 CI 워크플로의 run 이다. check-run 이름은 다른 워크플로·앱과
// 겹칠 수 있지만, run 은 워크플로 파일·이벤트·브랜치로 어느 실행이 근거인지 분명하다. CI Required 가
// always() 로 모든 job 을 판정하므로 워크플로 결론이 success 면 CI Required 도 success 다.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SHA40 = /^[0-9a-f]{40}$/;

/**
 * @param {object} input
 * @param {string} input.sha 배포할 커밋(40자)
 * @param {unknown} input.response Actions "list workflow runs" 응답 JSON
 * @param {boolean} input.rollback 의도한 되돌리기면 최신 실행이 아니어도 성공한 실행 하나로 충분하다
 * @returns {{ok: boolean, pending: boolean, message: string}}
 */
export function evaluateCiGate({ sha, response, rollback }) {
  if (!SHA40.test(sha)) throw new Error(`sha 는 40자 hex 여야 한다: ${sha}`);
  const list = /** @type {{workflow_runs?: unknown}} */ (response)?.workflow_runs;
  if (!Array.isArray(list)) throw new Error("응답에 workflow_runs 배열이 없다 — API 오류로 보고 중단한다");
  const short = sha.slice(0, 12);
  // API 필터를 다시 확인한다. 같은 sha 를 PR·수동 실행으로 돌린 CI 는 근거가 아니다.
  // 재실행은 run id 를 유지하고 상태만 최신 시도로 바뀌므로, id 가 가장 큰 run 이 가장 최근 실행이다.
  const runs = list
    .filter((run) => run?.head_sha === sha && run?.event === "push" && run?.head_branch === "main")
    .sort((a, b) => b.id - a.id);
  const describe = (run) => `${run.html_url}${run.run_attempt > 1 ? ` (재실행 ${run.run_attempt}회차)` : ""}`;
  const passed = (run) => run.status === "completed" && run.conclusion === "success";

  if (runs.length === 0) {
    return {
      ok: false,
      pending: false,
      message: `${short} 에 main push 로 돈 CI 실행이 없다 — CI 가 성공한 main 커밋만 배포한다`,
    };
  }
  if (rollback) {
    const success = runs.find(passed);
    if (success) return { ok: true, pending: false, message: `${short} CI 성공 확인(rollback): ${describe(success)}` };
  }
  const latest = runs[0];
  if (latest.status !== "completed") {
    return {
      ok: false,
      pending: true,
      message: `CI 가 아직 끝나지 않았다 — 끝난 뒤 다시 실행 (${latest.status}: ${describe(latest)})`,
    };
  }
  if (passed(latest)) return { ok: true, pending: false, message: `${short} CI 성공 확인: ${describe(latest)}` };
  return {
    ok: false,
    pending: false,
    message: `${short} 의 CI 가 ${latest.conclusion} 로 끝났다${rollback ? "(성공한 실행이 하나도 없다)" : ""} — 초록인 커밋만 배포한다: ${describe(latest)}`,
  };
}

function main(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const runsFile = value("--runs");
  if (!runsFile) throw new Error("--runs <파일> 이 필요하다");
  const result = evaluateCiGate({
    sha: value("--sha") ?? "",
    response: JSON.parse(readFileSync(runsFile, "utf8")),
    rollback: argv.includes("--rollback"),
  });
  if (result.ok) {
    console.log(result.message);
  } else {
    console.error(`::error::${result.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
