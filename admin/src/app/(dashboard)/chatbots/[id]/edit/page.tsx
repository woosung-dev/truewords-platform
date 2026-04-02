"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { chatbotAPI, type SearchTier } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
  const [isActive, setIsActive] = useState(true);
  const [tiers, setTiers] = useState<SearchTier[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (config && !initialized) {
      setDisplayName(config.display_name);
      setDescription(config.description);
      setIsActive(config.is_active);
      setTiers(config.search_tiers?.tiers ?? []);
      setInitialized(true);
    }
  }, [config, initialized]);

  const mutation = useMutation({
    mutationFn: () =>
      chatbotAPI.update(id, {
        display_name: displayName,
        description,
        search_tiers: { tiers },
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
        <Button
          render={<Link href="/chatbots" />}
          variant="outline"
          size="sm"
          className="mt-3"
        >
          목록으로 돌아가기
        </Button>
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

        <div className="space-y-2">
          <Label>검색 티어 설정</Label>
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
