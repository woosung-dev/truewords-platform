import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("훈독 cron 교체는 다른 작업을 보존하고 반복 설치해도 중복하지 않는다", () => {
  const dir = mkdtempSync(join(tmpdir(), "tw-push-cron-"));
  try {
    const file = join(dir, "jobs");
    writeFileSync(
      file,
      "# 기존 주석\n0 3 * * * /home/test/backup-db.sh\n*/15 * * * * /home/test/truewords/send-hoondok-push.sh >> /tmp/cron.log 2>&1\n",
    );
    const binary = join(dir, "crontab");
    writeFileSync(binary, '#!/bin/sh\nif [ "$1" = -l ]; then cat "$CRON_FILE"; else cp "$1" "$CRON_FILE"; fi\n');
    chmodSync(binary, 0o755);
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, CRON_FILE: file, TW_DIR: "/home/test/truewords" };
    const script = resolve("infra/oracle-vm/install-hoondok-push-cron.sh");
    execFileSync("bash", [script], { env });
    const first = readFileSync(file, "utf8");
    execFileSync("bash", [script], { env });
    assert.equal(readFileSync(file, "utf8"), first);
    assert.match(first, /0 3 \* \* \* \/home\/test\/backup-db.sh/);
    assert.equal(first.split("\n").filter((line) => line.includes("/send-hoondok-push.sh")).length, 1);
    assert.match(first, /^\*\/5 \* \* \* \* .*send-hoondok-push.sh/m);
    assert.match(first, /^\* \* \* \* \* .*send-hoondok-test-push.sh/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
