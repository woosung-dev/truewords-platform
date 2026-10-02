import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ALL_SERVICES_PATHS, matches, parseStatus, planDeploy, SERVICE_PATHS } from "./deploy-services.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 임시 저장소. commit(files) 는 파일을 쓰고 커밋한 뒤 sha 를 돌려준다. */
function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "truewords-deploy-services-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const run = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
  run("init", "-q", "-b", "main");
  let counter = 0;
  const commit = (files) => {
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), `${counter++}\n`);
    }
    run("add", "-A");
    run("commit", "-qm", files.join(","));
    return run("rev-parse", "HEAD");
  };
  const git = (args) => {
    try {
      return {
        ok: true,
        out: execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      };
    } catch {
      return { ok: false, out: "" };
    }
  };
  return { dir, commit, git, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const status = (tag, extra = {}) => ({ BACKEND_TAG: tag, ADMIN_TAG: tag, WEB_TAG: tag, ...extra });
const short = (sha) => sha.slice(0, 8); // 운영 .env 의 옛 8자 태그도 그대로 해석돼야 한다

test("서비스별로 이미지 입력이 바뀐 것만 고른다", () => {
  const r = repo();
  try {
    const base = r.commit(["apps/api/main.py", "apps/web/page.tsx", "apps/admin/page.tsx", "docs/a.md"]);
    const synced = { SYNCED_SHA: base };
    const plan = (files) =>
      planDeploy({ sha: r.commit(files), status: status(short(base), synced), rollback: false, git: r.git });

    assert.deepEqual(plan(["apps/web/page.tsx"]).services, ["web"]);
    // 커밋이 쌓여도 비교 기준은 운영 태그다 — 이전 커밋의 web 변경도 여전히 포함된다.
    assert.deepEqual(plan(["apps/api/main.py"]).services, ["backend", "web"]);
  } finally {
    r.cleanup();
  }
});

test("공유 입력·compose 는 여러 서비스, 문서·도구는 배포하지 않는다", () => {
  const r = repo();
  try {
    const base = r.commit(["apps/api/main.py", "docs/a.md"]);
    const st = status(base, { SYNCED_SHA: base });
    const services = (files) => {
      r.run("checkout", "-q", "--detach", base);
      return planDeploy({ sha: r.commit(files), status: st, rollback: false, git: r.git });
    };
    assert.deepEqual(services(["docs/a.md", "tooling/checks/x.mjs", ".github/workflows/ci.yml", "Makefile"]), {
      services: [],
      sync: false,
      reasons: {},
      errors: [],
    });
    assert.deepEqual(services(["pnpm-lock.yaml"]).services, ["admin", "web"]);
    assert.deepEqual(services(["packages/api-client-ts/x.ts"]).services, ["admin", "web"]);
    assert.deepEqual(services(["infra/oracle-vm/build-args.env"]).services, ["admin", "web"]);
    assert.deepEqual(services(["infra/oracle-vm/docker-compose.yml"]).services, ["backend", "admin", "web"]);
    // cron 스크립트만 바뀌면 컨테이너는 그대로 두고 파일만 동기화한다.
    const opsOnly = services(["infra/oracle-vm/ops-check.sh"]);
    assert.deepEqual(opsOnly.services, []);
    assert.equal(opsOnly.sync, true);
  } finally {
    r.cleanup();
  }
});

test("운영 태그가 없으면 첫 배포로 포함하고, 동기화 기록이 없으면 sync 한다", () => {
  const r = repo();
  try {
    const sha = r.commit(["apps/api/main.py"]);
    const plan = planDeploy({
      sha,
      status: { BACKEND_TAG: "", ADMIN_TAG: sha, WEB_TAG: sha },
      rollback: false,
      git: r.git,
    });
    assert.deepEqual(plan.services, ["backend"]);
    const same = planDeploy({ sha, status: status(sha), rollback: false, git: r.git });
    assert.deepEqual(same.services, []);
    assert.equal(same.sync, true);
  } finally {
    r.cleanup();
  }
});

test("후퇴 배포는 rollback 없이는 오류, rollback 이면 허용한다", () => {
  const r = repo();
  try {
    const older = r.commit(["apps/web/page.tsx"]);
    const newer = r.commit(["apps/web/page.tsx"]);
    const blocked = planDeploy({ sha: older, status: status(newer), rollback: false, git: r.git });
    assert.equal(blocked.services.length, 0);
    assert.match(blocked.errors.join("\n"), /web: 후퇴 배포다/);
    const allowed = planDeploy({ sha: older, status: status(newer), rollback: true, git: r.git });
    assert.deepEqual(allowed.services, ["web"]);
    assert.deepEqual(allowed.errors, []);
  } finally {
    r.cleanup();
  }
});

test("git 에서 찾을 수 없거나 형식이 아닌 운영 태그는 추측하지 않고 오류", () => {
  const r = repo();
  try {
    const sha = r.commit(["apps/web/page.tsx"]);
    const plan = planDeploy({
      sha,
      status: { BACKEND_TAG: "0123456789ab", ADMIN_TAG: "not-a-tag", WEB_TAG: sha },
      rollback: false,
      git: r.git,
    });
    assert.match(plan.errors.join("\n"), /backend: 운영 태그 0123456789ab 를 git 에서 찾을 수 없다/);
    assert.match(plan.errors.join("\n"), /admin: 운영 태그 'not-a-tag' 가 sha 형식이 아니다/);
    assert.throws(() => planDeploy({ sha: "abc", status: {}, rollback: false, git: r.git }), /40자/);
  } finally {
    r.cleanup();
  }
});

test("parseStatus 는 VM status 출력의 KEY=VALUE 만 읽는다", () => {
  assert.deepEqual(parseStatus("BACKEND_TAG=abc1234\r\nnoise\nWEB_TAG=\nSYNCED_SHA= x \n"), {
    BACKEND_TAG: "abc1234",
    WEB_TAG: "",
    SYNCED_SHA: "x",
  });
});

test("각 Dockerfile 의 COPY 원본이 그 서비스의 배포 판정 경로에 들어 있다", () => {
  for (const [service, dockerfile] of [
    ["backend", "apps/api/Dockerfile"],
    ["web", "apps/web/Dockerfile"],
    ["admin", "apps/admin/Dockerfile"],
  ]) {
    const sources = readFileSync(path.join(root, dockerfile), "utf8")
      .split("\n")
      .filter((line) => /^COPY\s/.test(line) && !/--from=/.test(line))
      .flatMap((line) =>
        line
          .replace(/^COPY\s+(--\S+\s+)*/, "")
          .trim()
          .split(/\s+/)
          .slice(0, -1),
      );
    assert.ok(sources.length > 0, `${dockerfile} 에서 COPY 를 찾지 못했다`);
    for (const source of sources) {
      const probe = source.endsWith("/") ? `${source}x` : source;
      assert.ok(
        matches(probe, SERVICE_PATHS[service]) ||
          matches(`${probe}/x`, SERVICE_PATHS[service]) ||
          matches(probe, ALL_SERVICES_PATHS),
        `${dockerfile} 의 COPY ${source} 가 ${service} 판정 경로에 없다 — deploy-services.mjs SERVICE_PATHS 를 고친다`,
      );
    }
  }
});
