import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");
const guardRecipe = makefile.slice(makefile.indexOf("deploy-guard: ##"), makefile.indexOf("deploy-backend: ##"));

/**
 * Makefile 레시피 → 실행 가능한 bash 조각.
 * 레시피 줄(탭 시작)만 남기고 `@` 접두·`@#` 주석을 걷어낸 뒤 $(VAR) 를 테스트 값으로, `$$` 를 `$` 로 바꾼다.
 * operations.test.mjs 가 ops-check.sh 조각을 잘라 쓰는 방식과 같다.
 */
function guardScript(vars) {
  return guardRecipe
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.slice(1).replace(/^@/, ""))
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .replace(/\$\(([A-Z_]+)\)/g, (_, name) => vars[name] ?? "")
    .replaceAll("$$", "$");
}

/** 커밋 2개짜리 임시 저장소. origin 은 자기 자신이라 `git fetch origin main` 이 실제로 동작한다. */
function repoFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "truewords-deploy-guard-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env }).trim();
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "app.txt"), "base\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  const older = git("rev-parse", "HEAD");
  writeFileSync(path.join(dir, "app.txt"), "candidates\n");
  git("add", "-A");
  git("commit", "-qm", "feat: API-HD-012 편성 후보 찾기");
  const newer = git("rev-parse", "HEAD");
  git("remote", "add", "origin", dir);
  git("fetch", "-q", "origin", "main");
  return { dir, git, older, newer };
}

/** liveTag: 운영 .env 가 보고할 태그. null 이면 _TAG 줄 자체가 없다. sshFails 면 ssh 가 죽는다. */
function runGuard(dir, { liveTag = null, sshFails = false, vars = {} } = {}) {
  const stub = sshFails
    ? "ssh() { echo 'ssh: connect to host truewords-oracle port 22: Operation timed out' >&2; return 255; }"
    : `ssh() { printf '%s\\n' '${liveTag === null ? "" : `BACKEND_TAG=${liveTag}`}'; return 0; }`;
  const script = guardScript({
    TAG: "deadbee",
    ORACLE: "truewords-oracle",
    DEPLOY_SERVICE: "BACKEND",
    FORCE_DEPLOY: "",
    ...vars,
  });
  return spawnSync("bash", ["-o", "pipefail", "-c", `${stub}\n${script}`], { cwd: dir, encoding: "utf8" });
}

test("후퇴 배포를 막고 사라지는 커밋을 출력한다", () => {
  const { dir, git, older, newer } = repoFixture();
  try {
    git("checkout", "-q", older); // 운영보다 뒤인 커밋을 배포하려는 상황
    const result = runGuard(dir, { liveTag: newer });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /후퇴 배포입니다/);
    assert.match(result.stdout, /API-HD-012 편성 후보 찾기/);
    assert.match(result.stdout, /FORCE_DEPLOY=1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("전진 배포와 같은 태그 재배포는 통과한다", () => {
  const { dir, older, newer } = repoFixture();
  try {
    // 운영(older) → HEAD(newer): 앞으로 가는 배포.
    const forward = runGuard(dir, { liveTag: older });
    assert.equal(forward.status, 0);
    assert.doesNotMatch(forward.stdout, /후퇴 배포/);
    // 재배포: 커밋은 자기 자신의 조상이므로 막히면 안 된다.
    const same = runGuard(dir, { liveTag: newer });
    assert.equal(same.status, 0);
    assert.doesNotMatch(same.stdout, /후퇴 배포/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("VM .env 에 태그가 없으면(첫 배포) 후퇴 검사만 건너뛴다", () => {
  const { dir } = repoFixture();
  try {
    const result = runGuard(dir, { liveTag: null });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /BACKEND_TAG 가 없습니다 — 첫 배포/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("운영 태그가 로컬 git 에 없으면 비교 불가로 중단한다", () => {
  const { dir } = repoFixture();
  try {
    const result = runGuard(dir, { liveTag: "0123456789abcdef0123456789abcdef01234567" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /로컬 git 에서 찾을 수 없어 비교할 수 없습니다/);
    assert.match(result.stdout, /git fetch --all/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ssh 실패는 통과가 아니라 중단이다", () => {
  const { dir } = repoFixture();
  try {
    const result = runGuard(dir, { sshFails: true });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /운영 태그를 읽지 못했습니다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FORCE_DEPLOY=1 은 ssh 조회 없이 전체 가드를 건너뛴다", () => {
  const { dir, git, older, newer } = repoFixture();
  try {
    git("checkout", "-q", older); // 후퇴 상황이어도 명시 예외는 통과한다
    const result = runGuard(dir, { liveTag: newer, vars: { FORCE_DEPLOY: "1" } });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /가드 생략/);
    assert.doesNotMatch(result.stdout, /BACKEND_TAG/); // ssh 스텁이 불리지 않았다
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("DEPLOY_SERVICE 가 없으면 후퇴 검사만 건너뛰고 앞선 가드는 유지한다", () => {
  const { dir } = repoFixture();
  try {
    const result = runGuard(dir, { vars: { DEPLOY_SERVICE: "" } });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /DEPLOY_SERVICE 가 없어 후퇴 배포 검사를 건너뜁니다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deploy-* 세 타깃이 모두 자기 서비스를 가드에 넘긴다", () => {
  for (const [target, service] of [
    ["deploy-backend", "BACKEND"],
    ["deploy-admin", "ADMIN"],
    ["deploy-web", "WEB"],
  ]) {
    const recipe = makefile.slice(
      makefile.indexOf(`${target}: ##`),
      makefile.indexOf(`rollback-${service.toLowerCase()}: ##`),
    );
    assert.match(
      recipe,
      new RegExp(`deploy-guard DEPLOY_SERVICE=${service}\\b`),
      `${target} 가 서비스를 넘기지 않는다`,
    );
  }
});
