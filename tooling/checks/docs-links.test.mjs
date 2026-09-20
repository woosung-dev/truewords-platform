import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listGitVisibleFiles, walk } from "./docs-links.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));

/** files 는 {상대경로: 내용}. init=false 면 git 저장소를 만들지 않는다(폴백 경로 확인용). */
function fixture(files, { init = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "truewords-docs-links-"));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  if (init) execFileSync("git", ["-C", dir, "init", "-q"]);
  return dir;
}

/** 실제 진입점과 같은 조합: git 목록으로 거른 walk 결과를 레포 상대 posix 경로로. */
function documents(dir) {
  return walk(dir, { rootDir: dir, visible: listGitVisibleFiles(dir) })
    .map((file) => path.relative(dir, file).split(path.sep).join("/"))
    .sort();
}

function withStderr(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { value: run(), stderr: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

test("gitignore 대상은 빠지고 추적 대상 .md/.html 은 그대로 검사한다", () => {
  const dir = fixture({
    ".gitignore": "docs/guides/*.html\n",
    "docs/README.md": "# readme\n",
    "docs/page.html": "<b>ok</b>\n",
    "docs/guides/keep.md": "# keep\n",
    "docs/guides/redteam-test-guide-v2.html": '<a href="#1-보고서-개요">x</a>\n',
  });
  try {
    assert.deepEqual(documents(dir), ["docs/README.md", "docs/guides/keep.md", "docs/page.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("중첩 .gitignore 와 부정 패턴(!)을 git 판정 그대로 따른다", () => {
  const dir = fixture({
    ".gitignore": "*.html\n",
    "docs/.gitignore": "drafts/\n!keep.html\n",
    "docs/keep.html": "<b>되살림</b>\n",
    "docs/skip.html": "<b>무시</b>\n",
    "docs/ok.md": "# ok\n",
    "docs/drafts/plan.md": "# 초안\n",
  });
  try {
    assert.deepEqual(documents(dir), ["docs/keep.html", "docs/ok.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("git 저장소가 아니면 죽지 않고 전부 검사한다 (조용한 누락 금지)", () => {
  const dir = fixture({ "docs/a.md": "# a\n", "docs/b.html": "<b>b</b>\n" }, { init: false });
  try {
    assert.deepEqual(documents(dir), ["docs/a.md", "docs/b.html"]);
    // git 호출이 실패하면 null 을 돌려주고 그 사실을 stderr 로 알린다.
    const { value, stderr } = withStderr(() => listGitVisibleFiles(path.join(dir, "없는-디렉터리")));
    assert.equal(value, null);
    assert.match(stderr, /gitignore 필터 없이 전부 검사합니다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("기존 제외 목록(node_modules·.next 등)은 여전히 동작한다", () => {
  const dir = fixture({
    "docs/a.md": "# a\n",
    "docs/node_modules/pkg/readme.md": "# 의존성\n",
    "docs/.next/build.html": "<b>산출물</b>\n",
    "docs/.venv/lib/x.md": "# venv\n",
  });
  try {
    assert.deepEqual(documents(dir), ["docs/a.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("이 저장소에서 추적 중인 docs·infra 문서는 필터 후에도 전부 검사된다", () => {
  const tracked = execFileSync("git", ["-C", repo, "ls-files", "-z", "docs", "infra"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => /\.(md|html)$/.test(file) && existsSync(path.join(repo, file)));
  assert.ok(tracked.length > 0, "추적 문서가 없으면 이 테스트는 무의미하다");
  const visible = listGitVisibleFiles(repo);
  const found = new Set(
    [path.join(repo, "docs"), path.join(repo, "infra")]
      .flatMap((dir) => walk(dir, { rootDir: repo, visible }))
      .map((file) => path.relative(repo, file).split(path.sep).join("/")),
  );
  for (const file of tracked) assert.ok(found.has(file), `${file} 가 검사 대상에서 빠졌습니다`);
});
