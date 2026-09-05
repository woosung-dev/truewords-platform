// 최초 모노레포 PR의 기준 FastAPI 문서는 StreamingResponse를 JSON으로
// 표시했다. 실제 HTTP는 이전부터 text/event-stream이었다. 이 1개 오기만
// 비교 기준에서 교정하며, 이미 contracts/가 있는 base에는 적용하지 않는다.
export function normalizeLegacyStreamContract(schema) {
  const result = structuredClone(schema);
  const content = result.paths?.["/chat/stream"]?.post?.responses?.["200"]?.content;
  if (!content?.["application/json"] || Object.keys(content).length !== 1) {
    throw new Error("Legacy SSE contract shape changed; inspect the base manually");
  }
  result.paths["/chat/stream"].post.responses["200"].content = {
    "text/event-stream": { schema: { type: "string" } },
  };
  return result;
}
