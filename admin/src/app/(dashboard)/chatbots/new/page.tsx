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
  const [isActive, setIsActive] = useState(true);
  const [tiers, setTiers] = useState<SearchTier[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      chatbotAPI.create({
        chatbot_id: chatbotId,
        display_name: displayName,
        description,
        search_tiers: { tiers },
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

        <div className="space-y-2">
          <Label>검색 티어 설정</Label>
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
