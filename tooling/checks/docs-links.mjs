import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = path.join(root, "docs/architecture/docs-link-baseline.json");

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (["node_modules", ".next", ".venv", ".git"].includes(entry.name)) return [];
    return entry.isDirectory() ? walk(filename) : /\.(md|html)$/.test(entry.name) ? [filename] : [];
  });
}

function withoutCode(text) {
  return text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "").replace(/`[^`\n]+`/g, "");
}

function links(text, isMarkdown) {
  const content = isMarkdown ? withoutCode(text) : text;
  const found = [];
  if (isMarkdown) {
    const starts = [...content.matchAll(/\]\(/g)];
    for (const match of starts) {
      let cursor = match.index + 2;
      let depth = 1;
      let value = "";
      while (cursor < content.length && depth > 0) {
        const character = content[cursor++];
        if (character === "\\" && cursor < content.length) {
          value += content[cursor++];
          continue;
        }
        if (character === "(") depth++;
        if (character === ")") depth--;
        if (depth > 0) value += character;
      }
      const url = value.startsWith("<") ? value.slice(1, value.indexOf(">")) : value.trim().split(/\s+["']/)[0];
      if (depth === 0 && !url.includes("\n")) found.push(url);
    }
    for (const match of content.matchAll(/^\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)) found.push(match[1]);
  }
  for (const match of content.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)) found.push(match[1]);
  return [...new Set(found)];
}

const anchorCache = new Map();
function anchors(filename) {
  if (anchorCache.has(filename)) return anchorCache.get(filename);
  const text = fs.readFileSync(filename, "utf8");
  const result = new Set();
  for (const match of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) result.add(match[1]);
  if (filename.endsWith(".md")) {
    const counts = new Map();
    const noFences = text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
    for (const match of noFences.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/gm)) {
      const slug = match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "")
        .replace(/\s/g, "-");
      const count = counts.get(slug) ?? 0;
      counts.set(slug, count + 1);
      result.add(count === 0 ? slug : `${slug}-${count}`);
    }
  }
  anchorCache.set(filename, result);
  return result;
}

const documents = ["README.md", "AGENTS.md"].map((name) => path.join(root, name));
documents.push(...walk(path.join(root, "docs")), ...walk(path.join(root, "infra")));
for (const app of ["api", "admin", "web"]) {
  for (const name of ["README.md", "AGENTS.md", "CLAUDE.md"]) {
    const filename = path.join(root, "apps", app, name);
    if (fs.existsSync(filename)) documents.push(filename);
  }
}
const failures = [];
let checked = 0;
for (const filename of documents) {
  if (!fs.existsSync(filename)) continue;
  for (const target of links(fs.readFileSync(filename, "utf8"), filename.endsWith(".md"))) {
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
    // HTML 데모의 JS 템플릿과 로컬 머신 개인 자료는 저장소 링크가 아니다.
    if (target.includes("${") || target.startsWith("~") || target.startsWith("/Users/")) continue;
    // 프로토타입 HTML의 `#/route` 해시 라우트는 클라이언트 라우팅이며 문서 앵커가 아니다.
    if (target.startsWith("#/")) continue;
    const [resource, fragment] = target.split("#", 2);
    let decoded;
    try {
      decoded = decodeURIComponent(resource.split("?", 1)[0]);
    } catch {
      decoded = resource;
    }
    const resolved = decoded ? path.resolve(path.dirname(filename), decoded) : filename;
    checked++;
    let problem;
    if (!fs.existsSync(resolved)) problem = "missing-file";
    else if (fragment && fs.statSync(resolved).isFile() && /\.(md|html)$/.test(resolved)) {
      let anchor;
      try {
        anchor = decodeURIComponent(fragment);
      } catch {
        anchor = fragment;
      }
      if (!anchors(resolved).has(anchor)) problem = "missing-anchor";
    }
    if (problem) failures.push({ source: path.relative(root, filename), target, problem });
  }
}
failures.sort((a, b) => `${a.source}:${a.target}`.localeCompare(`${b.source}:${b.target}`));
if (process.argv.includes("--report")) {
  console.log(JSON.stringify(failures, null, 2));
} else {
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
  const key = (entry) => `${entry.source}\n${entry.target}\n${entry.problem}`;
  const known = new Set(baseline.map(key));
  const current = new Set(failures.map(key));
  const introduced = failures.filter((entry) => !known.has(key(entry)));
  const stale = baseline.filter((entry) => !current.has(key(entry)));
  for (const entry of introduced) console.error(`${entry.source}: ${entry.target} (${entry.problem})`);
  for (const entry of stale) console.error(`해결된 기준선 항목을 삭제하세요: ${entry.source}: ${entry.target}`);
  console.log(
    `문서 ${documents.length}개, 로컬 링크 ${checked}개 검사; 기존 누락 ${failures.length - introduced.length}개, 새 오류 ${introduced.length}개, 기준선 정리 ${stale.length}개`,
  );
  if (introduced.length || stale.length) process.exitCode = 1;
}
