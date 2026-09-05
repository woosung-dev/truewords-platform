import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@hey-api/openapi-ts";
import config from "../codegen/openapi-ts.config.mjs";
import { normalizeLegacyStreamContract } from "./legacy-contract.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "truewords-contracts-"));
const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: "pipe", maxBuffer: 32 * 1024 * 1024, ...options });
function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), name) : [name];
  }).sort();
}

try {
  const current = path.join(temporary, "current.json");
  run("uv", ["run", "--project", "apps/api", "--no-sync", "python", "apps/api/scripts/export_openapi.py", "--output", current]);
  if (!readFileSync(current).equals(readFileSync(config.input))) throw new Error("OpenAPI drift: pnpm contracts:generate를 실행하세요");
  const generated = path.join(temporary, "sdk");
  await createClient({ ...config, output: generated });
  const expected = files(config.output);
  const actual = files(generated);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("SDK 파일 목록 drift");
  for (const name of expected) {
    if (!readFileSync(path.join(config.output, name)).equals(readFileSync(path.join(generated, name)))) {
      throw new Error(`SDK drift: ${name}`);
    }
  }
  console.log("OpenAPI + SDK 재생성 일치 (기존 파일 변경 없음)");

  const baseRef = process.env.CONTRACT_BASE_REF || run("git", ["merge-base", "HEAD", "origin/main"]).toString().trim();
  // 임의 ref를 옵션으로 해석하지 않도록 SHA로 먼저 확정한다.
  const sha = run("git", ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]).toString().trim();
  const base = path.join(temporary, "base.json");
  try {
    writeFileSync(base, run("git", ["show", `${sha}:contracts/openapi.json`]));
  } catch {
    // 최초 전환 PR도 검사를 건너뛰지 않는다. base의 이전 API 소스에서 생성한다.
    run("git", ["cat-file", "-e", `${sha}:backend/main.py`]);
    run("tar", ["-x", "-C", temporary], { input: run("git", ["archive", sha, "backend"]) });
    const python = [
      "import json, os, sys, socket",
      "from unittest.mock import patch",
      `sys.path.insert(0, ${JSON.stringify(path.join(temporary, "backend"))})`,
      `os.chdir(${JSON.stringify(temporary)})`,
      "with patch.dict(os.environ, {'GEMINI_API_KEY': 'openapi-baseline-only'}, clear=True), patch('socket.socket.connect', side_effect=RuntimeError('No network')), patch('socket.socket.connect_ex', side_effect=RuntimeError('No network')):",
      " from main import app",
      " schema = app.openapi()",
      `with open(${JSON.stringify(base)}, 'w') as output: json.dump(schema, output)`,
    ].join("\n");
    run("uv", ["run", "--project", "apps/api", "--no-sync", "python", "-c", python]);
    writeFileSync(base, JSON.stringify(normalizeLegacyStreamContract(JSON.parse(readFileSync(base, "utf8")))));
    console.log("최초 기준의 알려진 SSE MIME 오기만 교정: application/json → text/event-stream");
  }
  run("docker", ["run", "--rm", "--network=none", "-v", `${temporary}:/specs:ro`, "tufin/oasdiff:v1.30.0@sha256:c1200e64fa9b2229b7aee39fe389bd5b49c7cb955923f8a6b20791a6dcf1deed", "breaking", "--fail-on", "WARN", "--", "/specs/base.json", "/specs/current.json"], { stdio: "inherit" });
  console.log(`API 하위 호환성 통과: ${sha.slice(0, 8)}`);
} catch (error) {
  console.error(error.stderr?.toString() || error.message);
  process.exitCode = 1;
} finally {
  // 이 검사에서 생성한 고유 임시 디렉터리만 정리한다.
  rmSync(temporary, { recursive: true, force: true });
}
