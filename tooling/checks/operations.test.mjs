import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const ops = readFileSync(new URL("../../infra/oracle-vm/ops-check.sh", import.meta.url), "utf8");
const containersCheck = ops.slice(ops.indexOf("PS=$(sudo docker compose"), ops.indexOf("# ── 5."));
function checkContainers(hasWeb) {
  return execFileSync("bash", ["-c", `
    sudo() { printf '%s\\n' 'postgres Up 1 hour (healthy)' 'qdrant Up 1 hour (healthy)' 'backend Up 1 hour (healthy)' 'admin Up 1 hour (healthy)' 'cloudflared Up 1 hour' ${hasWeb ? "'web Up 1 hour (healthy)'" : "'web Exited (1)'"}; }
    record() { printf '%s %s %s\\n' "$1" "$2" "$3"; }
    ${containersCheck}
  `], { encoding: "utf8" });
}
test("운영 점검은 web 포함 6개 정상일 때만 성공", () => {
  assert.match(checkContainers(true), /containers OK 6개 정상/);
  assert.match(checkContainers(false), /containers FAIL 비정상: web/);
});

test("이미지 GC dry-run은 web 및 실행중/명시롤백 태그를 보존", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "truewords-gc-test-"));
  const preserveFile = path.join(temporary, "preserve-images.txt");
  writeFileSync(preserveFile, "# 영속 보존 목록\ntruewords-web:rollback\n");
  const source = readFileSync(new URL("../../infra/oracle-vm/prune-images.sh", import.meta.url), "utf8");
  try {
  const output = execFileSync("bash", ["-c", `
    df() { printf 'used\\n1000000\\n'; }
    sudo() {
      if [ "$2" = ps ]; then printf '%s\\n' truewords-web:running; return; fi
      if [ "$2 $3" = 'image ls' ]; then
        printf '2026-09-05\\t%s:newest\\n2026-09-04\\t%s:running\\n2026-09-03\\t%s:rollback\\n2026-09-02\\t%s:obsolete\\n' "$4" "$4" "$4" "$4"
        return
      fi
      echo 'UNEXPECTED_MUTATION'; return 99
    }
    ${source}
  `], { encoding: "utf8", env: { ...process.env, KEEP: "1", DRY_RUN: "1", REPOS: "truewords-backend truewords-admin truewords-web", PRESERVE_IMAGES: "", PRESERVE_IMAGES_FILE: preserveFile } });
  assert.match(output, /truewords-web:running: 참조 중 또는 지정 롤백 이미지라 보존/);
  assert.match(output, /truewords-web:rollback: 참조 중 또는 지정 롤백 이미지라 보존/);
  assert.match(output, /truewords-web:obsolete: \[dry-run\] 삭제 예정/);
  assert.doesNotMatch(output, /UNEXPECTED_MUTATION/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("롤백 보존 파일 읽기 실패 시 실제 삭제 전에 GC를 중단", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "truewords-gc-read-error-"));
  const preserveFile = path.join(temporary, "preserve-images.txt");
  writeFileSync(preserveFile, "truewords-web:rollback\n");
  const source = readFileSync(new URL("../../infra/oracle-vm/prune-images.sh", import.meta.url), "utf8");
  try {
    const result = spawnSync("bash", ["-c", `
      sed() { echo 'Permission denied' >&2; return 2; }
      sudo() { echo 'UNEXPECTED_DOCKER_CALL'; return 99; }
      df() { printf 'used\\n1000000\\n'; }
      ${source}
    `], { encoding: "utf8", env: { ...process.env, DRY_RUN: "0", PRESERVE_IMAGES_FILE: preserveFile } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /보존 목록 읽기 실패/);
    assert.doesNotMatch(result.stdout, /UNEXPECTED_DOCKER_CALL/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
