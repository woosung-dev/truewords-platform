import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ops = readFileSync(new URL("../../infra/oracle-vm/ops-check.sh", import.meta.url), "utf8");
const containersCheck = ops.slice(ops.indexOf("SERVICES=$(sudo docker compose"), ops.indexOf("# ── 5."));
// composeHasWeb: 이 VM 의 compose 가 web 을 정의하는가. webStatus: ps 가 보고하는 web 상태(null 이면 컨테이너 없음).
function checkContainers(composeHasWeb, webStatus) {
  const services = ["postgres", "qdrant", "backend", "admin", ...(composeHasWeb ? ["web"] : []), "cloudflared"];
  const ps = [
    "postgres Up 1 hour (healthy)",
    "qdrant Up 1 hour (healthy)",
    "backend Up 1 hour (healthy)",
    "admin Up 1 hour (healthy)",
    "cloudflared Up 1 hour",
    ...(webStatus ? [`web ${webStatus}`] : []),
  ];
  return execFileSync(
    "bash",
    [
      "-c",
      `
    sudo() {
      case "$*" in
        *"config --services"*) printf '%s\\n' ${services.map((s) => `'${s}'`).join(" ")};;
        *) printf '%s\\n' ${ps.map((l) => `'${l}'`).join(" ")};;
      esac
    }
    record() { printf '%s %s %s\\n' "$1" "$2" "$3"; }
    ${containersCheck}
  `,
    ],
    { encoding: "utf8" },
  );
}
test("운영 점검은 compose 에 정의된 서비스 전부가 정상일 때만 성공 (분리 전 5개 · 분리 후 6개)", () => {
  assert.match(checkContainers(true, "Up 1 hour (healthy)"), /containers OK 6개 정상 \(5 healthy \+ cloudflared up\)/);
  assert.match(checkContainers(true, "Exited (1)"), /containers FAIL 비정상: web/);
  assert.match(checkContainers(true, null), /containers FAIL 비정상: web/);
  // 분리 전 VM: compose 에 web 이 없으면 web 부재는 오탐이 아니다.
  assert.match(checkContainers(false, null), /containers OK 5개 정상 \(4 healthy \+ cloudflared up\)/);
});

test("이미지 GC dry-run은 web 및 실행중/명시롤백 태그를 보존", () => {
  const temporary = mkdtempSync(path.join(tmpdir(), "truewords-gc-test-"));
  const preserveFile = path.join(temporary, "preserve-images.txt");
  writeFileSync(preserveFile, "# 영속 보존 목록\ntruewords-web:rollback\n");
  const source = readFileSync(new URL("../../infra/oracle-vm/prune-images.sh", import.meta.url), "utf8");
  try {
    const output = execFileSync(
      "bash",
      [
        "-c",
        `
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
  `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          KEEP: "1",
          DRY_RUN: "1",
          REPOS: "truewords-backend truewords-admin truewords-web",
          PRESERVE_IMAGES: "",
          PRESERVE_IMAGES_FILE: preserveFile,
        },
      },
    );
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
    const result = spawnSync(
      "bash",
      [
        "-c",
        `
      sed() { echo 'Permission denied' >&2; return 2; }
      sudo() { echo 'UNEXPECTED_DOCKER_CALL'; return 99; }
      df() { printf 'used\\n1000000\\n'; }
      ${source}
    `,
      ],
      { encoding: "utf8", env: { ...process.env, DRY_RUN: "0", PRESERVE_IMAGES_FILE: preserveFile } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /보존 목록 읽기 실패/);
    assert.doesNotMatch(result.stdout, /UNEXPECTED_DOCKER_CALL/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
