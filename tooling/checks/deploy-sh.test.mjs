// infra/oracle-vm/deploy-entry.sh · deploy.sh 동작 테스트.
// 가짜 docker·sudo·flock 을 PATH 앞에 두고 임시 HOME(= ~/truewords)에서 실제 스크립트를 돌린다.
// 운영 VM·네트워크·진짜 docker 를 건드리지 않는다. git 은 진짜를 쓴다(진입점의 main 조상 검사).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEPLOY_SH = path.join(root, "infra/oracle-vm/deploy.sh");
const ENTRY_SH = path.join(root, "infra/oracle-vm/deploy-entry.sh");
const PREFIX = "ghcr.io/woosung-dev/truewords";
const SHA = "1234567890abcdef1234567890abcdef12345678";
const TAG = SHA.slice(0, 12);
const OLD = "aaaaaaaa";

// 가짜 docker — 동작은 fixtures/fake-docker.sh 주석 참조.
const FAKE_DOCKER = readFileSync(path.join(root, "tooling/checks/fixtures/fake-docker.sh"), "utf8");

function writeExec(file, body) {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

/** 가짜 바이너리 디렉토리 + 상태 디렉토리. */
function fakes(base) {
  const bin = path.join(base, "fakebin");
  const state = path.join(base, "state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeExec(path.join(bin, "docker"), FAKE_DOCKER);
  writeExec(path.join(bin, "sudo"), '#!/bin/sh\nexec "$@"\n');
  writeExec(path.join(bin, "flock"), '#!/bin/sh\n[ -f "$FAKE_STATE/flock_busy" ] && exit 1\nexit 0\n');
  writeExec(
    path.join(state, "backup.sh"),
    '#!/bin/sh\necho backup >> "$FAKE_STATE/calls.log"\n[ ! -f "$FAKE_STATE/backup_fail" ]\n',
  );
  for (const name of ["calls.log", "images", "pullable", "unhealthy"]) writeFileSync(path.join(state, name), "");
  return { bin, state };
}

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(TW_|DEPLOY_|SSH_ORIGINAL_COMMAND|FAKE_STATE)/.test(key)) delete env[key];
  }
  return { ...env, ...extra };
}

const image = (ref, id, head = "") => `${ref}\t${id}\t${head}\n`;

/**
 * 운영 VM 흉내. 현재 세 서비스는 레지스트리 도입 전 이름(truewords-<svc>:aaaaaaaa)으로 떠 있다.
 */
function vm({ dbHead = "rev1", pullable = "", extraImages = "" } = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "truewords-deploy-sh-"));
  const home = path.join(base, "home");
  const tw = path.join(home, "truewords");
  mkdirSync(tw, { recursive: true });
  const { bin, state } = fakes(base);
  const envText = `POSTGRES_USER=tw\nBACKEND_TAG=${OLD}\nADMIN_TAG=${OLD}\nWEB_TAG=${OLD}\nGEMINI_API_KEY=secret-stays\n`;
  writeFileSync(path.join(tw, ".env"), envText, { mode: 0o600 });
  writeFileSync(path.join(tw, "preserve-images.txt"), "truewords-admin:30ca81f\n");
  writeFileSync(
    path.join(state, "images"),
    image(`truewords-backend:${OLD}`, "id-old-backend", "rev1") +
      image(`truewords-admin:${OLD}`, "id-old-admin") +
      image(`truewords-web:${OLD}`, "id-old-web") +
      extraImages,
  );
  writeFileSync(path.join(state, "pullable"), pullable);
  writeFileSync(path.join(state, "db_head"), `${dbHead}\n`);
  for (const svc of ["backend", "admin", "web"]) writeFileSync(path.join(state, `running_${svc}`), `truewords-${svc}:${OLD}\n`);

  const env = (extra = {}) =>
    cleanEnv({
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_STATE: state,
      DEPLOY_DISK_MAX_PCT: "101",
      DEPLOY_BACKUP_SCRIPT: path.join(state, "backup.sh"),
      ...extra,
    });
  return {
    base,
    tw,
    state,
    envText,
    run: (args, extra) => spawnSync("bash", [DEPLOY_SH, ...args], { env: env(extra), encoding: "utf8" }),
    entry: (command, extra) =>
      spawnSync("bash", [ENTRY_SH], { env: env({ SSH_ORIGINAL_COMMAND: command, ...extra }), encoding: "utf8" }),
    read: (file) => readFileSync(path.join(tw, file), "utf8"),
    calls: () => readFileSync(path.join(state, "calls.log"), "utf8"),
    running: (svc) => readFileSync(path.join(state, `running_${svc}`), "utf8").trim(),
    touch: (name, text = "") => writeFileSync(path.join(state, name), text),
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

const newImages = (backendHead = "rev1") =>
  image(`${PREFIX}-backend:${TAG}`, "id-new-backend", backendHead) +
  image(`${PREFIX}-admin:${TAG}`, "id-new-admin") +
  image(`${PREFIX}-web:${TAG}`, "id-new-web");

const ups = (calls) => [...calls.matchAll(/compose --env-file \.env up (.*)$/gm)].map((m) => m[1]);
const tagOf = (text, key) => text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1];

test("deploy: 이미지 pull → .env → backend→web 순서 교체, 기록·상태·파일 동기화", () => {
  const box = vm({ pullable: newImages() });
  try {
    const result = box.run(["deploy", SHA, "web", "backend"]);
    assert.equal(result.status, 0, result.stderr);
    const env = box.read(".env");
    assert.equal(tagOf(env, "BACKEND_TAG"), TAG);
    assert.equal(tagOf(env, "WEB_TAG"), TAG);
    assert.equal(tagOf(env, "ADMIN_TAG"), OLD); // 대상이 아닌 서비스는 그대로
    assert.match(env, /^GEMINI_API_KEY=secret-stays$/m); // 다른 줄은 보존
    assert.equal(box.read("preserve-images.txt"), "truewords-admin:30ca81f\n");

    const order = ups(box.calls());
    assert.equal(order.length, 2);
    assert.ok(order.every((args) => args.includes("--no-deps") && args.includes("--wait")), order.join("\n"));
    assert.match(order[0], /backend$/);
    assert.match(order[1], /web$/);
    assert.equal(box.running("backend"), `${PREFIX}-backend:${TAG}`);

    const log = box.read("deploy.log").trim().split("\n");
    assert.equal(log.length, 2);
    assert.match(log[0], /^\S+Z deploy backend 1234567890ab manual$/);
    assert.match(log[1], /^\S+Z deploy web 1234567890ab manual$/);

    const state = box.read("deploy-state/last-deploy.env");
    assert.match(state, /^STATUS=deployed$/m);
    assert.match(state, new RegExp(`^PREV_BACKEND_TAG=${OLD}$`, "m"));
    assert.match(state, /^MIGRATED=0$/m);
    assert.equal(box.read("deploy-state/synced-sha").trim(), SHA);
    // cron 이 부르는 파일이 checkout 에서 ~/truewords 로 동기화된다.
    assert.equal(box.read("docker-compose.yml"), readFileSync(path.join(root, "infra/oracle-vm/docker-compose.yml"), "utf8"));
    assert.ok(existsSync(path.join(box.tw, "ops-check.sh")));
    // 교체 대상이 아닌 admin 의 현재 이미지는 새 이름으로 재태그된다(compose 이미지 이름 전환 대비).
    assert.match(box.calls(), new RegExp(`docker tag truewords-admin:${OLD} ${PREFIX}-admin:${OLD}`));
  } finally {
    box.cleanup();
  }
});

test("deploy: DB 와 이미지 alembic head 가 다르면 --migrate 없이 종료 3, 아무것도 바꾸지 않는다", () => {
  const box = vm({ pullable: newImages("rev2"), dbHead: "rev1" });
  try {
    const result = box.run(["deploy", SHA, "backend", "web"]);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stdout, /MIGRATION_REQUIRED db=rev1 image=rev2/);
    assert.equal(box.read(".env"), box.envText);
    assert.deepEqual(ups(box.calls()), []);
    assert.ok(!existsSync(path.join(box.tw, "docker-compose.yml")), "게이트 전에 파일을 동기화하면 안 된다");
    assert.ok(!existsSync(path.join(box.tw, "deploy-state/last-deploy.env")));
    assert.ok(!existsSync(path.join(box.tw, "deploy.log")));
  } finally {
    box.cleanup();
  }
});

test("deploy --migrate: 백업 → 새 태그로 upgrade → head 확인 → 교체", () => {
  const box = vm({ pullable: newImages("rev2"), dbHead: "rev1" });
  try {
    const result = box.run(["deploy", SHA, "backend", "--migrate"]);
    assert.equal(result.status, 0, result.stderr);
    const calls = box.calls();
    assert.ok(calls.indexOf("backup") < calls.indexOf("migrate BACKEND_TAG="), "백업이 migration 보다 먼저");
    assert.match(calls, new RegExp(`migrate BACKEND_TAG=${TAG}`)); // .env 쓰기 전, 셸 env 로 새 태그
    assert.ok(calls.indexOf("migrate BACKEND_TAG=") < calls.indexOf("up -d"), "migration 이 교체보다 먼저");
    assert.equal(readFileSync(path.join(box.state, "db_head"), "utf8").trim(), "rev2");
    assert.match(box.read("deploy-state/last-deploy.env"), /^MIGRATED=1$/m);
  } finally {
    box.cleanup();
  }
});

test("deploy --migrate: 백업이 실패하면 migration·교체 없이 종료 1", () => {
  const box = vm({ pullable: newImages("rev2"), dbHead: "rev1" });
  try {
    box.touch("backup_fail");
    const result = box.run(["deploy", SHA, "backend", "--migrate"]);
    assert.equal(result.status, 1);
    assert.doesNotMatch(box.calls(), /migrate BACKEND_TAG/);
    assert.equal(tagOf(box.read(".env"), "BACKEND_TAG"), OLD);
  } finally {
    box.cleanup();
  }
});

test("deploy: pull 이 실패하면 .env 를 쓰지 않고 종료 1", () => {
  const box = vm({ pullable: image(`${PREFIX}-backend:${TAG}`, "id-new-backend", "rev1") }); // web 없음
  try {
    const result = box.run(["deploy", SHA, "backend", "web"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /web 이미지 .* 를 준비하지 못했다/);
    assert.equal(box.read(".env"), box.envText);
    assert.deepEqual(ups(box.calls()), []);
  } finally {
    box.cleanup();
  }
});

test("deploy: GHCR 에 없으면 레지스트리 도입 전 short sha 이미지를 재태그해 쓴다", () => {
  const box = vm({ extraImages: image(`truewords-web:${SHA.slice(0, 8)}`, "id-legacy-web") });
  try {
    const result = box.run(["deploy", SHA, "web"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(box.calls(), new RegExp(`docker tag truewords-web:${SHA.slice(0, 8)} ${PREFIX}-web:${TAG}`));
    assert.equal(box.running("web"), `${PREFIX}-web:${TAG}`);
  } finally {
    box.cleanup();
  }
});

test("deploy: 교체 후 검사가 실패하면 이전 태그로 복구하고 종료 5", () => {
  const box = vm({ pullable: newImages() });
  try {
    box.touch("unhealthy", `${PREFIX}-web:${TAG}\n`);
    const result = box.run(["deploy", SHA, "backend", "web"]);
    assert.equal(result.status, 5, result.stderr);
    const env = box.read(".env");
    assert.equal(tagOf(env, "BACKEND_TAG"), OLD);
    assert.equal(tagOf(env, "WEB_TAG"), OLD);
    assert.equal(box.running("backend"), `${PREFIX}-backend:${OLD}`);
    assert.equal(box.running("web"), `${PREFIX}-web:${OLD}`);
    const log = box.read("deploy.log");
    assert.match(log, new RegExp(`rollback backend ${OLD} auto-restore`));
    assert.match(log, new RegExp(`rollback web ${OLD} auto-restore`));
    assert.doesNotMatch(log, / deploy /);
    assert.match(box.read("deploy-state/last-deploy.env"), /^STATUS=restored$/m);
  } finally {
    box.cleanup();
  }
});

test("deploy: 컨테이너 안 HTTP 검사 실패도 교체 실패로 보고 복구한다", () => {
  const box = vm({ pullable: newImages() });
  try {
    box.touch("http_fail_web");
    const result = box.run(["deploy", SHA, "web"]);
    // 복구한 이전 web 도 같은 HTTP 검사에 걸리므로 복구 실패(6)가 정확한 판정이다.
    assert.equal(result.status, 6, result.stderr);
    assert.match(result.stderr, /http:\/\/web:3000\/login 실패/);
  } finally {
    box.cleanup();
  }
});

test("deploy: 복구할 이전 이미지가 없으면 종료 6", () => {
  const box = vm({ pullable: newImages() });
  try {
    // 이전 web 이미지를 지운다 — 재태그할 원본이 없다.
    writeFileSync(
      path.join(box.state, "images"),
      readFileSync(path.join(box.state, "images"), "utf8")
        .split("\n")
        .filter((line) => !line.startsWith(`truewords-web:${OLD}`))
        .join("\n"),
    );
    box.touch("unhealthy", `${PREFIX}-web:${TAG}\n`);
    const result = box.run(["deploy", SHA, "web"]);
    assert.equal(result.status, 6, result.stderr);
    assert.match(box.read("deploy-state/last-deploy.env"), /^STATUS=restore_failed$/m);
  } finally {
    box.cleanup();
  }
});

test("deploy --migrate 후 교체 검사가 실패하면 자동 롤백하지 않고 종료 1", () => {
  const box = vm({ pullable: newImages("rev2"), dbHead: "rev1" });
  try {
    box.touch("unhealthy", `${PREFIX}-web:${TAG}\n`);
    const result = box.run(["deploy", SHA, "backend", "web", "--migrate"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /자동 롤백하지 않는다/);
    assert.equal(tagOf(box.read(".env"), "BACKEND_TAG"), TAG);
    assert.doesNotMatch(box.calls(), new RegExp(`up .*backend[\\s\\S]*up .*backend`)); // backend 재교체 없음
    assert.match(box.read("deploy-state/last-deploy.env"), /^STATUS=failed_after_migration$/m);
  } finally {
    box.cleanup();
  }
});

test("rollback: 직전 deploy 를 이전 태그로 되돌리고, 두 번째는 거부한다", () => {
  const box = vm({ pullable: newImages() });
  try {
    assert.equal(box.run(["deploy", SHA, "backend", "web"]).status, 0);
    const first = box.run(["rollback"], { DEPLOY_MODE: "auto" });
    assert.equal(first.status, 0, first.stderr);
    const env = box.read(".env");
    assert.equal(tagOf(env, "BACKEND_TAG"), OLD);
    assert.equal(tagOf(env, "WEB_TAG"), OLD);
    assert.equal(box.running("web"), `${PREFIX}-web:${OLD}`);
    assert.match(box.read("deploy.log"), new RegExp(`rollback web ${OLD} auto`));
    const second = box.run(["rollback"]);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /되돌릴 배포가 없다/);
  } finally {
    box.cleanup();
  }
});

test("rollback: migration 이 포함된 배포는 거부한다", () => {
  const box = vm({ pullable: newImages("rev2"), dbHead: "rev1" });
  try {
    assert.equal(box.run(["deploy", SHA, "backend", "--migrate"]).status, 0);
    const result = box.run(["rollback"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /migration 이 적용된 배포는 자동 롤백하지 않는다/);
    assert.equal(tagOf(box.read(".env"), "BACKEND_TAG"), TAG);
  } finally {
    box.cleanup();
  }
});

test("pin: 지정 태그(레지스트리 도입 전 이름)로 교체하고 rollback manual 로 기록", () => {
  const box = vm({ extraImages: image("truewords-web:9999999", "id-older-web") });
  try {
    const result = box.run(["pin", "web", "9999999"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(tagOf(box.read(".env"), "WEB_TAG"), "9999999");
    assert.match(box.read("deploy.log"), /rollback web 9999999 manual$/m);
    assert.ok(!existsSync(path.join(box.tw, "docker-compose.yml")), "pin 은 파일을 동기화하지 않는다");
  } finally {
    box.cleanup();
  }
});

test("status: 기계가 읽는 KEY=VALUE 줄만 stdout 에 낸다", () => {
  const box = vm();
  try {
    const result = box.run(["status"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout,
      `BACKEND_TAG=${OLD}\nADMIN_TAG=${OLD}\nWEB_TAG=${OLD}\nSYNCED_SHA=\nLAST_STATUS=\n`,
    );
  } finally {
    box.cleanup();
  }
});

test("디스크 기준을 넘으면 아무것도 하지 않고 종료 1", () => {
  const box = vm({ pullable: newImages() });
  try {
    const result = box.run(["deploy", SHA, "web"], { DEPLOY_DISK_MAX_PCT: "0" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /디스크/);
    assert.equal(box.read(".env"), box.envText);
    assert.doesNotMatch(box.calls(), /pull/);
  } finally {
    box.cleanup();
  }
});

test("인자 오류는 종료 2, 잠금 점유는 종료 4", () => {
  const box = vm({ pullable: newImages() });
  try {
    for (const args of [
      [],
      ["deploy", "abc", "web"],
      ["deploy", SHA],
      ["deploy", SHA, "db"],
      ["deploy", SHA.toUpperCase(), "web"],
      ["pin", "web", "not-a-tag"],
      ["pin", "db", OLD],
      ["status", "extra"],
      ["frobnicate"],
    ]) {
      assert.equal(box.run(args).status, 2, `args=${JSON.stringify(args)}`);
    }
    box.touch("flock_busy");
    const busy = box.run(["deploy", SHA, "web"]);
    assert.equal(busy.status, 4);
    assert.equal(box.read(".env"), box.envText);
  } finally {
    box.cleanup();
  }
});

// ── deploy-entry.sh ────────────────────────────────────────────────────────

/** origin: main = A → B, side = C(A 에서 갈라짐, 미머지). 각 커밋의 deploy.sh 는 자기 이름과 인자를 출력한다. */
function entryFixture() {
  const box = vm();
  const origin = path.join(box.base, "origin");
  mkdirSync(path.join(origin, "infra/oracle-vm"), { recursive: true });
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: gitEnv }).trim();
  const commit = (name) => {
    writeFileSync(
      path.join(origin, "infra/oracle-vm/deploy.sh"),
      `#!/usr/bin/env bash\necho "STUB ${name} args=$* mode=$DEPLOY_MODE lock=\${TW_DEPLOY_LOCK_HELD:-} action=\${DEPLOY_ACTION:-}"\n`,
    );
    git(origin, "add", "-A");
    git(origin, "commit", "-qm", name);
    return git(origin, "rev-parse", "HEAD");
  };
  git(origin, "init", "-q", "-b", "main");
  const a = commit("A");
  const b = commit("B");
  git(origin, "checkout", "-q", "-b", "side", a);
  const c = commit("C");
  git(origin, "checkout", "-q", "main");
  const repo = path.join(box.tw, "repo");
  execFileSync("git", ["clone", "-q", origin, repo], { env: gitEnv });
  git(repo, "fetch", "-q", "origin", "side"); // C 객체가 로컬에 있어도 main 밖이면 거부해야 한다
  git(repo, "checkout", "-q", "--detach", a);
  return { box, a, b, c, head: () => git(repo, "rev-parse", "HEAD") };
}

test("entry: 허용 형식 밖의 명령은 부작용 전에 종료 2", () => {
  const { box, a } = entryFixture();
  try {
    for (const command of [
      "",
      "status; id",
      "status\nid",
      " status",
      "rollback now",
      `deploy ${SHA.slice(0, 12)} web`,
      `deploy ${SHA}`,
      `deploy ${SHA} db`,
      `deploy ${SHA} web; id`,
      `deploy ${SHA} web --migrate --migrate`,
      `deploy ${SHA.toUpperCase()} web`,
      `deploy $(id) web`,
      `sync ${SHA} web`,
      "pin web aaaaaaaa", // pin 은 사람(일반 ssh) 전용
      "ops-status; id",
      "ops-status\nid",
      "ops-status /etc/shadow",
      " ops-status",
      "bash",
    ]) {
      const result = box.entry(command);
      assert.equal(result.status, 2, `command=${JSON.stringify(command)}`);
      assert.doesNotMatch(result.stdout, /STUB/);
    }
    assert.ok(!existsSync(path.join(box.tw, ".deploy.lock")), "거부된 명령이 잠금 파일을 만들었다");
    assert.equal(a.length, 40);
  } finally {
    box.cleanup();
  }
});

test("entry: status 는 현재 체크아웃의 deploy.sh 를 잠금 없이 auto 로 실행한다", () => {
  const { box } = entryFixture();
  try {
    const result = box.entry("status");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "STUB A args=status mode=auto lock= action=");
  } finally {
    box.cleanup();
  }
});

test("entry: ops-status 는 상태 JSON 만 출력하고 잠금·체크아웃·deploy.sh 를 건드리지 않는다", () => {
  const { box, a, head } = entryFixture();
  try {
    const statusFile = path.join(box.base, "ops-status.json");
    const json = '{"checked_at":"2026-10-02T18:45:00Z","failures":0,"checks":[]}\n';
    writeFileSync(statusFile, json);
    box.touch("flock_busy"); // 배포 중에도 읽혀야 한다
    const result = box.entry("ops-status", { OPS_STATUS_FILE: statusFile });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, json);
    assert.ok(!existsSync(path.join(box.tw, ".deploy.lock")), "ops-status 가 잠금 파일을 만들었다");
    assert.equal(head(), a);

    const missing = box.entry("ops-status", { OPS_STATUS_FILE: path.join(box.base, "none.json") });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /ops-status 파일을 읽지 못했다/);
  } finally {
    box.cleanup();
  }
});

test("entry: deploy 는 main 의 정확한 sha 로 체크아웃한 뒤 그 sha 의 deploy.sh 를 실행한다", () => {
  const { box, b, head } = entryFixture();
  try {
    const result = box.entry(`deploy ${b} backend web --migrate`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `STUB B args=deploy ${b} backend web --migrate mode=auto lock=1 action=`);
    assert.equal(head(), b);
  } finally {
    box.cleanup();
  }
});

test("entry: main 밖의 커밋(포크·PR 브랜치)은 체크아웃하지 않고 종료 2", () => {
  const { box, a, c, head } = entryFixture();
  try {
    const result = box.entry(`deploy ${c} web`);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /origin\/main 에 들어간 커밋이 아니다/);
    assert.equal(head(), a);
  } finally {
    box.cleanup();
  }
});

test("entry: 다른 배포가 잠금을 쥐고 있으면 종료 4 (status 는 계속 동작)", () => {
  const { box, b, a, head } = entryFixture();
  try {
    box.touch("flock_busy");
    assert.equal(box.entry(`deploy ${b} web`).status, 4);
    assert.equal(head(), a);
    assert.equal(box.entry("status").status, 0);
  } finally {
    box.cleanup();
  }
});
