"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatbotAPI } from "@/features/chatbot/api";
import type { SearchTier } from "@/features/chatbot/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import SearchTierEditor from "@/features/chatbot/components/search-tier-editor";
import { Info, User, Search, ChevronRight } from "lucide-react";

export default function EditChatbotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    data: config,
    isLoading,
    isError,
  } = useQuery({
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
  const [queryRewriteEnabled, setQueryRewriteEnabled] = useState(false);
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
      setQueryRewriteEnabled(config.search_tiers?.query_rewrite_enabled ?? false);
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
        search_tiers: { tiers, dictionary_enabled: dictionaryEnabled, query_rewrite_enabled: queryRewriteEnabled },
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
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-56" />
        <div className="rounded-xl border p-5 space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <div className="rounded-xl border p-5 space-y-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !config) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
        <p className="text-muted-foreground text-sm">설정을 불러올 수 없습니다.</p>
        <Link
          href="/chatbots"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          목록으로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-1">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
        <Link href="/chatbots" className="hover:text-foreground transition-colors">
          챗봇
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium">{config.display_name}</span>
      </nav>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{config.display_name}</h1>
        <p className="text-sm text-muted-foreground font-mono mt-0.5">
          {config.chatbot_id}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        {/* 섹션 1: 기본 정보 */}
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <Info className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">기본 정보</h3>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="display-name">
              표시 이름 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">설명</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              id="query-rewrite-enabled"
              checked={queryRewriteEnabled}
              onCheckedChange={(checked) =>
                setQueryRewriteEnabled(checked === true)
              }
            />
            <Label htmlFor="query-rewrite-enabled" className="cursor-pointer text-sm">
              Query Rewriting
            </Label>
            <span className="text-xs text-muted-foreground">
              사용자 질문을 종교 용어로 자동 재작성
            </span>
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
