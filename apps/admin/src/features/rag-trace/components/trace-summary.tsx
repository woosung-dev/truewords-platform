"use client";

import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatMs, formatValue } from "../format";
import type { EffectiveConfig, RagTraceResponse } from "../types";

// 경고 코드 → 표시 문구. "name:N" 형식은 N 을 붙여 보인다.
const WARNING_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  budget_exceeded: { label: "예산 초과", tone: "danger" },
  stage_error: { label: "단계 오류", tone: "danger" },
  rerank_parse_fail: { label: "rerank 파싱 실패", tone: "danger" },
  rerank_api_fail: { label: "rerank 호출 실패", tone: "danger" },
  candidates_incomplete: { label: "후보 판정 보류", tone: "warning" },
  debug_lookup_failed: { label: "순위 조회 실패", tone: "warning" },
  meta_terminated: { label: "meta 조기 종료", tone: "info" },
  cache_would_hit: { label: "캐시 적중 예정", tone: "info" },
  history_ignored_multiturn_off: { label: "멀티턴 꺼짐 — 이력 무시", tone: "neutral" },
  pastoral_hotline_missing_in_stream: { label: "스트림 답변에 상담 안내 없음", tone: "warning" },
  filter_loss: { label: "필터 손실", tone: "warning" },
  duplicates: { label: "중복", tone: "warning" },
  rrf_mismatch: { label: "RRF 불일치", tone: "danger" },
};

export function warningBadge(code: string): { label: string; tone: StatusTone } {
  const [name, detail] = code.split(":", 2);
  const known = WARNING_LABEL[name.toLowerCase()];
  if (!known) return { label: code, tone: "neutral" };
  return { label: detail ? `${known.label} ${detail}` : known.label, tone: known.tone };
}

function generationSpan(trace: RagTraceResponse) {
  return trace.spans?.find((s) => s.name === "generation");
}

function contextCount(trace: RagTraceResponse): number | null {
  const n = generationSpan(trace)?.output?.context_n;
  if (typeof n === "number") return n;
  const fromRows = (trace.candidates ?? []).filter((c) => c.context_rank != null).length;
  return trace.generation ? fromRows : null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function ConfigList({ config }: { config: EffectiveConfig }) {
  const rows: [string, unknown][] = [
    ["챗봇", config.chatbot_id],
    ["컬렉션", config.collection],
    ["검색 모드", config.search_mode],
    ["tiers", config.tiers?.length ? config.tiers : null],
    ["weighted sources", config.weighted_sources?.length ? config.weighted_sources : null],
    ["rerank", `${config.rerank_enabled ? "ON" : "OFF"} (${config.rerank_enabled_reason})`],
    ["rewrite", `${config.query_rewrite_enabled ? "ON" : "OFF"} (${config.query_rewrite_enabled_reason})`],
    ["multiturn", config.multiturn_enabled ? "ON" : "OFF"],
    ["intent 분류", config.intent_classifier_enabled ? "ON" : "OFF"],
    ["생성 모델", config.generation_model],
    ["임베딩 모델", config.embedding_model],
    ["rerank top_k", config.rerank_top_k],
    ["context slice", config.context_slice],
    ["sparse modifier", config.sparse_modifier ?? "조회 실패"],
  ];
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[10rem_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono break-all">{formatValue(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TraceSummary({ trace }: { trace: RagTraceResponse }) {
  const { totals } = trace;
  const ttft = generationSpan(trace)?.ttft_ms;
  const ctx = contextCount(trace);
  const warnings = trace.warnings ?? [];

  return (
    <section aria-label="실행 요약" className="rounded-xl border bg-card p-5 space-y-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="총 지연" value={formatMs(totals.total_ms)} />
        <Metric label="critical path" value={formatMs(totals.critical_path_ms)} />
        <Metric label="TTFT" value={formatMs(ttft)} />
        <Metric
          label="LLM 호출 · 토큰"
          value={`${totals.llm_calls}회 · ${totals.input_tokens.toLocaleString()}/${totals.output_tokens.toLocaleString()}`}
        />
        <Metric label="context 수" value={ctx === null ? "–" : String(ctx)} />
        <Metric label="fallback" value={(trace.fallback_type ?? "none").toLowerCase()} />
      </dl>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>
          intent <span className="font-mono text-foreground">{trace.intent ?? "–"}</span> · 답변 모드{" "}
          <span className="font-mono text-foreground">{trace.resolved_answer_mode ?? "–"}</span> · 검색 질문{" "}
          <span className="text-foreground">{trace.search_query ?? "–"}</span>
          {trace.rewritten ? " (재작성됨)" : ""}
        </p>
      </div>

      {(trace.partial || warnings.length > 0) && (
        <ul aria-label="경고" className="flex flex-wrap gap-1.5">
          {trace.partial && (
            <li>
              <StatusBadge tone="danger">일부만 수집됨</StatusBadge>
            </li>
          )}
          {warnings.map((w, i) => {
            const { label, tone } = warningBadge(w);
            return (
              <li key={`${w}-${i}`}>
                <StatusBadge tone={tone} title={w}>
                  {label}
                </StatusBadge>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        현재 설정으로 다시 실행한 결과이며 당시 응답과 다를 수 있음(LLM intent·rewrite는 실행마다 달라질 수 있음)
      </p>

      {trace.effective_config && (
        <details className="group rounded-lg border bg-admin-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">적용된 설정 (effective_config)</summary>
          <div className="pt-3">
            <ConfigList config={trace.effective_config} />
          </div>
        </details>
      )}
    </section>
  );
}
