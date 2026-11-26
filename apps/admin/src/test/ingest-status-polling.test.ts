// 업로드 직후 표시가 지워진 뒤에도 서버가 적재 중이면 현황 갱신을 이어 가고, 멈춘 작업 때문에 끝없이 5초 폴링하지 않는지 확인한다.

import { describe, expect, it } from "vitest";

import { ingestProgressSignature, ingestStatusRefetchInterval } from "@/features/data-source/hooks";
import type { IngestionStatus } from "@/features/data-source/types";

function statusWith(inProgress: Record<string, { total: number; next_chunk: number }>): IngestionStatus {
  return {
    completed: {},
    failed: {},
    in_progress: inProgress,
    summary: {
      completed_count: 0,
      failed_count: 0,
      in_progress_count: Object.keys(inProgress).length,
      total_chunks: 0,
    },
  } as IngestionStatus;
}

const RUNNING = statusWith({ "a.pdf": { total: 100, next_chunk: 40 } });

describe("ingestStatusRefetchInterval", () => {
  it("업로드 직후 표시가 지워져도 서버가 진행 중 작업을 보고하면 계속 갱신한다", () => {
    expect(ingestStatusRefetchInterval(false, RUNNING, 0)).toBe(5000);
  });

  it("업로드 직후에는 서버 응답 전이라도 갱신한다", () => {
    expect(ingestStatusRefetchInterval(true, undefined, 0)).toBe(5000);
  });

  it("진척이 2분 넘게 없으면(한도로 멈춘 작업 등) 30초로 늦춘다", () => {
    expect(ingestStatusRefetchInterval(false, RUNNING, 2 * 60_000 - 1)).toBe(5000);
    expect(ingestStatusRefetchInterval(false, RUNNING, 2 * 60_000)).toBe(30_000);
  });

  it("진행 중 작업이 없으면 갱신을 멈춘다", () => {
    expect(ingestStatusRefetchInterval(false, statusWith({}), 0)).toBe(false);
    expect(ingestStatusRefetchInterval(false, undefined, 0)).toBe(false);
  });
});

describe("ingestProgressSignature", () => {
  it("청크가 나아가면 바뀌고, 순서와 무관하게 같은 상태는 같은 값이다", () => {
    const moved = statusWith({ "a.pdf": { total: 100, next_chunk: 41 } });
    expect(ingestProgressSignature(moved)).not.toBe(ingestProgressSignature(RUNNING));
    const ab = statusWith({ "a.pdf": { total: 1, next_chunk: 0 }, "b.pdf": { total: 2, next_chunk: 1 } });
    const ba = statusWith({ "b.pdf": { total: 2, next_chunk: 1 }, "a.pdf": { total: 1, next_chunk: 0 } });
    expect(ingestProgressSignature(ab)).toBe(ingestProgressSignature(ba));
  });
});
