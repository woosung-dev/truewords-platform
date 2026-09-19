import assert from "node:assert/strict";
import test from "node:test";
import { checkImport, checkSource } from "./boundaries.mjs";

test("공유 패키지의 앱 의존을 alias/relative 모두 차단", () => {
  assert.ok(checkImport("packages/api-client-ts/src/index.ts", "@/lib/api"));
  assert.ok(checkImport("packages/api-client-ts/src/index.ts", "../../../apps/web/src/lib/api"));
  assert.ok(checkImport("packages/api-client-ts/src/index.ts", "@truewords/admin"));
});
test("앱은 공유 패키지를 사용하고 서로 직접 의존하지 않는다", () => {
  assert.equal(checkImport("apps/web/src/page.tsx", "@truewords/api-client-ts"), null);
  assert.equal(checkImport("apps/web/src/page.tsx", "@/components/ui/button"), null);
  assert.equal(checkImport("apps/web/src/page.tsx", "./lib/api"), null);
  assert.ok(checkImport("apps/admin/src/page.tsx", "../../web/src/lib/api"));
});
test("앱별 UI 소유권을 이전 패키지 alias와 상대 경로에서도 유지", () => {
  assert.ok(checkImport("apps/web/src/page.tsx", "@truewords/ui-web/components/ui/button"));
  assert.ok(checkImport("apps/web/src/app/globals.css", "../../../../packages/ui-web/src/styles.css"));
});
test("CSS import와 Tailwind source가 다른 앱의 UI에 의존하지 않는다", () => {
  const file = "apps/web/src/app/globals.css";
  assert.equal(checkSource(file, '@import "../../../admin/src/app/globals.css";').length, 1);
  assert.equal(checkSource(file, '@import url("../../../admin/src/app/globals.css");').length, 1);
  assert.equal(checkSource(file, '@source "../../../admin/src";').length, 1);
  assert.equal(checkSource(file, '@source "../../../admin";').length, 1);
  assert.equal(checkSource(file, '@source "../../../../packages/ui-web";').length, 1);
  assert.equal(checkSource(file, '@import "@truewords/ui-web/styles";').length, 1);
  assert.deepEqual(checkSource(file, '@import "tailwindcss";\n@source "../components";'), []);
});
test("SDK의 React/Next 의존을 차단", () => {
  assert.ok(checkImport("packages/api-client-ts/src/index.ts", "next/navigation"));
  assert.equal(checkImport("packages/api-client-ts/src/index.ts", "./generated/client"), null);
});
