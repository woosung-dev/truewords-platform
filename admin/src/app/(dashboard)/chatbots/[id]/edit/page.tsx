"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatbotAPI, type SearchTier } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import SearchTierEditor from "@/components/search-tier-editor";

export default function EditChatbotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: config, isLoading, isError } = useQuery({
    queryKey: ["chatbot", id],
    queryFn: () => chatbotAPI.get(id),
  });

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [tiers, setTiers] = useState<SearchTier[]>([]);
  const [dictionaryEnabled, setDictionaryEnabled] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (config && !initialized) {
      setDisplayName(config.display_name);
      setDescription(config.description);
      setPersonaName(config.persona_name ?? "");
      setSystemPrompt(config.system_prompt ?? "");
      setIsActive(config.is_active);
      setTiers(config.search_tiers?.tiers ?? []);
      setDictionaryEnabled(config.search_tiers?.dictionary_enabled ?? false);
      setInitialized(true);
    }
  }, [config, initialized]);

  const mutation = useMutation({
    mutationFn: () =>
      chatbotAPI.update(id, {
        display_name: displayName,
        description,
        persona_name: personaName,
        system_prompt: systemPrompt,
        search_tiers: { tiers, dictionary_enabled: dictionaryEnabled },
        is_active: isActive,
      }),
    onSuccess: () => {
      toast.success("저장되었습니다");
      queryClient.invalidateQueries({ queryKey: ["chatbot", id] });
      queryClient.invalidateQueries({ queryKey: ["chatbots"] });
    },
    onError: (err: Error) => {
      toast.error(
        err.message.includes("연결")
          ? "서버에 연결할 수 없습니다"
          : "저장에 실패했습니다"
      );
    },
  });

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    mutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-32 w-full max-w-2xl" />
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">설정을 불러올 수 없습니다.</p>
        <Link href="/chatbots" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-4 text-sm text-muted-foreground">
        <Link href="/chatbots" className="hover:text-foreground">
          챗봇
        </Link>
        <span className="mx-2">/</span>
        <span>{config.display_name}</span>
        <span className="mx-2">/</span>
        <span className="text-foreground">편집</span>
      </nav>

      <h1 className="text-2xl font-bold">{config.display_name}</h1>
      <p className="mt-1 text-sm text-muted-foreground font-mono">
        {config.chatbot_id}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 max-w-2xl space-y-6">
        <div className="space-y-2">
          <Label htmlFor="display-name">표시 이름</Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">설명</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            {mutation.isPending ? "저장 중..." : "저장"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/chatbots")}
          >
            목록으로
          </Button>
        </div>
      </form>
    </div>
  );
}
