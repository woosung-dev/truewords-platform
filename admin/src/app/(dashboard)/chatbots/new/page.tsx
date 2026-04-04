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
    <div>
      <h1 className="text-2xl font-bold">새 챗봇 만들기</h1>

      <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-6">
        <div className="space-y-2">
          <Label htmlFor="chatbot-id">Chatbot ID</Label>
          <Input
            id="chatbot-id"
            value={chatbotId}
            onChange={(e) => setChatbotId(e.target.value)}
            placeholder="malssum_priority"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="display-name">표시 이름</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="말씀선집 우선"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">설명</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="챗봇 설명 (선택)"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="is-active"
            checked={isActive}
            onCheckedChange={(checked) => setIsActive(checked === true)}
          />
          <Label htmlFor="is-active">활성화</Label>
        </div>

        {/* 페르소나 설정 */}
        <div className="space-y-4 rounded-lg border p-4">
          <h3 className="font-semibold">페르소나 설정</h3>

          <div className="space-y-2">
            <Label htmlFor="persona-name">페르소나 이름</Label>
            <Input
              id="persona-name"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="예: 30년 경력 목회공직자"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="system-prompt">시스템 프롬프트</Label>
            <textarea
              id="system-prompt"
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm min-h-[200px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="봇의 역할, 응답 규칙, 가드레일 등을 입력하세요. 비워두면 기본 시스템 프롬프트가 적용됩니다."
            />
            <p className="text-xs text-muted-foreground">
              비워두면 기본 시스템 프롬프트가 적용됩니다
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>검색 티어 설정</Label>

          <div className="flex items-center gap-2 mb-3">
            <Checkbox
              id="dictionary-enabled"
              checked={dictionaryEnabled}
              onCheckedChange={(checked) => setDictionaryEnabled(checked === true)}
            />
            <Label htmlFor="dictionary-enabled" className="text-sm">
              용어 사전 자동 주입 (D)
            </Label>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              준비중
            </span>
          </div>

          <SearchTierEditor tiers={tiers} onChange={setTiers} />
        </div>

        {/* 하단 sticky bar */}
        <div className="sticky bottom-0 flex gap-3 border-t bg-background py-4">
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
