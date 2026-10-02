import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReport, mask, STALE_HOURS, TITLE_PREFIX } from "./ops-alert-report.mjs";

const NOW = Date.parse("2026-10-02T19:20:00Z");
const status = (checks, checkedAt = "2026-10-02T18:45:03Z") =>
  JSON.stringify({ checked_at: checkedAt, failures: 0, checks });
const ok = (name, detail = "") => ({ name, verdict: "OK", detail });
const report = (text, extra = {}) => buildReport({ ssh: "success", rc: "0", text, now: NOW, ...extra });

test("전부 OK 면 state=ok — 이 워크플로가 연 이슈만 닫을 근거", () => {
  const result = report(status([ok("backup", "8h 전"), ok("disk", "40% 사용")]));
  assert.equal(result.state, "ok");
  assert.match(result.body, /2건 정상/);
});

test("FAIL·WARN 항목을 DETAIL 과 함께 알리되 버킷·키 지문·OCID·IP 는 가린다", () => {
  const result = report(
    status([
      ok("disk", "40%"),
      {
        name: "backup-remote",
        verdict: "FAIL",
        detail: "Object Storage 사본을 확인하지 못했다 — 버킷 truewords-backups / 정책 확인",
      },
      {
        name: "gemini-key",
        verdict: "FAIL",
        detail: "embed 0.50s · key sha8=deadbeef · tier=paid · ocid1.tenancy.oc1..aaaa",
      },
      { name: "hoondok-today", verdict: "WARN", detail: "오늘 편성 없음 (host 10.0.0.12)" },
      { name: "hoondok-push", verdict: "SKIP", detail: "push_subscriptions 를 읽지 못했다" },
    ]),
  );
  assert.equal(result.state, "alert");
  assert.equal(result.title, `${TITLE_PREFIX} — FAIL 2 · WARN 1`);
  assert.match(result.body, /`backup-remote` \*\*FAIL\*\* — Object Storage/);
  assert.match(result.body, /`hoondok-push` SKIP/);
  assert.doesNotMatch(result.body, /`disk`/);
  for (const secret of ["truewords-backups", "deadbeef", "tenancy.oc1", "10.0.0.12"]) {
    assert.ok(!result.body.includes(secret), `${secret} 가 본문에 남았다`);
  }
  assert.match(result.body, /embed 0\.50s/, "숫자 지표는 IP 로 오인해 가리지 않는다");
});

test("결과가 오지 않은 경우를 구분한다 — ssh 설정·접속·읽기·형식·낡음", () => {
  assert.match(buildReport({ ssh: "failure", rc: "", text: null, now: NOW }).title, /ssh 설정 실패/);
  const unreachable = buildReport({ ssh: "success", rc: "255", text: null, now: NOW });
  assert.match(unreachable.title, /VM 에 닿지 못함/);
  assert.match(buildReport({ ssh: "success", rc: "1", text: "", now: NOW }).title, /ops-status 를 읽지 못함/);
  for (const text of [
    "",
    "not json {",
    "{}",
    JSON.stringify({ checked_at: "어제", checks: [] }),
    status([{ name: 1 }]),
  ]) {
    const parse = report(text);
    assert.match(parse.title, /결과 JSON 을 읽지 못함/, text);
    assert.ok(!text || !parse.body.includes(text), "원문을 본문에 옮기지 않는다");
  }
  const stale = report(status([ok("backup")], new Date(NOW - (STALE_HOURS + 1) * 3_600_000).toISOString()));
  assert.match(stale.title, /결과가 낡음 \(27시간 전\)/);
  const fresh = report(status([ok("backup")], new Date(NOW - (STALE_HOURS - 1) * 3_600_000).toISOString()));
  assert.equal(fresh.state, "ok");
});

test("제목은 모두 '[ops-alert] VM 점검' 으로 시작하고 cache-cleanup 이슈 제목과 겹치지 않는다", () => {
  const cacheCleanup = readFileSync(new URL("../../.github/workflows/cache-cleanup.yml", import.meta.url), "utf8");
  const other = cacheCleanup.match(/TITLE="(\[ops-alert\][^"]*)"/)?.[1];
  assert.ok(other, "cache-cleanup.yml 의 이슈 제목을 찾지 못했다");
  assert.ok(!other.startsWith(TITLE_PREFIX));
  for (const result of [report("x"), buildReport({ ssh: "success", rc: "255", text: null, now: NOW })]) {
    assert.ok(result.title.startsWith(TITLE_PREFIX));
  }
});

test("ops-alert.yml 의 이슈 검색·닫기 접두사가 판정 스크립트와 같고, run: 에 ${{ }} 를 쓰지 않는다", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/ops-alert.yml", import.meta.url), "utf8");
  assert.equal(workflow.split(`startswith("${TITLE_PREFIX}")`).length - 1, 2);
  assert.match(workflow, new RegExp(`PREFIX: "${TITLE_PREFIX.replace(/[[\]]/g, "\\$&")}"`));
  // run 블록(같은 들여쓰기의 다음 키 전까지)에 표현식이 끼면 출력값이 셸 코드로 해석될 수 있다.
  const lines = workflow.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)run: \|/);
    if (!match) continue;
    for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || lines[j].search(/\S/) > match[1].length); j++) {
      assert.ok(!lines[j].includes("${{"), `run 블록 ${j + 1}행에 표현식이 있다`);
    }
  }
});

test("mask 는 여러 줄 DETAIL 을 한 줄로 만든다(마크다운 목록이 깨지지 않게)", () => {
  assert.equal(mask("a\nb"), "a b");
});

test("CLI: GITHUB_OUTPUT 에 state·title·여러 줄 body 를 쓴다", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "truewords-ops-alert-"));
  try {
    const file = path.join(dir, "ops.json");
    const out = path.join(dir, "out");
    writeFileSync(file, status([{ name: "disk", verdict: "FAIL", detail: "95%" }], new Date().toISOString()));
    writeFileSync(out, "");
    const result = spawnSync(
      process.execPath,
      [new URL("./ops-alert-report.mjs", import.meta.url).pathname, "--file", file, "--ssh", "success", "--rc", "0"],
      { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: out, RUN_URL: "https://example.test/run/1" } },
    );
    assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(out, "utf8");
    assert.match(text, /^state=alert$/m);
    assert.match(text, /^title=\[ops-alert\] VM 점검 — FAIL 1$/m);
    assert.match(
      text,
      /\nbody<<(EOF_[0-9a-f]{16})\n[\s\S]*`disk` \*\*FAIL\*\* — 95%[\s\S]*실행: https:\/\/example\.test\/run\/1\n[^\n]*\n\1\n$/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
