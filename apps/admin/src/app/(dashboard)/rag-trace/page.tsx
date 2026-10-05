"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { chatbotAPI } from "@/features/chatbot/api";
import { ragTraceAPI } from "@/features/rag-trace/api";
import { CandidateTable } from "@/features/rag-trace/components/candidate-table";
import { GenerationPanel } from "@/features/rag-trace/components/generation-panel";
import { StageWaterfall } from "@/features/rag-trace/components/stage-waterfall";
import { TraceForm } from "@/features/rag-trace/components/trace-form";
import { TraceSummary } from "@/features/rag-trace/components/trace-summary";
import { traceErrorMessage } from "@/features/rag-trace/error-message";
import type { RagTraceRequest, RagTraceResponse } from "@/features/rag-trace/types";

// 봇 목록은 페이지 단위 API 라 한 번에 최대치(100)를 읽는다.
const CHATBOT_LIMIT = 100;

function TraceResult({ trace, stopAfter }: { trace: RagTraceResponse; stopAfter: RagTraceRequest["stop_after"] }) {
  return (
    <div className="space-y-4">
      {trace.partial && (
        <p
          role="status"
          className="rounded-lg border border-warning-border bg-warning-soft px-4 py-2 text-sm text-warning"
        >
          예산(25초) 초과나 단계 오류로 일부만 수집했습니다. 시간 초과·오류 단계는 워터폴에서 확인하세요.
        </p>
      )}
      <TraceSummary trace={trace} />
      <StageWaterfall spans={trace.spans ?? []} totalMs={trace.totals.total_ms} />
      <CandidateTable candidates={trace.candidates ?? []} />
      {trace.generation ? (
        <GenerationPanel generation={trace.generation} />
      ) : (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          {stopAfter && stopAfter !== "full"
            ? `생성 단계를 실행하지 않았습니다 (실행 범위: ${stopAfter} 까지).`
            : "생성 결과가 없습니다."}
        </p>
      )}
    </div>
  );
}

export default function RagTracePage() {
  const {
    data: bots,
    isLoading: botsLoading,
    isError: botsError,
    refetch: refetchBots,
  } = useQuery({
    queryKey: ["chatbots", "rag-trace", CHATBOT_LIMIT],
    queryFn: () => chatbotAPI.list(CHATBOT_LIMIT),
  });

  // 실행마다 새로 돌리므로 결과를 캐시하지 않는다(mutation 상태에만 둔다).
  const mutation = useMutation({
    mutationFn: (req: RagTraceRequest) => ragTraceAPI.run(req),
  });

  const chatbots = (bots?.items ?? []).map((b) => ({
    chatbot_id: b.chatbot_id,
    display_name: b.display_name,
    is_active: b.is_active,
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">파이프라인 추적</h1>
        <p className="text-sm text-muted-foreground">
          질문 하나를 운영과 같은 단계로 다시 실행해 단계별 지연·점수·후보 탈락 지점을 봅니다. 결과는 저장하지 않습니다.
        </p>
      </div>

      <TraceForm
        chatbots={chatbots}
        chatbotsLoading={botsLoading}
        chatbotsError={botsError}
        onRetryChatbots={() => void refetchBots()}
        pending={mutation.isPending}
        onSubmit={(req) => mutation.mutate(req)}
      />

      {mutation.isPending ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <span className="sr-only">실행 중입니다. 최대 약 25초 걸립니다</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : mutation.isError ? (
        <p
          role="alert"
          className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-destructive"
        >
          {traceErrorMessage(mutation.error)}
        </p>
      ) : mutation.data ? (
        <TraceResult trace={mutation.data} stopAfter={mutation.variables?.stop_after} />
      ) : (
        <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          질문을 입력하고 실행하면 단계별 결과가 여기에 나옵니다.
        </p>
      )}
    </div>
  );
}
