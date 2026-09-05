import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegacyStreamContract } from "./legacy-contract.mjs";

test("최초 기준 문서의 SSE MIME 오기만 수정하고 원본을 변경하지 않는다", () => {
  const json = { "application/json": { schema: {} } };
  const original = { paths: {
    "/chat/stream": { post: { responses: { "200": { content: json } } } },
    "/chat": { post: { responses: { "200": { content: json } } } },
  } };
  const result = normalizeLegacyStreamContract(original);
  assert.ok(original.paths["/chat/stream"].post.responses["200"].content["application/json"]);
  assert.deepEqual(result.paths["/chat"], original.paths["/chat"]);
  assert.deepEqual(result.paths["/chat/stream"].post.responses["200"].content, { "text/event-stream": { schema: { type: "string" } } });
});
test("다른 형태의 기준 문서에 예외를 조용히 확대하지 않는다", () => {
  assert.throws(() => normalizeLegacyStreamContract({ paths: {} }));
});
