import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpenCheck,
  CalendarClock,
  ScrollText,
  ShieldAlert,
} from "lucide-react";

export const metadata: Metadata = {
  title: "TrueWords — 신학 입장 & 운영 투명성",
  description:
    "TrueWords AI 챗봇의 운영 원칙, 신학적 입장, 검수 사이클, 한계와 면책을 공개합니다.",
};

// ADR-46 Screen 6 — P1-F 신학 입장 / 운영 투명성 페이지.
// 본문은 정적 placeholder. 검수 통계는 P1-K(W3)에서 백엔드 연동 예정.

type Principle = {
  id: string;
  icon: typeof BookOpenCheck;
  eyebrow: string;
  title: string;
  body: string;
};

const PRINCIPLES: Principle[] = [
  {
    id: "sources",
    icon: ScrollText,
    eyebrow: "출처 명기",
    title: "모든 답변에 4중 근거를 답니다",
    body:
      "답변 본문에는 권/장/절·문단·페이지·원문 인용을 함께 표기합니다. " +
      "AI가 생성한 문장이라도, 그 근거가 학습 데이터의 어느 위치에 있는지 " +
      "독자가 직접 확인하고 비판적으로 검토할 수 있어야 한다고 믿습니다.",
  },
  {
    id: "review-cycle",
    icon: CalendarClock,
    eyebrow: "검수 사이클",
    title: "주 1회 신학 검수 + 월 1회 종합 리포트",
    body:
      "신학 자문진이 매주 무작위로 추출된 답변 표본을 4축(적합 / 톤 / 인용 / 신학) " +
      "으로 검수합니다. 결과는 월간 리포트로 공개되며, 부적합 비율이 임계치를 " +
      "넘으면 해당 카테고리의 답변 흐름을 즉시 점검합니다.",
  },
  {
    id: "stance",
    icon: BookOpenCheck,
    eyebrow: "신학 입장",
    title: "특정 교파를 대변하지 않습니다",
    body:
      "TrueWords 는 학습된 615권의 텍스트를 가장 정확하게 인용·요약하는 데 " +
      "집중하며, 교파적 판단이 필요한 영역에서는 단정하지 않고 출처와 함께 " +
      "여러 해석을 제시합니다. 챗봇별 신학 입장은 페르소나 페이지에서 별도 명시됩니다.",
  },
  {
    id: "limits",
    icon: ShieldAlert,
    eyebrow: "한계와 면책",
    title: "AI 답변은 신앙 상담을 대체하지 않습니다",
    body:
      "본 서비스는 학습된 텍스트 기반의 정보 제공 도구입니다. 위기 상황 · " +
      "목회 상담 · 의료 · 법률 영역의 판단을 대체할 수 없으며, 모든 답변은 " +
      "독자의 판단과 공동체의 분별 안에서 활용되어야 합니다.",
  },
];

type ReviewMetric = {
  label: string;
  value: string;
  tone: "ok" | "warn";
  hint: string;
};

const REVIEW_METRICS: ReviewMetric[] = [
  { label: "적합", value: "92.3%", tone: "ok", hint: "신학·인용·톤 모두 통과" },
  { label: "톤 부적합", value: "2.3%", tone: "warn", hint: "단정·강압적 어조" },
  { label: "인용 오류", value: "3.4%", tone: "warn", hint: "권/장/절 불일치" },
  { label: "신학적 오류", value: "2.0%", tone: "warn", hint: "교리 단정·오해석" },
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="border-b border-border bg-secondary/50">
        <div className="mx-auto max-w-3xl px-6 py-20 md:py-28 break-keep-all">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            TrueWords · About
          </p>
          <h1 className="font-display mt-4 text-4xl md:text-5xl font-semibold leading-[1.15] tracking-tight text-foreground">
            우리는 어떤 원칙으로
            <br />이 챗봇을 운영합니까
          </h1>
          <p className="prose-reading mt-6 max-w-2xl text-base md:text-lg text-muted-foreground">
            TrueWords 는 615권의 학습 텍스트를 근거로 답변하는 AI 챗봇입니다.
            모든 답변은 출처와 함께 제공되며, 신학 자문진의 정기 검수를 거칩니다.
            아래는 우리가 지키려는 네 가지 원칙입니다.
          </p>
        </div>
      </section>

      {/* 4 운영 원칙 카드 — 2 column grid */}
      <section className="mx-auto max-w-5xl px-6 py-16 md:py-20">
        <div className="grid gap-5 md:grid-cols-2">
          {PRINCIPLES.map((p) => {
            const Icon = p.icon;
            return (
              <article
                key={p.id}
                className="group relative rounded-xl border border-border bg-card p-6 md:p-7 shadow-[var(--tw-shadow-card)] transition-shadow hover:shadow-[var(--tw-shadow-card-hover)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-accent">
                    <Icon className="h-4.5 w-4.5" strokeWidth={1.6} />
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {p.eyebrow}
                  </span>
                </div>
                <h2 className="mt-4 text-lg md:text-xl font-semibold leading-snug text-foreground break-keep-all">
                  {p.title}
                </h2>
                <p className="prose-reading mt-3 text-[15px] text-muted-foreground break-keep-all">
                  {p.body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* 검수 통계 — placeholder (P1-K W3 백엔드 연동 예정) */}
      <section className="border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-5xl px-6 py-16 md:py-20">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                Review · Last 4 weeks
              </p>
              <h2 className="font-display mt-2 text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
                검수 통계 (최근 4주)
              </h2>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              표본 n=520 · 신학 자문 4인 · placeholder
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            {REVIEW_METRICS.map((m) => (
              <div
                key={m.label}
                className="rounded-xl border border-border bg-card p-5"
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {m.label}
                </p>
                <p
                  className={`mt-3 font-display text-3xl font-semibold tabular-nums ${
                    m.tone === "ok" ? "text-success" : "text-foreground"
                  }`}
                >
                  {m.value}
                </p>
                <p className="mt-2 text-xs text-muted-foreground break-keep-all">
                  {m.hint}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 font-mono text-[11px] text-muted-foreground">
            * 본 수치는 정식 운영 전 placeholder 입니다. 실데이터 연동은 P1-K
            (검수 사이클 백엔드) 작업에서 적용됩니다.
          </p>
        </div>
      </section>

      {/* 모델 / 기술 footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[12px] text-muted-foreground">
            TrueWords v1.0.0 · gemini-2.5-flash · 615권 학습
          </p>
          <div className="flex items-center gap-5 font-mono text-[12px] text-muted-foreground">
            <Link
              href="/dashboard"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              대시보드
            </Link>
            <span aria-hidden className="text-border">
              ·
            </span>
            <span>© TrueWords Platform</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
