"use client";

import type { GenerationTrace } from "../types";

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-admin-muted/20 px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium">
        {title}
        {meta && <span className="ml-2 font-normal text-muted-foreground">{meta}</span>}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-card p-3 text-xs leading-relaxed">
      {text || "(비어 있음)"}
    </pre>
  );
}

// Tabs primitive 가 없어 접었다 펴는 섹션 세 개로 보인다.
export function GenerationPanel({ generation }: { generation: GenerationTrace }) {
  const history = generation.history_window ?? [];
  return (
    <section aria-label="생성" className="rounded-xl border bg-card p-5 space-y-2">
      <h2 className="text-sm font-semibold">생성</h2>
      <Section title="system prompt" meta={`${generation.system_prompt.length.toLocaleString()}자`}>
        <Pre text={generation.system_prompt} />
      </Section>
      <Section
        title="context prompt"
        meta={`${generation.context_prompt.length.toLocaleString()}자 · 이력 ${history.length}개`}
      >
        <div className="space-y-2">
          {history.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">이력 window</p>
              <ol className="space-y-1 text-xs">
                {history.map((turn, i) => (
                  <li key={i} className="rounded-md bg-card px-2 py-1">
                    <span className="mr-2 font-mono text-muted-foreground">
                      {turn.role.toLowerCase() === "user" ? "user" : "assistant"}
                    </span>
                    <span className="whitespace-pre-wrap">{turn.content}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Pre text={generation.context_prompt} />
        </div>
      </Section>
      <Section title="답변" meta={`${generation.answer.length.toLocaleString()}자`}>
        <Pre text={generation.answer} />
      </Section>
    </section>
  );
}
