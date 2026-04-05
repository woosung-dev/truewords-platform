"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatbotAPI, type SearchTier } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import SearchTierEditor from "@/components/search-tier-editor";
import { Info, User, Search, ChevronLeft } from "lucide-react";

export default function NewChatbotPage() {
  const router = useRouter();
  const [chatbotId, setChatbotId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [tiers, setTiers] = useState<SearchTier[]>([]);
  const [dictionaryEnabled, setDictionaryEnabled] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      chatbotAPI.create({
        chatbot_id: chatbotId,
        display_name: displayName,
        description,
        persona_name: personaName,
        system_prompt: systemPrompt,
        search_tiers: { tiers, dictionary_enabled: dictionaryEnabled },
        is_active: isActive,
      }),
    onSuccess: (data) => {
      toast.success("챗봇이 생성되었습니다");
      router.push(`/chatbots/${data.id}/edit`);
    },
    onError: (err: Error) => {
      const msg = err.message.includes("409")
        ? "이미 존재하는 chatbot_id입니다"
        : err.message.includes("연결")
          ? "서버에 연결할 수 없습니다"
          : "챗봇 생성에 실패했습니다";
      toast.error(msg);
    },
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <div className="max-w-2xl space-y-1">
      {/* 헤더 */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ChevronLeft className="w-4 h-4" />
        챗봇 목록
      </button>

      <h1 className="text-2xl font-bold tracking-tight">새 챗봇 만들기</h1>
      <p className="text-sm text-muted-foreground pb-4">
        새로운 AI 챗봇의 기본 설정을 구성합니다
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 섹션 1: 기본 정보 */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <Info className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">기본 정보</h3>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="chatbot-id">
              Chatbot ID <span className="text-destructive">*</span>
            </Label>
            <Input
              id="chatbot-id"
              value={chatbotId}
              onChange={(e) => setChatbotId(e.target.value)}
              placeholder="malssum_priority"
              required
            />
            <p className="text-xs text-muted-foreground">
              한번 설정 후 변경 불가. 영문 소문자, 숫자, 언더스코어만 사용
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display-name">
              표시 이름 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="말씀선집 우선"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">설명</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="챗봇 설명 (선택)"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="is-active"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            <Label htmlFor="is-active" className="cursor-pointer">
              활성화
            </Label>
          </div>
        </div>

        {/* 섹션 2: 페르소나 설정 */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <User className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">페르소나 설정</h3>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="persona-name">페르소나 이름</Label>
            <Input
              id="persona-name"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="예: 30년 경력 목회공직자"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="system-prompt">시스템 프롬프트</Label>
            <textarea
              id="system-prompt"
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm min-h-[180px] resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="봇의 역할, 응답 규칙, 가드레일 등을 입력하세요."
            />
            <p className="text-xs text-muted-foreground">
              비워두면 기본 시스템 프롬프트가 적용됩니다
            </p>
          </div>
        </div>

        {/* 섹션 3: 검색 설정 */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <Search className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">검색 티어 설정</h3>
          </div>

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="dictionary-enabled"
              checked={dictionaryEnabled}
              onCheckedChange={(checked) =>
                setDictionaryEnabled(checked === true)
              }
              disabled
            />
            <Label
              htmlFor="dictionary-enabled"
              className="cursor-not-allowed opacity-50 text-sm"
            >
              용어 사전 자동 주입 (D)
            </Label>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md">
              준비중
            </span>
          </div>

          <SearchTierEditor tiers={tiers} onChange={setTiers} />
        </div>

        {/* 하단 액션 바 */}
        <div className="sticky bottom-0 flex gap-3 border-t bg-background/80 backdrop-blur-sm py-4 -mx-6 px-6">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "생성 중..." : "생성"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
          >
            취소
          </Button>
        </div>
      </form>
    </div>
  );
}
