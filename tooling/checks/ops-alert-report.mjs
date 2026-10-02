// VM ops-check 결과(/opt/ops-status.json)를 GitHub Issue 알림 한 건으로 바꾼다 — ops-alert.yml 전용.
//
//   node tooling/checks/ops-alert-report.mjs --file <ops-status.json> --ssh <success|failure|…> --rc <ssh 종료 코드>
//   결과: GITHUB_OUTPUT 에 state=ok|alert, title=…, body(여러 줄) — 없으면 stdout JSON.
//
// 공개 저장소라 이슈 본문은 누구나 본다. 그래서
//   - ssh 오류 원문은 받지도 않는다(호스트 이름·IP 가 섞인다). 종료 코드로만 판정한다.
//   - DETAIL 의 버킷 이름·키 지문(sha8=)·OCID·IPv4 는 가린다.
//   - JSON 을 읽지 못하면 원문 대신 크기만 적는다.
// 판정은 ops-check.sh 의 것을 그대로 옮긴다. 여기서 새 규칙을 만들지 않는다 — 더하는 것은
// "결과가 오지 않았다"(접속·낡음·형식) 뿐이다. 감시자를 다른 실패 도메인에 두는 것이 목적이다.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const TITLE_PREFIX = "[ops-alert] VM 점검";
// ops-check 는 매일 18:45 UTC, 이 워크플로는 19:20 UTC. 하루치를 건너뛰었으면 낡은 것이다.
export const STALE_HOURS = 26;
const ALERT_VERDICTS = new Set(["FAIL", "WARN"]);

export function mask(text) {
  return String(text)
    .replace(/(sha8=)[^\s·,;)]+/g, "$1***")
    .replace(/((?:bucket|버킷)\s+)[^\s·,;/)]+/gi, "$1***")
    .replace(/ocid1\.[\w.-]+/g, "ocid1.***")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "*.*.*.*")
    .replace(/[\r\n]+/g, " ");
}

/** 검증된 상태 객체 또는 null. */
export function parseStatus(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || typeof data.checked_at !== "string" || !Array.isArray(data.checks))
    return null;
  const checkedAt = Date.parse(data.checked_at);
  if (Number.isNaN(checkedAt)) return null;
  const checks = [];
  for (const item of data.checks) {
    if (!item || typeof item.name !== "string" || typeof item.verdict !== "string") return null;
    checks.push({ name: item.name, verdict: item.verdict, detail: typeof item.detail === "string" ? item.detail : "" });
  }
  return { checkedAt, checks };
}

/**
 * @param {object} input
 * @param {string} input.ssh vm-ssh 단계 결과(success 가 아니면 설정 문제)
 * @param {string} input.rc ops-status ssh 종료 코드(문자열, 미실행이면 "")
 * @param {string|null} input.text ops-status 출력(없으면 null)
 * @param {number} input.now 판정 시각(ms)
 * @param {string} [input.runUrl]
 */
export function buildReport({ ssh, rc, text, now, runUrl = "" }) {
  const footer =
    "확인: `make ops-check` · 결과 원본: VM `/opt/ops-status.json` · 설명: infra/oracle-vm/README.md §운영 불변식 점검";
  const alert = (headline, lines) => ({
    state: "alert",
    title: `${TITLE_PREFIX} — ${headline}`,
    body: [`**${headline}**`, "", ...lines, "", ...(runUrl ? [`실행: ${runUrl}`] : []), footer].join("\n"),
  });

  if (ssh !== "success") {
    return alert("ssh 설정 실패", [
      "ops-read 환경의 secret(`OPS_READ_SSH_KEY`·`DEPLOY_HOST`·`DEPLOY_HOST_KEY`) 또는 `DEPLOY_USER` Variable 을 확인한다.",
    ]);
  }
  if (rc === "255") {
    return alert("VM 에 닿지 못함", [
      "ssh 접속이 실패했다(종료 255). VM·터널·키 등록(`truewords-ops-read@github-actions` 줄)을 확인한다.",
      "VM 자체가 멈췄다면 VM cron 의 ops-check 도 돌지 않는다 — 이 알림이 유일한 신호일 수 있다.",
    ]);
  }
  if (rc !== "0") {
    return alert("ops-status 를 읽지 못함", [
      `VM 에는 닿았지만 결과 파일을 읽지 못했다(종료 ${rc || "?"}). ops-check.sh 가 한 번도 돌지 않았거나 진입점 설치가 오래됐다.`,
    ]);
  }
  const status = text === null ? null : parseStatus(text);
  if (!status) {
    const size = text === null ? 0 : Buffer.byteLength(text);
    return alert("결과 JSON 을 읽지 못함", [
      `ops-status 출력(${size}바이트)이 기대한 형식이 아니다. 원문은 VM 에서 확인한다.`,
    ]);
  }
  const ageHours = (now - status.checkedAt) / 3_600_000;
  if (ageHours > STALE_HOURS) {
    return alert(`결과가 낡음 (${Math.floor(ageHours)}시간 전)`, [
      `마지막 점검: ${new Date(status.checkedAt).toISOString()}. VM cron 의 ops-check.sh 가 돌지 않고 있다.`,
      "`crontab -l` 과 `~/truewords-cron.log` 를 확인한다.",
    ]);
  }
  const bad = status.checks.filter((c) => ALERT_VERDICTS.has(c.verdict));
  if (bad.length === 0) {
    return {
      state: "ok",
      title: `${TITLE_PREFIX} — 정상`,
      body: `${status.checks.length}건 정상 (점검 ${new Date(status.checkedAt).toISOString()})`,
    };
  }
  const count = (verdict) => bad.filter((c) => c.verdict === verdict).length;
  const headline = [count("FAIL") && `FAIL ${count("FAIL")}`, count("WARN") && `WARN ${count("WARN")}`]
    .filter(Boolean)
    .join(" · ");
  const others = status.checks.filter((c) => !ALERT_VERDICTS.has(c.verdict) && c.verdict !== "OK");
  return alert(headline, [
    `점검: ${new Date(status.checkedAt).toISOString()}`,
    "",
    ...bad.map((c) => `- \`${mask(c.name)}\` **${c.verdict}** — ${mask(c.detail)}`),
    ...others.map((c) => `- \`${mask(c.name)}\` ${mask(c.verdict)} — ${mask(c.detail)}`),
  ]);
}

function main(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? "") : "";
  };
  const file = value("--file");
  const report = buildReport({
    ssh: value("--ssh"),
    rc: value("--rc"),
    text: file && existsSync(file) ? readFileSync(file, "utf8") : null,
    now: Date.now(),
    runUrl: process.env.RUN_URL ?? "",
  });
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = `EOF_${randomBytes(8).toString("hex")}`;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `state=${report.state}\ntitle=${report.title}\nbody<<${delimiter}\n${report.body}\n${delimiter}\n`,
    );
  }
  console.log(report.state === "ok" ? report.body : report.title);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
