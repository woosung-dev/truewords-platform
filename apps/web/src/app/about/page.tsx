import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TrueWords · 운영 원칙",
  description: "TrueWords AI 답변이 근거를 보여 주는 방식과 한계를 안내합니다.",
};

// ADR-46 Screen 6 — 운영 원칙 페이지.
// 지금 실제로 동작하는 것(답변마다 근거 권과 원문 보기)과 면책 고지만 적는다.
// 아직 운영하지 않는 절차(정기 검수·리포트)나 확인되지 않은 수치는 쓰지 않는다.

type Principle = {
  id: string;
  title: string;
  body: string;
};

const PRINCIPLES: Principle[] = [
  {
    id: "sources",
    title: "답변마다 근거를 함께 보여 줍니다",
    body:
      "답변 아래에 근거가 된 권이 번호와 함께 나옵니다. 본문에 번호가 있으면 같은 번호의 출처를 가리킵니다. " +
      "출처를 누르면 인용한 부분과 앞뒤 문맥을 원문으로 확인할 수 있습니다.",
  },
  {
    id: "stance",
    title: "교단의 공식 입장이 아닙니다",
    body:
      "AI 답변은 교단의 공식 입장과 다를 수 있습니다. " +
      "민감한 주제는 반드시 출처 원문과 지도자 안내를 함께 확인해 주세요.",
  },
  {
    id: "limits",
    title: "AI 답변은 신앙 상담을 대체하지 않습니다",
    body:
      "TrueWords는 말씀 텍스트를 바탕으로 정보를 제공하는 도구입니다. 위기 상황, 목회 상담, 의료, 법률 영역의 " +
      "판단을 대체할 수 없으며, 모든 답변은 독자의 판단과 공동체의 분별 안에서 활용되어야 합니다.",
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-2xl px-4 py-6 break-keep-all sm:px-6 md:py-12">
        <Link
          href="/"
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          채팅으로
        </Link>

        <h1 className="mt-6 text-2xl font-bold tracking-tight md:text-3xl">TrueWords 운영 원칙</h1>
        <p className="mt-3 text-base leading-[1.8] text-muted-foreground">
          TrueWords는 말씀 원문에서 관련 구절을 찾아, 그 내용을 근거로 답하는 AI 챗봇입니다.
        </p>

        <dl className="mt-8 divide-y divide-border border-y border-border">
          {PRINCIPLES.map((p) => (
            <div key={p.id} className="py-6">
              <dt className="text-lg font-semibold leading-snug">{p.title}</dt>
              <dd className="mt-2 text-base leading-[1.8] text-muted-foreground">{p.body}</dd>
            </div>
          ))}
        </dl>

        {/* 사용자 웹이므로 모델명·관리자 링크는 노출하지 않는다 */}
        <p className="mt-8 text-xs text-muted-foreground">© TrueWords Platform</p>
      </div>
    </main>
  );
}
