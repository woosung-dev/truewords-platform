import test from "node:test";
import assert from "node:assert/strict";
import { checkImport } from "./boundaries.mjs";

test("공유 패키지의 앱 의존을 alias/relative 모두 차단", () => {
  assert.ok(checkImport("packages/ui-web/src/button.tsx", "@/lib/api"));
  assert.ok(checkImport("packages/ui-web/src/button.tsx", "../../../apps/web/src/lib/api"));
  assert.ok(checkImport("packages/ui-web/src/button.tsx", "@truewords/admin"));
});
test("앱은 공유 패키지를 사용하고 서로 직접 의존하지 않는다", () => {
  assert.equal(checkImport("apps/web/src/page.tsx", "@truewords/ui-web/components/ui/button"), null);
  assert.equal(checkImport("apps/web/src/page.tsx", "./lib/api"), null);
  assert.ok(checkImport("apps/admin/src/page.tsx", "../../web/src/lib/api"));
});
test("SDK의 React/Next 의존을 차단", () => {
  assert.ok(checkImport("packages/api-client-ts/src/index.ts", "next/navigation"));
  assert.equal(checkImport("packages/api-client-ts/src/index.ts", "./generated/client"), null);
});
