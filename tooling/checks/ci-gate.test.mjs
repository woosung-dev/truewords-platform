import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateCiGate } from "./ci-gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHA = "c863615e061d316dae44d3755768f5e0078bd1f9";
const OTHER = "17d97bbc0000000000000000000000000000beef";

// 실제 API 응답(2026-09-28 c863615e)과 같은 모양의 run.
const run = (id, extra = {}) => ({
  id,
  run_attempt: 1,
  status: "completed",
  conclusion: "success",
  event: "push",
  head_branch: "main",
  head_sha: SHA,
  html_url: `https://github.com/woosung-dev/truewords-platform/actions/runs/${id}`,
  ...extra,
});
const gate = (runs, rollback = false) =>
  evaluateCiGate({ sha: SHA, response: { total_count: runs.length, workflow_runs: runs }, rollback });

test("최신 실행이 성공이면 통과한다", () => {
  const result = gate([run(100)]);
  assert.equal(result.ok, true);
  assert.match(result.message, /runs\/100/);
});

test("진행 중·대기 중이면 끝난 뒤 다시 실행하라고 멈춘다", () => {
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    const result = gate([run(100, { status, conclusion: null })]);
    assert.equal(result.ok, false, status);
    assert.equal(result.pending, true, status);
    assert.match(result.message, /CI 가 아직 끝나지 않았다 — 끝난 뒤 다시 실행/);
  }
});

test("실패·취소는 실행 URL 을 담아 멈춘다", () => {
  for (const conclusion of ["failure", "cancelled", "timed_out", "skipped"]) {
    const result = gate([run(100, { conclusion })]);
    assert.equal(result.ok, false, conclusion);
    assert.equal(result.pending, false, conclusion);
    assert.match(result.message, new RegExp(`CI 가 ${conclusion} 로 끝났다`));
    assert.match(result.message, /actions\/runs\/100/);
  }
});

test("main push 실행이 없으면 멈춘다 — PR·수동 실행·다른 sha 는 근거가 아니다", () => {
  assert.equal(gate([]).ok, false);
  const others = [
    run(101, { event: "pull_request" }),
    run(102, { event: "workflow_dispatch" }),
    run(103, { head_branch: "dev/x" }),
    run(104, { head_sha: OTHER }),
  ];
  const result = gate(others);
  assert.equal(result.ok, false);
  assert.match(result.message, /main push 로 돈 CI 실행이 없다/);
});

test("최신 실행만 본다 — 예전 성공이 있어도 최신이 실패면 멈춘다", () => {
  const runs = [run(100), run(200, { conclusion: "failure" })]; // API 순서에 기대지 않는다
  const result = gate(runs);
  assert.equal(result.ok, false);
  assert.match(result.message, /runs\/200/);
});

test("rollback 은 최신이 아니어도 성공한 실행 하나면 통과한다", () => {
  const runs = [run(200, { conclusion: "failure" }), run(100)];
  const result = gate(runs, true);
  assert.equal(result.ok, true);
  assert.match(result.message, /rollback.*runs\/100/);
  // 성공이 하나도 없으면 rollback 도 멈춘다.
  const failed = gate([run(200, { conclusion: "cancelled" })], true);
  assert.equal(failed.ok, false);
  assert.match(failed.message, /성공한 실행이 하나도 없다/);
  assert.equal(gate([], true).ok, false);
});

test("재실행은 같은 run 의 최신 시도로 판정한다", () => {
  // 실패 뒤 재실행해 성공 — run 객체가 최신 시도의 결과를 갖는다.
  const rerun = gate([run(100, { run_attempt: 2 })]);
  assert.equal(rerun.ok, true);
  assert.match(rerun.message, /재실행 2회차/);
  // 성공한 run 을 다시 돌리는 중이면 끝날 때까지 기다린다.
  const running = gate([run(100, { run_attempt: 3, status: "in_progress", conclusion: null })]);
  assert.equal(running.ok, false);
  assert.equal(running.pending, true);
});

test("형식이 틀린 입력은 통과시키지 않는다", () => {
  assert.throws(() => evaluateCiGate({ sha: SHA, response: { message: "Not Found" }, rollback: false }));
  assert.throws(() => evaluateCiGate({ sha: SHA.slice(0, 12), response: { workflow_runs: [] }, rollback: false }));
});

test("CLI: 실패는 ::error:: 와 종료 1, 성공은 종료 0", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "truewords-ci-gate-"));
  try {
    const cli = (runs, ...flags) => {
      const file = path.join(dir, "runs.json");
      writeFileSync(file, JSON.stringify({ total_count: runs.length, workflow_runs: runs }));
      return spawnSync(
        process.execPath,
        [path.join(root, "tooling/checks/ci-gate.mjs"), "--sha", SHA, "--runs", file, ...flags],
        { encoding: "utf8" },
      );
    };
    const red = cli([run(100, { conclusion: "failure" })]);
    assert.equal(red.status, 1, red.stdout);
    assert.match(red.stderr, /::error::.*actions\/runs\/100/);
    assert.equal(cli([run(100)]).status, 0);
    assert.equal(cli([run(200, { conclusion: "failure" }), run(100)], "--rollback").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
