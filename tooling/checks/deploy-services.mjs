// 배포 계획 — 운영에 올라가 있는 태그와 배포할 sha 를 비교해 "어떤 서비스를 바꿀지" 를 정한다.
//
// release.yml 의 deploy job 이 VM `status` 출력을 넘겨 부른다:
//   node tooling/checks/deploy-services.mjs --sha <40자> --status <파일> [--rollback]
// 결과: stdout JSON, GITHUB_OUTPUT 이 있으면 services=… / sync=true|false 도 쓴다.
//
// 판정 기준은 **이미지에 들어가는 파일**(각 Dockerfile 의 COPY 원본)이다. ci.yml 의 paths-filter 는
// "무엇을 검사할지" 라서 tooling/**·.github/workflows/**·Makefile·tests/e2e/** 까지 넓게 잡는다.
// 배포 판정에 그대로 쓰면 문서·도구만 바뀐 머지도 세 서비스를 재배포하고, 그때마다 VM 의
// 롤백 세대(현재+직전)가 내용이 같은 이미지로 밀려난다. 테스트가 Dockerfile COPY 와 이 표를 대조한다.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SERVICES = ["backend", "admin", "web"];

// 끝이 / 이면 디렉토리 접두, 아니면 정확한 파일.
const FRONTEND_SHARED = ["packages/", "contracts/", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"];
export const SERVICE_PATHS = {
  backend: ["apps/api/"],
  admin: ["apps/admin/", "apps/web/package.json", ...FRONTEND_SHARED, "infra/oracle-vm/build-args.env"],
  web: ["apps/web/", "apps/admin/package.json", ...FRONTEND_SHARED, "infra/oracle-vm/build-args.env"],
};
// 세 서비스 모두에 영향: 빌드 컨텍스트 필터와 compose 정의(이미지·env·볼륨).
export const ALL_SERVICES_PATHS = [".dockerignore", "infra/oracle-vm/docker-compose.yml"];
// 컨테이너는 그대로 두고 VM 파일(cron 스크립트 등)만 맞추면 되는 변경.
export const SYNC_PATHS = ["infra/oracle-vm/"];

export function matches(file, patterns) {
  return patterns.some((pattern) => (pattern.endsWith("/") ? file.startsWith(pattern) : file === pattern));
}

/** `KEY=VALUE` 줄(VM deploy.sh status 출력)을 객체로. 모르는 줄은 무시한다. */
export function parseStatus(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

const SHA40 = /^[0-9a-f]{40}$/;
const TAG = /^[0-9a-f]{7,40}$/;

/**
 * @param {object} input
 * @param {string} input.sha 배포할 커밋(40자)
 * @param {Record<string,string>} input.status parseStatus 결과
 * @param {boolean} input.rollback 의도한 되돌리기면 조상 검사를 건너뛴다
 * @param {(args: string[]) => {ok: boolean, out: string}} input.git
 */
export function planDeploy({ sha, status, rollback, git }) {
  if (!SHA40.test(sha)) throw new Error(`sha 는 40자 hex 여야 한다: ${sha}`);
  const resolve = (ref) => {
    const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return result.ok ? result.out.trim() : null;
  };
  const changedFiles = (from) => {
    const result = git(["diff", "--name-only", from, sha]);
    if (!result.ok) throw new Error(`git diff ${from} ${sha} 실패`);
    return result.out.split("\n").filter(Boolean);
  };
  const isAncestor = (from) => git(["merge-base", "--is-ancestor", from, sha]).ok;
  const errors = [];
  const services = [];
  const reasons = {};

  for (const service of SERVICES) {
    const tag = status[`${service.toUpperCase()}_TAG`] ?? "";
    if (tag === "") {
      services.push(service);
      reasons[service] = "운영 태그 없음(첫 배포)";
      continue;
    }
    if (!TAG.test(tag)) {
      errors.push(`${service}: 운영 태그 '${tag}' 가 sha 형식이 아니다`);
      continue;
    }
    const deployed = resolve(tag);
    if (!deployed) {
      errors.push(`${service}: 운영 태그 ${tag} 를 git 에서 찾을 수 없다 — 비교할 수 없어 중단한다`);
      continue;
    }
    if (deployed === sha) continue;
    const files = changedFiles(deployed).filter(
      (file) => matches(file, SERVICE_PATHS[service]) || matches(file, ALL_SERVICES_PATHS),
    );
    if (files.length === 0) continue;
    if (!rollback && !isAncestor(deployed)) {
      errors.push(
        `${service}: 후퇴 배포다 — 운영 ${tag} 가 ${sha.slice(0, 12)} 의 조상이 아니다. 의도한 되돌리기면 rollback=true 로 다시 실행한다`,
      );
      continue;
    }
    services.push(service);
    reasons[service] = `${files.length}개 파일 (${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""})`;
  }

  // VM 파일 동기화: 교체할 서비스가 있으면 deploy 가 함께 하므로, 서비스 변경이 없을 때만 따로 판단한다.
  let sync = false;
  if (services.length === 0 && errors.length === 0) {
    const synced = status.SYNCED_SHA ?? "";
    const base = SHA40.test(synced) ? resolve(synced) : null;
    if (!base) {
      sync = true;
      reasons.sync = "동기화 기록 없음";
    } else if (base !== sha && changedFiles(base).some((file) => matches(file, SYNC_PATHS))) {
      if (!rollback && !isAncestor(base)) {
        errors.push(`sync: 마지막 동기화 ${synced.slice(0, 12)} 가 ${sha.slice(0, 12)} 의 조상이 아니다 (후퇴)`);
      } else {
        sync = true;
        reasons.sync = "infra/oracle-vm 변경";
      }
    }
  }
  return { services, sync, reasons, errors };
}

function gitRunner(args) {
  try {
    return { ok: true, out: execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: "" };
  }
}

function main(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const sha = value("--sha") ?? "";
  const statusFile = value("--status");
  if (!statusFile) throw new Error("--status <파일> 이 필요하다");
  const plan = planDeploy({
    sha,
    status: parseStatus(readFileSync(statusFile, "utf8")),
    rollback: argv.includes("--rollback"),
    git: gitRunner,
  });
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `services=${plan.services.join(" ")}\nsync=${plan.sync}\n`);
  }
  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
