import assert from "node:assert/strict";
import test from "node:test";
import { checkCiStatus } from "./ci-status.mjs";

function fixture(enabled = "true", result = "success") {
  return {
    changes: { result: "success", outputs: { api: enabled, admin: enabled, web: enabled, contracts: enabled } },
    repository: { result: "success" },
    e2e: { result },
    "backend-test": { result },
    "frontend-test": { result },
    "web-test": { result },
    contracts: { result },
  };
}
test("전체 성공 및 영향 없는 skip 허용", () => {
  assert.deepEqual(checkCiStatus(fixture()), []);
  assert.deepEqual(checkCiStatus(fixture("false", "skipped")), []);
});
for (const result of ["failure", "cancelled", "skipped"]) {
  test(`필수 작업의 ${result} 차단`, () => assert.ok(checkCiStatus(fixture("true", result)).length));
}
test("감지 실패와 누락 output은 닫힌 상태로 실패", () => {
  const needs = fixture();
  needs.changes = { result: "failure", outputs: {} };
  assert.ok(checkCiStatus(needs).length);
});
test("규칙이 없는 새 job 은 성공만 허용 (failure·skipped 모두 차단)", () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const needs = { ...fixture(), "new-job": { result } };
    assert.ok(
      checkCiStatus(needs).some((f) => f.startsWith("new-job:")),
      result,
    );
  }
  assert.deepEqual(checkCiStatus({ ...fixture(), "new-job": { result: "success" } }), []);
});
