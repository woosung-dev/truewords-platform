import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export function checkImport(file, specifier) {
  const target = specifier.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
    : specifier;
  if (/^@truewords\/ui-web(\/|$)/.test(target) || /^packages\/ui-web(?:\/|$)/.test(target))
    return "UI와 테마는 각 앱이 소유합니다";
  if (
    file.startsWith("packages/") &&
    (/^apps\//.test(target) || /^@truewords\/(web|admin|api)(\/|$)/.test(target) || target.startsWith("@/"))
  ) {
    return "공유 패키지가 앱을 참조합니다";
  }
  const owner = file.match(/^apps\/([^/]+)\//)?.[1];
  const consumer =
    target.match(/^apps\/([^/]+)(?:\/|$)/)?.[1] ?? target.match(/^@truewords\/(web|admin|api)(?:\/|$)/)?.[1];
  if (owner && consumer && owner !== consumer) return "앱 사이 직접 import는 금지합니다";
  if (file.startsWith("packages/api-client-ts/") && /^(react|react-dom|next)(\/|$)/.test(target))
    return "API SDK는 플랫폼 중립이어야 합니다";
  return null;
}
export function checkSource(file, source) {
  return [
    ...source.matchAll(
      /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|@(?:import|source)\s*(?:url\(\s*)?)["']([^"']+)["']/g,
    ),
  ].flatMap((match) => {
    const error = checkImport(file, match[1]);
    return error ? [`${file}: ${match[1]} — ${error}`] : [];
  });
}
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".next", ".turbo", ".venv", "__pycache__"].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : /\.(tsx?|m?js|css)$/.test(file) ? [file] : [];
  });
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = [];
  for (const absolute of [...walk(path.join(root, "apps")), ...walk(path.join(root, "packages"))]) {
    const file = path.relative(root, absolute).split(path.sep).join("/");
    const source = readFileSync(absolute, "utf8");
    failures.push(...checkSource(file, source));
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else console.log("앱별 UI·CSS와 플랫폼 중립 SDK import 경계 통과");
}
