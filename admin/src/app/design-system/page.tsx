"use client";

import * as React from "react";
import {
  ChatButton,
  QuestionInput,
  CitationCard,
  PersonaSheet,
  PersonaRowTrigger,
  FloatingActionBar,
  FollowupPills,
  FeedbackButtons,
  ClosingTemplate,
  StreamingText,
  AnswerSkeleton,
  type PersonaMode,
  type FeedbackKind,
} from "@/components/truewords";

const SAMPLE_ANSWER = `참사랑은 위함을 위하는 사랑이며, 받기보다는 주는 데에서 완성되는 사랑입니다.
이 사랑은 일시적인 감정이 아니라 영원성·절대성·불변성을 가진 본질의 차원입니다.

성경/말씀이 보여주는 모습을 보면, 부모가 자식을 위해 모든 것을 내어주는 마음이 곧
참사랑의 본질입니다.`;

export default function DesignSystemPage() {
  const [persona, setPersona] = React.useState<PersonaMode>("standard");
  const [personaOpen, setPersonaOpen] = React.useState(false);
  const [bookmarked, setBookmarked] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{
    thumbsUp?: boolean;
    thumbsDown?: boolean;
    saved?: boolean;
  }>({});
  const [streamingKey, setStreamingKey] = React.useState(0);
  const [showSkeleton, setShowSkeleton] = React.useState(false);

  const handleFeedback = (kind: FeedbackKind) => {
    setFeedback((prev) => {
      switch (kind) {
        case "thumbs_up":
          return { ...prev, thumbsUp: !prev.thumbsUp, thumbsDown: false };
        case "thumbs_down":
          return { ...prev, thumbsDown: !prev.thumbsDown, thumbsUp: false };
        case "save":
          return { ...prev, saved: !prev.saved };
      }
    });
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="font-display text-xl font-semibold text-foreground">
            TrueWords Design System
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            v1.0.0 · foundation
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-12 px-4 py-8">
        <Section title="Color Tokens" desc="Plan A.2 — Light/Dark 자동 전환">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { name: "background", className: "bg-background border-border" },
              { name: "card", className: "bg-card" },
              { name: "secondary", className: "bg-secondary" },
              { name: "primary", className: "bg-primary text-primary-foreground" },
              { name: "accent (brass)", className: "bg-accent text-accent-foreground" },
              { name: "destructive", className: "bg-destructive text-white" },
              { name: "highlight", className: "bg-highlight text-highlight-foreground" },
              { name: "pastoral", className: "bg-pastoral text-pastoral-foreground" },
              { name: "success", className: "bg-success text-success-foreground" },
            ].map((t) => (
              <div
                key={t.name}
                className={`flex h-16 items-center justify-center rounded-lg border text-xs font-medium ${t.className}`}
              >
                {t.name}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography" desc="Plan A.3 — Pretendard / Noto Serif KR / Cormorant Garamond">
          <div className="space-y-3">
            <p className="font-display text-3xl font-semibold">
              말씀의 깊이를 AI와 함께 — Display
            </p>
            <p className="text-2xl font-semibold">H1 헤딩 (Pretendard)</p>
            <p className="text-lg font-medium">H2 / 섹션 타이틀</p>
            <p className="text-base">
              본문 기본 — body 16px, line-height 1.625. 한국어 가독성 검증 문장입니다.
            </p>
            <p className="font-reading text-[18px] leading-[1.85] break-keep-all">
              본문 페이지(prose-reading) — Noto Serif KR 으로 렌더되는 묵상용 가독 텍스트입니다.
              참사랑은 위함을 위하는 사랑이며, 영원성·절대성·불변성의 본질을 가집니다.
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              [347권 · 2001.07.03 · 청평수련소 · 참사랑의 길]  ← caption mono
            </p>
          </div>
        </Section>

        <Section title="ChatButton" desc="Plan B.1 — primary / brass / pastoral / kakao">
          <div className="flex flex-wrap gap-3">
            <ChatButton variant="primary">기본 액션</ChatButton>
            <ChatButton variant="brass">Brass CTA</ChatButton>
            <ChatButton variant="pastoral">목회 상담 모드</ChatButton>
            <ChatButton variant="ghost">Ghost</ChatButton>
            <ChatButton variant="outline">Outline</ChatButton>
            <ChatButton variant="kakao">카카오 로그인</ChatButton>
            <ChatButton variant="primary" loading>
              처리 중
            </ChatButton>
            <ChatButton variant="primary" disabled>
              비활성
            </ChatButton>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <ChatButton variant="primary" size="sm">
              sm
            </ChatButton>
            <ChatButton variant="primary" size="md">
              md (44h)
            </ChatButton>
            <ChatButton variant="primary" size="lg">
              lg (48h)
            </ChatButton>
            <ChatButton variant="brass" size="xl" fullWidth>
              xl 56h Full Width
            </ChatButton>
          </div>
        </Section>

        <Section title="QuestionInput (P0-C)" desc="두 줄 placeholder + char counter (max 1000)">
          <QuestionInput />
          <div className="mt-3">
            <QuestionInput
              placeholderLine1="이 본문에 대해 궁금한 점을 적어주세요"
              placeholderLine2="검색 키워드만 입력해도 됩니다"
              helperText="P1-M 에서 본문 컨텍스트가 자동 prepending 됩니다"
            />
          </div>
        </Section>

        <Section title="PersonaSheet (P0-E ★★)" desc="답변 모드 5종 페르소나 — 위급 시 목회 상담자 자동">
          <div className="space-y-3">
            <PersonaRowTrigger
              value={persona}
              onClick={() => setPersonaOpen(true)}
            />
            <p className="text-xs text-muted-foreground">
              현재: <code className="font-mono">{persona}</code> · 행을 탭하면 sheet 가 올라옵니다.
            </p>
          </div>
          <PersonaSheet
            open={personaOpen}
            onOpenChange={setPersonaOpen}
            value={persona}
            onValueChange={setPersona}
          />
        </Section>

        <Section title="CitationCard (P1-B + P1-H + P0-B + P1-L)" desc="3-탭 + 4중 메타 + 본문 jump">
          <CitationCard
            meta={{
              volumeNo: 347,
              deliveredAt: "2001.07.03",
              deliveredPlace: "청평수련소",
              chapterTitle: "하나님은 우리의 참된 왕이자 참 부모",
            }}
            haeseol={
              <p>
                참사랑은 <mark className="tw-highlight">위함을 위함을 본질로 하는 사랑</mark>이며,
                받기보다 주는 마음에 그 절대성이 깃들어 있습니다.
              </p>
            }
            bonmun={
              <p>
                (원문) 사람의 진정한 가치는 위함을 위함의 사랑 가운데서 발견되는 것입니다.
                위함을 위함의 사랑이라는 것은 받는 데서 시작하는 것이 아닙니다.
              </p>
            }
            note={
              <textarea
                placeholder="이 인용에 대한 묵상을 적어보세요"
                className="w-full rounded-md border border-border bg-card p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                rows={3}
              />
            }
            onOpenOriginal={() => alert("P0-B 원문 모달 (placeholder)")}
            onJumpToSource={() => alert("P1-L 본문 페이지 jump (placeholder)")}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            잠금 변형(P2-J freemium):
          </p>
          <CitationCard
            className="mt-2"
            meta={{
              volumeNo: 180,
              deliveredAt: "1988.06.15",
              deliveredPlace: "한남동공관",
              chapterTitle: "진정한 사랑",
            }}
            haeseol={<p>비로그인/공유 페이지 — 본문·노트 탭이 잠겨 있습니다.</p>}
            onLockedTabClick={(tab) =>
              alert(`P2-J 모달 trigger: ${tab} 탭은 앱 전용`)
            }
          />
        </Section>

        <Section title="FollowupPills (P0-A + P2-K)" desc="추천 5개 + 비로그인 시 3개 블러">
          <FollowupPills
            suggestions={[
              "참사랑의 4대 심정권은?",
              "부모자식과 부부 관계의 차이는?",
              "참된 가정은 어떻게 만들어가나요?",
              "공적 사랑의 길은 어떻게 시작하나요?",
              "절대성의 의미를 더 깊이 알고 싶어요",
            ]}
            authenticated={false}
            onSelect={(q) => alert(`선택: ${q}`)}
            onLoginClick={() => alert("카카오 로그인 (placeholder)")}
          />
        </Section>

        <Section title="FeedbackButtons (P1-A)" desc="👍 👎 💾 — RAGAS 골드셋 보강용">
          <FeedbackButtons state={feedback} onFeedback={handleFeedback} />
        </Section>

        <Section title="ClosingTemplate (P1-J)" desc="기도문 / 결의문 동봉">
          <ClosingTemplate
            kind="resolution"
            body={
              "참사랑의 정신으로 오늘 하루도 위함의 길을 걸어가겠습니다.\n받는 마음보다 주는 마음으로 살아가게 하소서."
            }
            signature="참부모님 말씀에 깊이 감사드리며"
          />
          <div className="mt-3">
            <ClosingTemplate
              kind="prayer"
              body={"오늘도 우리에게 깨달음의 빛을 비추어 주심을 감사드립니다."}
              signature="예수 그리스도의 이름으로 기도드립니다. 아멘."
            />
          </div>
        </Section>

        <Section title="StreamingText / Skeleton (B.8)" desc="P0-D AI-Native 스트리밍 + 로딩">
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <ChatButton
                size="sm"
                variant="primary"
                onClick={() => {
                  setShowSkeleton(true);
                  setStreamingKey((k) => k + 1);
                  setTimeout(() => setShowSkeleton(false), 800);
                }}
              >
                스트리밍 재생
              </ChatButton>
              <ChatButton
                size="sm"
                variant="ghost"
                onClick={() => setShowSkeleton((v) => !v)}
              >
                스켈레톤 토글
              </ChatButton>
            </div>
            {showSkeleton ? (
              <AnswerSkeleton lines={3} />
            ) : (
              <p className="font-reading text-[15px] leading-[1.75]">
                <StreamingText
                  key={streamingKey}
                  text={SAMPLE_ANSWER}
                  streaming
                />
              </p>
            )}
          </div>
        </Section>

        <Section title="FloatingActionBar (P0-G)" desc="고정 하단 — 새질문 / 북마크 / 공유">
          <p className="text-sm text-muted-foreground">
            화면 하단에 floating bar 가 항상 떠있습니다 ↓
          </p>
        </Section>
      </main>

      <FloatingActionBar
        bookmarked={bookmarked}
        onNewQuestion={() => alert("P0-A follow-up sheet open (placeholder)")}
        onBookmark={() => setBookmarked((v) => !v)}
        onShare={() => alert("P1-D 이미지 공유 (placeholder)")}
      />
    </div>
  );
}

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="border-b border-border pb-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {desc ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
        ) : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
